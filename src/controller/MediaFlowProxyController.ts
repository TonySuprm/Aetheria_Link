import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { Request, Response, Router } from 'express';
import winston from 'winston';
import { envGet } from '../utils';
import { DAILYMOTION_METADATA_HEADERS, pickDailymotionMasterHls } from '../extractor/Dailymotion';

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

const httpAgent = new HttpAgent({ keepAlive: true });
const httpsAgent = new HttpsAgent({ keepAlive: true });

const firstForwarded = (value: string | string[] | undefined): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(',')[0]?.trim();
  return first || undefined;
};

export class MediaFlowProxyController {
  public readonly router: Router;

  private readonly logger: winston.Logger;

  public constructor(logger: winston.Logger) {
    this.router = Router();
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

  private upstreamBase(): string {
    const configured = envGet('MEDIA_FLOW_PROXY_URL')?.trim();
    if (!configured) return DEFAULT_UPSTREAM;
    if (configured.startsWith('http://') || configured.startsWith('https://')) return configured;
    return `http://${configured}`;
  }

  /**
   * Play-time Dailymotion resolver (GET /dm/:videoId.m3u8).
   *
   * Fetches the player metadata (which issues a FRESH, short-lived `sec=`
   * manifest token), picks the master HLS manifest, and 302-redirects the
   * player to the MediaFlow HLS proxy wrapping that fresh manifest. Every
   * play costs exactly one metadata call, and the token is never stale —
   * the previous design (baking the manifest into the /stream response)
   * died the moment the token expired and burned Dailymotion's per-link
   * rate limit on retries.
   */
  private dailymotionResolver(req: Request, res: Response): void {
    const videoId = String(req.params['videoId'] || '').replace(/\.m3u8$/i, '');
    if (!/^[a-zA-Z0-9_-]{4,32}$/.test(videoId)) {
      res.status(400).end('invalid dailymotion video id');
      return;
    }

    const upstream = httpsRequest(
      `https://www.dailymotion.com/player/metadata/video/${videoId}`,
      { headers: { ...DAILYMOTION_METADATA_HEADERS, accept: 'application/json' } },
      (upstreamRes: IncomingMessage) => {
        if ((upstreamRes.statusCode ?? 500) >= 400) {
          upstreamRes.resume();
          this.logger.warn(`Dailymotion metadata HTTP ${upstreamRes.statusCode} for ${videoId}`);
          res.status(502).end('dailymotion metadata unavailable');
          return;
        }

        let data = '';
        upstreamRes.setEncoding('utf8');
        upstreamRes.on('data', (c: string) => { data += c; });
        upstreamRes.on('end', () => {
          let master: URL | undefined;
          try {
            master = pickDailymotionMasterHls(JSON.parse(data));
          } catch (e) {
            this.logger.warn(`Dailymotion metadata parse failed for ${videoId}: ${e}`);
          }
          if (!master) {
            res.status(404).end('no dailymotion HLS manifest');
            return;
          }

          res.setHeader('Cache-Control', 'no-store');
          res.redirect(302, this.hlsProxyUrlFor(req, master).href);
        });
        upstreamRes.on('error', () => {
          if (!res.headersSent) res.status(502).end('dailymotion metadata error');
        });
      },
    );

    upstream.on('error', (err) => {
      this.logger.warn(`Dailymotion metadata request error for ${videoId}: ${err.message}`);
      if (!res.headersSent) res.status(502).end('dailymotion metadata error');
    });
    upstream.end();
  }

  /** MediaFlow HLS-proxy URL for `master`, built on the PUBLIC host the player used
   *  (x-forwarded aware, honours x-forwarded-prefix for reverse-proxied mounts). */
  private hlsProxyUrlFor(req: Request, master: URL): URL {
    const publicProto = firstForwarded(req.headers['x-forwarded-proto']) || req.protocol;
    const publicHost = firstForwarded(req.headers['x-forwarded-host']) || req.headers.host || req.host;
    const prefix = (firstForwarded(req.headers['x-forwarded-prefix']) || '').replace(/\/+$/, '');

    const url = new URL(`${prefix}/proxy/hls/manifest.m3u8`, `${publicProto}://${publicHost}`);
    const password = envGet('MEDIA_FLOW_PROXY_PASSWORD') || 'aetheria-link-secret';
    url.searchParams.set('api_password', password);
    url.searchParams.set('d', master.href);
    for (const [name, value] of Object.entries(DAILYMOTION_METADATA_HEADERS)) {
      url.searchParams.set('h_' + name.toLowerCase(), value);
    }
    return url;
  }

  private proxy(req: Request, res: Response): void {
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

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (SKIP_REQUEST_HEADERS.has(name.toLowerCase())) continue;
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
    }
    headers['x-forwarded-proto'] = publicProto;
    headers['x-forwarded-host'] = publicHost;

    const doRequest = upstreamUrl.protocol === 'https:' ? httpsRequest : httpRequest;
    const agent = upstreamUrl.protocol === 'https:' ? httpsAgent : httpAgent;

    const upstream = doRequest(
      upstreamUrl,
      { method: req.method, agent, headers },
      (upstreamRes: IncomingMessage) => {
        const status = upstreamRes.statusCode ?? 502;
        res.status(status);

        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (value === undefined) continue;
          if (SKIP_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
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
          } else {
            res.destroy();
          }
        });
      },
    );

    // Tear down the upstream pull when the player disconnects (seek/stop).
    req.on('close', () => {
      if (!res.writableEnded) {
        upstream.destroy();
      }
    });

    upstream.on('error', (err) => {
      if (!res.headersSent) {
        this.logger.warn(`MediaFlowProxy upstream error: ${(err as NodeJS.ErrnoException).code ?? ''} ${err.message}`);
        res.status(502).end('MediaFlow proxy upstream error');
      } else {
        res.destroy();
      }
    });

    upstream.end();
  }
}
