"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaFlowProxyController = void 0;
const node_http_1 = require("node:http");
const node_https_1 = require("node:https");
const express_1 = require("express");
const utils_1 = require("../utils");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const Dailymotion_1 = require("../extractor/Dailymotion");
/**
 * MediaFlow Proxy relay.
 *
 * The add-on co-runs bundled MediaFlow Proxy (MFP) on loopback (Railway runs
 * both in one container; start-all.ps1 runs both locally). MFP resolves
 * dailymotion / ok.ru / rumble / doodstream / ... into header-injected HLS or
 * plain stream URLs — but loopback is unreachable by Stremio players, and MFP
 * can fetch those CDNs only because it injects the UA/Referer itself.
 *
 * This controller exposes the MFP endpoints under the add-on's own public
 * host (the same origin players already fetch `/stream/*.json` from):
 *
 *   GET  /proxy/*       (hls/mpd manifests, segments, /proxy/stream)
 *   GET  /extractor/*   (extractor/video incl. redirect_stream mode)
 *   GET  /_token_/*     (MFP's encrypted-token form of the same endpoints)
 *
 * MFP rewrites child playlist/segment URIs inside the master playlist to
 * `{base}/_token_{encrypted_token}/proxy/hls/{manifest,segment,...}` (its
 * auth middleware decrypts the token and strips the prefix), so the relay
 * must serve `/_token_/*` too.
 *
 * Two things make the returned manifests playable:
 *
 * 1. The public host is forwarded upstream as `X-Forwarded-Proto` /
 *    `X-Forwarded-Host`. MFP's `public_proxy_base_url` honours those headers,
 *    so every rewritten segment/playlist URL points back at the add-on's
 *    public host (which this controller serves) instead of loopback.
 *
 * 2. The response is passed through verbatim (status, content-type,
 *    content-range, body) so seeking, 206s and 307 extraction redirects work
 *    unchanged.
 *
 * Only `/proxy/*`, `/extractor/*` and `/_token_/*` are relayed — the relay
 * cannot be turned into an open proxy for arbitrary hosts. These paths are
 * exempted from the global rate limit (a playing segment stream easily
 * exceeds 30 req/min).
 */
const DEFAULT_UPSTREAM = 'http://127.0.0.1:8889';
// Hop-by-hop / add-on-internal headers that must not be forwarded upstream.
const SKIP_REQUEST_HEADERS = new Set([
    'host',
    'connection',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'upgrade',
    'x-request-id',
    'x-forwarded-proto',
    'x-forwarded-host',
    'x-forwarded-for',
    'x-forwarded-port',
    'x-forwarded-scheme',
]);
// Upstream response headers that must not be replayed (express manages them).
const SKIP_RESPONSE_HEADERS = new Set([
    'transfer-encoding',
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'upgrade',
]);
const httpAgent = new node_http_1.Agent({ keepAlive: true });
const httpsAgent = new node_https_1.Agent({ keepAlive: true });
const firstForwarded = (value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    const first = raw?.split(',')[0]?.trim();
    return first || undefined;
};
class MediaFlowProxyController {
    router;
    logger;
    constructor(logger) {
        this.router = (0, express_1.Router)();
        this.logger = logger;
        const proxyHandler = this.proxy.bind(this);
        // RegExp routes: Express 4 (this project) does not understand the
        // Express 5 `*splat` string syntax — the string form silently 404'd
        // every relayed request. RegExp works on both major versions.
        for (const prefix of [/^\/proxy\//, /^\/extractor\//, /^\/_token_/]) {
            this.router.get(prefix, proxyHandler);
            this.router.head(prefix, proxyHandler);
            this.router.options(prefix, proxyHandler);
        }
        // Play-time Dailymotion resolver: the /stream response hands players this
        // URL (no dailymotion calls are made at stream-resolution time — the CDN
        // sec= token would be stale and the per-link rate limit wasted). When the
        // player requests it, a FRESH manifest token is fetched and the player is
        // 302-redirected to the MediaFlow HLS proxy with that fresh manifest.
        const dmHandler = this.dailymotionResolver.bind(this);
        this.router.get('/dm/:videoId.m3u8', dmHandler);
        this.router.get('/dm/:videoId', dmHandler);
    }
    upstreamBase() {
        // [halcyon patch] the embedded sidecar (same device/network as the
        // dailymotion sec= token) takes precedence over MEDIA_FLOW_PROXY_URL —
        // a re-seed can reset that env to a remote MFP whose IP can never match.
        const nativeBinDir = (0, utils_1.envGet)('AETH_NATIVE_BIN_DIR') || process.env['AETH_NATIVE_BIN_DIR'];
        if (nativeBinDir && (0, node_fs_1.existsSync)(node_path_1.default.join(nativeBinDir, 'libmediaflow.so'))) {
            return 'http://127.0.0.1:8889';
        }
        const configured = (0, utils_1.envGet)('MEDIA_FLOW_PROXY_URL')?.trim();
        if (!configured)
            return DEFAULT_UPSTREAM;
        if (configured.startsWith('http://') || configured.startsWith('https://'))
            return configured;
        return `http://${configured}`;
    }
    /**
     * Play-time Dailymotion resolver (GET /dm/:videoId.m3u8).
     *
     * DEFAULT (dmViaYtdlp): 302 to the on-device ytdlp bridge
     * (`<host>/s/ytdlp/dm/fetch`), which resolves the video through yt-dlp,
     * fetches manifest/variants/segments through yt-dlp's own networking, and
     * rewrites every dailymotion URL to itself. This replaced the MediaFlow
     * metadata chain because Dailymotion's CDN started returning 403 E005
     * (non-browser TLS fingerprint) to MFP's rustls client — while yt-dlp's
     * networking still passes. Bonus: yt-dlp exposes the 4K/AV1 ladders and
     * caches resolutions for 5h instead of one metadata hit per play.
     *
     * FALLBACK (DM_VIA_YTDLP=0): the original MediaFlow metadata path — fetch a
     * fresh `sec=` token via MFP and 302 to the MFP HLS proxy. Kept behind a
     * kill-switch in case the bridge is unavailable.
     */
    dailymotionResolver(req, res) {
        const videoId = String(req.params['videoId'] || '').replace(/\.m3u8$/i, '');
        if (!/^[a-zA-Z0-9_-]{4,32}$/.test(videoId)) {
            res.status(400).end('invalid dailymotion video id');
            return;
        }
        if ((0, utils_1.envGet)('DM_VIA_YTDLP') !== '0') {
            const proto = firstForwarded(req.headers['x-forwarded-proto']) || req.protocol;
            const host = String(firstForwarded(req.headers['x-forwarded-host']) || req.headers.host || req.host);
            // The gateway path-mounts every service under /s/<name> on any host that
            // reaches it (subdomain or LAN), so same-host keeps the player's origin
            // and TLS. Direct addon-port access (dev) can't serve /s/ — point at the
            // gateway port instead. YTDLP_PUBLIC_URL overrides everything.
            const override = (0, utils_1.envGet)('YTDLP_PUBLIC_URL');
            const hostNoPort = host.split(':')[0] || host;
            const lanDirect = /^[^:]+:\d+$/.test(host) && /^\d+\.\d+\.\d+\.\d+$/.test(hostNoPort);
            const base = override
                || (lanDirect ? `${proto}://${hostNoPort}:8787/s/ytdlp` : `${proto}://${host}/s/ytdlp`);
            const target = `https://www.dailymotion.com/video/${videoId}`;
            const h = Buffer.from(JSON.stringify(Dailymotion_1.DAILYMOTION_METADATA_HEADERS)).toString('base64');
            res.setHeader('Cache-Control', 'no-store');
            res.redirect(302, `${base}/dm/fetch?u=${encodeURIComponent(target)}&h=${encodeURIComponent(h)}&b=${encodeURIComponent(base)}`);
            return;
        }
        const metadataUrl = new URL(`https://www.dailymotion.com/player/metadata/video/${videoId}`);
        // The manifest `sec=` token is bound to the IP that fetched the metadata.
        // The manifest itself will be fetched BY MediaFlow — so the metadata MUST
        // be fetched through MediaFlow too (its /proxy/stream relays the request
        // from MFP's own IP), otherwise the token is issued to this add-on's IP
        // and MFP's fetch 403s. This is what makes the Railway-hosted MFP work.
        const viaProxyUrl = new URL('/proxy/stream', this.upstreamBase());
        viaProxyUrl.searchParams.set('api_password', (0, utils_1.envGet)('MEDIA_FLOW_PROXY_PASSWORD') || 'aetheria-link-secret');
        viaProxyUrl.searchParams.set('d', metadataUrl.href);
        for (const [name, value] of Object.entries(Dailymotion_1.DAILYMOTION_METADATA_HEADERS)) {
            viaProxyUrl.searchParams.set('h_' + name.toLowerCase(), value);
        }
        const fetchMetadata = (url, via) => {
            const doRequest = url.protocol === 'https:' ? node_https_1.request : node_http_1.request;
            const headers = { accept: 'application/json' };
            if (via === 'direct')
                Object.assign(headers, Dailymotion_1.DAILYMOTION_METADATA_HEADERS);
            const upstream = doRequest(url, { headers }, (upstreamRes) => {
                if ((upstreamRes.statusCode ?? 500) >= 400) {
                    upstreamRes.resume();
                    if (via === 'mfp') {
                        this.logger.warn(`Dailymotion metadata via MFP HTTP ${upstreamRes.statusCode} — falling back to direct`);
                        fetchMetadata(metadataUrl, 'direct');
                        return;
                    }
                    this.logger.warn(`Dailymotion metadata HTTP ${upstreamRes.statusCode} for ${videoId}`);
                    res.status(502).end('dailymotion metadata unavailable');
                    return;
                }
                let data = '';
                upstreamRes.setEncoding('utf8');
                upstreamRes.on('data', (c) => { data += c; });
                upstreamRes.on('end', () => {
                    let master;
                    try {
                        master = (0, Dailymotion_1.pickDailymotionMasterHls)(JSON.parse(data));
                    }
                    catch (e) {
                        this.logger.warn(`Dailymotion metadata parse failed for ${videoId}: ${e}`);
                    }
                    if (!master) {
                        if (via === 'mfp' && !res.headersSent) {
                            this.logger.warn(`Dailymotion metadata via MFP unusable — falling back to direct`);
                            fetchMetadata(metadataUrl, 'direct');
                            return;
                        }
                        res.status(404).end('no dailymotion HLS manifest');
                        return;
                    }
                    res.setHeader('Cache-Control', 'no-store');
                    res.redirect(302, this.hlsProxyUrlFor(req, master).href);
                });
                upstreamRes.on('error', () => {
                    if (!res.headersSent)
                        res.status(502).end('dailymotion metadata error');
                });
            });
            upstream.on('error', (err) => {
                this.logger.warn(`Dailymotion metadata request error (${via}) for ${videoId}: ${err.message}`);
                if (via === 'mfp' && !res.headersSent) {
                    fetchMetadata(metadataUrl, 'direct');
                    return;
                }
                if (!res.headersSent)
                    res.status(502).end('dailymotion metadata error');
            });
            upstream.end();
        };
        fetchMetadata(viaProxyUrl, 'mfp');
    }
    /** MediaFlow HLS-proxy URL for `master`, built on the PUBLIC host the player used
     *  (x-forwarded aware, honours x-forwarded-prefix for reverse-proxied mounts). */
    hlsProxyUrlFor(req, master) {
        const publicProto = firstForwarded(req.headers['x-forwarded-proto']) || req.protocol;
        const publicHost = firstForwarded(req.headers['x-forwarded-host']) || req.headers.host || req.host;
        const prefix = (firstForwarded(req.headers['x-forwarded-prefix']) || '').replace(/\/+$/, '');
        const url = new URL(`${prefix}/proxy/hls/manifest.m3u8`, `${publicProto}://${publicHost}`);
        const password = (0, utils_1.envGet)('MEDIA_FLOW_PROXY_PASSWORD') || 'aetheria-link-secret';
        url.searchParams.set('api_password', password);
        url.searchParams.set('d', master.href);
        for (const [name, value] of Object.entries(Dailymotion_1.DAILYMOTION_METADATA_HEADERS)) {
            url.searchParams.set('h_' + name.toLowerCase(), value);
        }
        return url;
    }
    proxy(req, res) {
        // CORS preflight from web players (cross-origin Range fetches).
        if (req.method === 'OPTIONS') {
            res.status(204).set({
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
            }).end();
            return;
        }
        const upstreamUrl = new URL(req.originalUrl, this.upstreamBase());
        // Mirror exactly what utils/context.ts#resolveHostUrl does so the base
        // MFP rewrites segment URLs into matches the origin players use.
        // req.headers.host (NOT express 4's req.host, which strips the port) so
        // non-default ports survive into MFP's rewritten URLs.
        const publicProto = firstForwarded(req.headers['x-forwarded-proto']) || req.protocol;
        const publicHost = firstForwarded(req.headers['x-forwarded-host']) || req.headers.host || req.host;
        const headers = {};
        for (const [name, value] of Object.entries(req.headers)) {
            if (value === undefined)
                continue;
            if (SKIP_REQUEST_HEADERS.has(name.toLowerCase()))
                continue;
            headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
        }
        headers['x-forwarded-proto'] = publicProto;
        headers['x-forwarded-host'] = publicHost;
        const doRequest = upstreamUrl.protocol === 'https:' ? node_https_1.request : node_http_1.request;
        const agent = upstreamUrl.protocol === 'https:' ? httpsAgent : httpAgent;
        const upstream = doRequest(upstreamUrl, { method: req.method, agent, headers }, (upstreamRes) => {
            const status = upstreamRes.statusCode ?? 502;
            res.status(status);
            for (const [name, value] of Object.entries(upstreamRes.headers)) {
                if (value === undefined)
                    continue;
                if (SKIP_RESPONSE_HEADERS.has(name.toLowerCase()))
                    continue;
                res.setHeader(name, Array.isArray(value) ? value.join(', ') : value);
            }
            if (req.method === 'HEAD') {
                upstreamRes.resume();
                return;
            }
            upstreamRes.pipe(res);
            upstreamRes.on('error', (err) => {
                this.logger.warn(`MediaFlowProxy upstream stream error: ${err.message}`);
                if (!res.headersSent) {
                    res.status(502).end();
                }
                else {
                    res.destroy();
                }
            });
        });
        // Tear down the upstream pull when the player disconnects (seek/stop).
        req.on('close', () => {
            if (!res.writableEnded) {
                upstream.destroy();
            }
        });
        upstream.on('error', (err) => {
            if (!res.headersSent) {
                this.logger.warn(`MediaFlowProxy upstream error: ${err.code ?? ''} ${err.message}`);
                res.status(502).end('MediaFlow proxy upstream error');
            }
            else {
                res.destroy();
            }
        });
        upstream.end();
    }
}
exports.MediaFlowProxyController = MediaFlowProxyController;
