"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaFlowProxyController = void 0;
const node_http_1 = require("node:http");
const node_https_1 = require("node:https");
const express_1 = require("express");
const utils_1 = require("../utils");
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
        for (const prefix of ['/proxy/*splat', '/extractor/*splat', '/_token_*splat']) {
            this.router.get(prefix, proxyHandler);
            this.router.head(prefix, proxyHandler);
            this.router.options(prefix, proxyHandler);
        }
    }
    upstreamBase() {
        const configured = (0, utils_1.envGet)('MEDIA_FLOW_PROXY_URL')?.trim();
        if (!configured)
            return DEFAULT_UPSTREAM;
        if (configured.startsWith('http://') || configured.startsWith('https://'))
            return configured;
        return `http://${configured}`;
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
        const publicProto = firstForwarded(req.headers['x-forwarded-proto']) || req.protocol;
        const publicHost = firstForwarded(req.headers['x-forwarded-host']) || req.host;
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
