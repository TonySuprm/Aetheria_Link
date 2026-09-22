import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { Semaphore, SemaphoreInterface } from 'async-mutex';
import { Request, Response, Router } from 'express';
import winston from 'winston';

/**
 * Stream-relay controller.
 *
 * Two upstream profiles, selected by the entry host:
 *
 * 1. Plain-GET + local Range-slice (dl.dramasuki.xyz, krakencloud.net, pixeldrain.com,
 *    mixdrop). These hosts reject ranged requests: dl.dramasuki.xyz is a Google-Drive-backed
 *    goindex that returns HTTP 403 ("download quota exceeded") on Range. The relay issues a
 *    single plain GET (no Range) upstream and honours the player's Range locally, retrying
 *    transient quota 403/429/5xx.
 *
 * 2. Range-forward + redirect-follow (111477.xyz). 111477 serves raw files but redirects
 *    (307, with NO CORS headers) via p.111477.xyz to a *.workers.dev CDN. Stremio's
 *    Chromium player blocks that cross-origin redirect, so the file URL cannot be handed to
 *    the player directly. The relay follows the redirect chain server-side, forwards the
 *    player's Range upstream (the workers.dev CDN honours 206) and passes the 206 through
 *    verbatim — seekable playback with no full-file download. The addon's global CORS
 *    middleware (src/index.ts) adds `Access-Control-Allow-Origin: *` to the relay response,
 *    so Stremio can fetch it.
 *
 *    Rate-limit bypass (worker rotation): p.111477.xyz ROTATES the *.workers.dev subdomain on
 *    every resolve, and the CDN 429-throttles per worker under the burst of Range seeks a
 *    player fires at start (which stalls playback at 0:00). The relay therefore NEVER pins a
 *    resolved worker — it re-resolves the chain fresh on every request AND on every 429 retry,
 *    so the player's seeks spread across different workers and no single worker gets bursted.
 *
 *   GET /<config>/relay?url=<file-url>&referer=<referer>
 *   GET /relay?url=<file-url>&referer=<referer>
 *
 * Only allow-listed entry hosts are accepted so the endpoint can't be turned into an open
 * proxy. Redirects are followed from an allow-listed entry (the target is chosen by the
 * trusted entry host, not by the caller).
 */

// `multidownload.shop` is MultiCloud's "Turbo Download" CDN (dr1.multidownload.shop). It serves the
// real MKV (incl. 1080p/4K) via a plain GET, but ONLY when the request carries the MultiCloud view
// page as Referer (else 403). Despite advertising Accept-Ranges on HEAD, it returns 500 on a ranged
// GET, so it uses the plain-GET + local-slice profile (like dl.dramasuki.xyz): the relay fetches the
// file without Range and honours the player's Range locally. WorldFree4u routes it through
// /relay?referer=<view-page> so the referer is injected server-side.
// `video-downloads.googleusercontent.com` is the Google Drive direct-file CDN reached via GDFlix's
// busycdn → fastcdn-dl chain (GDFlix extractor). It serves the real MKV (incl. 4K) on a plain GET
// with a browser UA but 400s on Range, so it uses the plain-GET + local-slice profile like dr1.
// `video-downloads.googleusercontent.com` is the Google Drive direct-file CDN reached via GDFlix's
// busycdn → fastcdn-dl chain (GDFlix extractor). It serves the real MKV (incl. 4K) on a plain GET
// with a browser UA but 400s on Range, so it uses the plain-GET + local-slice profile like dr1.
// `drive.usercontent.google.com` is the Google Drive public-download CDN reached via the Kayoanime
// source (it lists a public folder's files via `embeddedfolderview` then streams each by file id).
// Unlike video-downloads, this host HONOURS HTTP Range (206 + Content-Range, CORS-open), so it uses
// the range-forward profile: the player's Range is forwarded and the upstream 206 passed through —
// fully seekable. The relay's browser UA + 403/429 retry also absorbs Google's transient quota errors.
const ALLOWED_HOSTS = ['dl.dramasuki.xyz', 'krakencloud.net', 'pixeldrain.com', 'mixdrop', 'mixpt.com', '111477.xyz', 'vadapav.mov', 'multidownload.shop', 'video-downloads.googleusercontent.com', 'drive.usercontent.google.com'];

// Entry hosts whose upstream supports HTTP Range (and may redirect to a CDN). For these the
// player's Range is forwarded upstream and the upstream 206 is passed through. Other allow-
// listed hosts (incl. multidownload.shop, which 500s on Range) keep the plain-GET + local-slice profile.
const RANGE_FORWARD_ENTRIES = ['111477.xyz', 'vadapav.mov', 'drive.usercontent.google.com'];
const isRangeForwardEntry = (host: string): boolean => RANGE_FORWARD_ENTRIES.some(h => host.includes(h));

const UPSTREAM_TIMEOUT_MS = 30_000;
const RELAY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 6;

const httpsAgent = new HttpsAgent({ keepAlive: true });
const httpAgent = new HttpAgent({ keepAlive: true });

// Cache of resolved *.workers.dev targets keyed by the original entry file URL. p.111477.xyz/bulk
// (the token-minting hop) is slow and rate-limits the caller's IP, so re-resolving the chain on
// every Range seek would make every seek slow AND trigger p.111477.xyz's own throttle. The token
// in the resolved workers.dev URL is reusable for a while, so we cache it and reuse it for
// successive seeks -> seeks 2+ skip p.111477.xyz entirely (instant). On a 429 from the cached
// worker the cache is dropped and the chain re-resolves (p.111477.xyz rotates the worker subdomain
// -> rotation bypass). TTL is conservative because the token eventually expires.
const redirectCache = new Map<string, { url: string; expires: number }>();
const REDIRECT_CACHE_TTL = 10 * 60 * 1000; // 10 min

// Per-file concurrency cap. Stremio/ffmpeg fires a BURST of Range seeks at start-of-playback
// (header, moov/cues, first data). Funneling all of them onto the cached workers.dev worker at
// once trips the CDN's per-worker/per-IP burst 429 — which stalls playback at 0:00 and, once the
// IP is throttled, makes even rotated workers 429. Capping concurrent relay fetches PER FILE to
// 2 spreads the burst (the rest queue briefly; each seek is tiny and completes in ms) so the
// burst detector never trips. 2 still allows a long data stream + 1 seek concurrently (no
// 0:00 stall), and different files/episodes get independent semaphores (don't block each other).
const FILE_CONCURRENCY = 2;

export class RelayController {
  public readonly router: Router;

  private readonly logger: winston.Logger;
  private readonly fileSemaphores = new Map<string, SemaphoreInterface>();

  private getSemaphore(key: string): SemaphoreInterface {
    let sem = this.fileSemaphores.get(key);
    if (!sem) {
      sem = new Semaphore(FILE_CONCURRENCY);
      this.fileSemaphores.set(key, sem);
    }
    return sem;
  }

  public constructor(logger: winston.Logger) {
    this.router = Router();
    this.logger = logger;

    this.router.get('/relay', this.relay.bind(this));
    this.router.get('/relay/:filename', this.relay.bind(this));

    this.router.get('/:config/relay', this.relay.bind(this));
    this.router.get('/:config/relay/:filename', this.relay.bind(this));
  }

  private async relay(req: Request, res: Response): Promise<void> {
    const rawUrl = (req.query['url'] as string | undefined) ?? '';
    const referer = (req.query['referer'] as string | undefined) ?? '';

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      res.status(400).send('Invalid url');
      return;
    }

    // Allow-list: only relay known streaming endpoints that require header injection
    if (!ALLOWED_HOSTS.some(host => url.host.includes(host))) {
      res.status(403).send('Host not allowed');
      return;
    }

    const forwardRange = isRangeForwardEntry(url.host);
    const rangeHeader = req.headers['range'] as string | undefined;

    // Cap concurrent relay fetches per file (see FILE_CONCURRENCY). Acquired before any upstream
    // attempt and released when the response ends (including abort/error), so a player disconnect
    // never leaks a slot. Different files get independent semaphores.
    const semaphore = this.getSemaphore(rawUrl);
    const [, releaseSlot] = await semaphore.acquire();
    let slotReleased = false;
    const releaseSlotOnce = (): void => {
      if (!slotReleased) {
        slotReleased = true;
        releaseSlot();
      }
    };
    res.on('close', releaseSlotOnce);
    res.on('finish', releaseSlotOnce);

    // Test-only override: redirect the (allow-listed) host to a local mock upstream so the
    // relay's Range-translation / redirect logic can be unit-tested without the real hosts.
    const testUpstream = process.env['RELAY_TEST_UPSTREAM'];
    // Entry URL = the allow-listed host's file URL (or the test mock). On a 429 from a resolved
    // CDN worker the retry resets back to this so the redirect chain re-resolves — p.111477.xyz
    // ROTATES the *.workers.dev subdomain per resolve, so a fresh resolve lands on a DIFFERENT
    // worker and escapes the throttled one. This is the rate-limit bypass: never pin one worker.
    const makeEntryUrl = (): URL => testUpstream ? new URL(url.pathname + url.search, testUpstream) : new URL(rawUrl);
    let requestUrl: URL = makeEntryUrl();

    // Track the currently-active upstream so a player disconnect (e.g. on seek) tears it down
    // and we don't keep pulling a multi-GB file nobody is reading.
    let activeUpstream: { destroy: () => void } | undefined;
    let aborted = false;
    req.on('close', () => {
      aborted = true;
      activeUpstream?.destroy();
    });

    // Short-circuit: if a prior request already resolved the final workers.dev target for this
    // file, jump straight to it. This skips the slow p.111477.xyz/bulk token-mint hop on seeks
    // 2+ (the player fires several Range seeks at start), which is what makes playback feel
    // instant after the first byte. On a 429 from the cached worker the retry path below drops
    // the cache and re-resolves a fresh (rotated) worker.
    if (!testUpstream) {
      const cached = redirectCache.get(rawUrl);
      if (cached && cached.expires > Date.now()) {
        this.logger.info(`Relay: using cached worker for ${rawUrl}`);
        requestUrl = new URL(cached.url);
      }
    }

    // Total attempts budget. The workers.dev CDN throttles with 429 under burst load (especially
    // when Stremio's ffmpeg fires several Range seeks in quick succession), so we keep a generous
    // retry budget and re-resolve a FRESH worker (p.111477.xyz rotates them) on each retry.
    const MAX_ATTEMPTS = 6;

    // Backoff for a transient retry. On 429 we ROTATE to a different worker (p.111477.xyz rotates
    // the *.workers.dev subdomain), whose quota is independent of the one that just throttled us —
    // so we do NOT honour the throttled worker's Retry-After (often 8-60s → "forever" to the
    // player). A short backoff is enough to land on a fresh, unthrottled worker fast. 403 quota /
    // 5xx flake: keep it snappy (400ms, 600ms, ...).
    const backoffMs = (attempt: number, status: number | undefined): number => {
      if (status === 429) {
        return Math.min(1500, 300 * 2 ** attempt);
      }
      return 400 + attempt * 200;
    };

    const attemptUpstream = (remaining: number, redirects: number): void => {
      if (aborted) {
        return;
      }
      const doRequest = requestUrl.protocol === 'https:' ? httpsRequest : httpRequest;
      const agent = requestUrl.protocol === 'https:' ? httpsAgent : httpAgent;

      const headers: Record<string, string> = {
        'User-Agent': RELAY_UA,
        'Accept': '*/*',
        ...(referer ? { Referer: referer } : {}),
      };
      // Google Drive Private Drive resources (Kayoanime) require the requesting account's cookies.
      // When GDRIVE_COOKIE is configured, forward it on googleusercontent download requests so the
      // relay can stream private/group-shared files the way a logged-in browser would.
      const gdriveCookie = process.env['GDRIVE_COOKIE']?.trim();
      if (gdriveCookie && url.host.includes('drive.usercontent.google.com')) {
        headers['Cookie'] = gdriveCookie;
      }
      // Range-forward profile: pass the player's Range upstream (the CDN honours 206).
      // Plain-GET profile: never send Range upstream (GDrive quota rejects it with 403).
      if (forwardRange && rangeHeader) {
        headers['Range'] = rangeHeader;
      }

      const upstream = doRequest(
        requestUrl,
        {
          method: 'GET',
          agent,
          timeout: UPSTREAM_TIMEOUT_MS,
          headers,
        },
        (upstreamRes: IncomingMessage) => {
          activeUpstream = upstreamRes;
          const status = upstreamRes.statusCode ?? 502;

          // Follow 3xx redirects (111477.xyz -> p.111477.xyz -> *.workers.dev). The entry
          // host was already allow-listed; the redirect target is chosen by that trusted host.
          if (status >= 300 && status < 400 && upstreamRes.headers.location && redirects < MAX_REDIRECTS) {
            upstreamRes.resume();
            try {
              requestUrl = new URL(upstreamRes.headers.location, requestUrl);
            } catch {
              if (!res.headersSent) res.status(502).send('Bad redirect');
              return;
            }
            attemptUpstream(remaining, redirects + 1);
            return;
          }

          // 403/429/5xx is usually transient quota throttling — retry if attempts remain.
          if ((status === 403 || status === 429 || status >= 500) && remaining > 0) {
            upstreamRes.resume();
            // Drop the cached worker (if any) and re-resolve from the entry host. p.111477.xyz
            // rotates the *.workers.dev subdomain per resolve, so a fresh chain lands on a
            // DIFFERENT worker — escaping whichever worker just throttled us. Reset redirects
            // so the full chain re-resolves.
            redirectCache.delete(rawUrl);
            requestUrl = makeEntryUrl();
            const delay = backoffMs(MAX_ATTEMPTS - remaining, status);
            this.logger.info(`Relay upstream ${status}, re-resolving rotated worker in ${delay}ms (${remaining} left)`);
            setTimeout(() => attemptUpstream(remaining - 1, 0), delay);
            return;
          }

          if (status >= 400) {
            redirectCache.delete(rawUrl);
            this.logger.warn(`Relay upstream ${status} for ${requestUrl.pathname}`);
            res.status(status).send(`Upstream ${status}`);
            upstreamRes.resume();
            return;
          }

          // Success: cache the resolved worker URL so subsequent Range seeks reuse it directly
          // (skipping the slow p.111477.xyz/bulk token-mint hop). Only cache range-forward
          // redirecting entries (111477.xyz) — the plain-GET slice hosts have no redirect chain.
          if (forwardRange && !testUpstream) {
            redirectCache.set(rawUrl, { url: requestUrl.href, expires: Date.now() + REDIRECT_CACHE_TTL });
          }

          if (forwardRange) {
            this.passThrough(upstreamRes, req, res);
          } else {
            this.serveSlicedRange(upstreamRes, req, res);
          }
        },
      );
      activeUpstream = upstream;

      upstream.on('error', (err) => {
        if (!res.headersSent && remaining > 0) {
          const delay = backoffMs(MAX_ATTEMPTS - remaining, undefined);
          this.logger.info(`Relay request error (${err}), retrying in ${delay}ms (${remaining} left)`);
          setTimeout(() => attemptUpstream(remaining - 1, redirects), delay);
          return;
        }
        if (!res.headersSent) {
          res.status(502).send('Upstream request error');
        }
        this.logger.warn(`Relay request error: ${err}`);
      });

      upstream.on('timeout', () => {
        upstream.destroy();
        if (!res.headersSent && remaining > 0) {
          const delay = backoffMs(MAX_ATTEMPTS - remaining, undefined);
          this.logger.info(`Relay upstream timeout, retrying in ${delay}ms (${remaining} left)`);
          setTimeout(() => attemptUpstream(remaining - 1, redirects), delay);
          return;
        }
        if (!res.headersSent) {
          res.status(504).send('Upstream timeout');
        }
      });

      // http.request (unlike http.get) does not auto-send — flush the request now that headers are set.
      upstream.end();
    };

    // Kick off the first attempt with a generous retry budget (see MAX_ATTEMPTS above) to ride out
    // flaky quota 403s and Cloudflare 429 rate-limits on the workers.dev CDN.
    attemptUpstream(MAX_ATTEMPTS, 0);
  }

  /**
   * Range-forward profile: pass the upstream 200/206 straight through to the player. The
   * addon's global CORS middleware adds `Access-Control-Allow-Origin: *`, which is the whole
   * point — Stremio's Chromium player can fetch the (same-addon-origin) relay URL.
   */
  private passThrough(upstreamRes: IncomingMessage, req: Request, res: Response): void {
    res.status(upstreamRes.statusCode ?? 200);

    let forcedContentType = upstreamRes.headers['content-type'] ?? 'application/octet-stream';
    if (req.path.toLowerCase().endsWith('.mkv')) {
      forcedContentType = 'video/x-matroska';
    } else if (req.path.toLowerCase().endsWith('.mp4')) {
      forcedContentType = 'video/mp4';
    } else if (req.path.toLowerCase().endsWith('.avi')) {
      forcedContentType = 'video/x-msvideo';
    }

    res.setHeader('Content-Type', forcedContentType);
    res.setHeader('Accept-Ranges', 'bytes');
    const contentLength = upstreamRes.headers['content-length'];
    const contentRange = upstreamRes.headers['content-range'];
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', contentLength);
    }
    if (contentRange !== undefined) {
      res.setHeader('Content-Range', contentRange);
    }

    upstreamRes.pipe(res);

    upstreamRes.on('error', (err) => {
      this.logger.warn(`passThrough upstream error: ${err}`);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
  }

  /**
   * Plain-GET profile (dl.dramasuki.xyz etc.): the upstream was fetched without Range, so
   * honour the player's Range locally by slicing the streamed body and responding 206.
   */
  private serveSlicedRange(upstreamRes: IncomingMessage, req: Request, res: Response): void {
    const totalHeader = upstreamRes.headers['content-length'];
    const contentType = upstreamRes.headers['content-type'] ?? 'application/octet-stream';
    const total = totalHeader ? parseInt(totalHeader, 10) : undefined;

    // Large no-Range upstream: the local-slice "seekability" is synthetic — every seek re-fetches
    // from byte 0 because the upstream ignores Range (e.g. GDFlix's google
    // video-downloads.googleusercontent.com returns 200 from byte 0 regardless of any Range header).
    // For a huge file (a 4K MKV of 21.9GB) ffmpeg seeks forward to the Matroska Cues during header
    // parsing (here ~1.9GB in), which would force the relay to download ~1.9GB before serving a
    // single sought byte -> playback stuck at 0:00. Serve a genuinely NON-SEEKABLE 200 stream
    // instead: omit Accept-Ranges/Content-Range and ignore the player's Range. ffmpeg then marks the
    // input non-seekable, skips the Cues seek, and plays sequentially from the start. Seeking is
    // disabled, but the movie plays - the only sane trade-off for a no-Range upstream of this size.
    // Overridable via RELAY_NON_SEEKABLE_THRESHOLD (bytes) for testing.
    const nonSeekableThreshold = Number(process.env['RELAY_NON_SEEKABLE_THRESHOLD']) > 0
      ? Number(process.env['RELAY_NON_SEEKABLE_THRESHOLD'])
      : 128 * 1024 * 1024; // 128MB
    if (total !== undefined && total > nonSeekableThreshold) {
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', total);
      upstreamRes.pipe(res);
      upstreamRes.on('error', () => {
        if (!res.headersSent) {
          res.status(502).end();
        } else {
          res.destroy();
        }
      });
      return;
    }

    // Honour the player's Range locally: if it asked for a byte range, slice the streamed body
    // accordingly and respond 206 Partial Content.
    const rangeHeader = req.headers['range'] as string | undefined;
    const range = parseRange(rangeHeader, total);

    res.status(range ? 206 : 200);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    if (total !== undefined) {
      res.setHeader('Content-Length', range ? range.length : total);
    }
    if (range && total !== undefined) {
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
    }

    let bytesSkipped = 0;
    let bytesWritten = 0;
    // backpressure-safe piping: pause upstream when the client can't keep up.
    const onData = (chunk: Buffer): void => {
      if (res.destroyed || res.writableEnded) {
        upstreamRes.destroy();
        return;
      }
      let out = chunk;
      if (range) {
        const absStart = bytesSkipped;
        const absEnd = bytesSkipped + chunk.length;
        if (absEnd <= range.start || absStart > range.end) {
          out = Buffer.alloc(0); // before/after the requested range
        } else {
          const from = Math.max(0, range.start - absStart);
          const to = Math.min(chunk.length, range.end + 1 - absStart);
          out = chunk.subarray(from, to);
        }
        bytesWritten += out.length;
        if (bytesWritten >= range.length) {
          // we've delivered the full requested range — end the response and stop reading upstream
          if (out.length > 0) {
            res.write(out);
          }
          res.end();
          upstreamRes.destroy();
          return;
        }
      }
      bytesSkipped += chunk.length;
      if (out.length > 0) {
        const ok = res.write(out);
        if (!ok) {
          upstreamRes.pause();
          res.once('drain', () => upstreamRes.resume());
        }
      }
    };

    upstreamRes.on('data', onData);
    upstreamRes.on('end', () => res.end());
    upstreamRes.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).send('Upstream stream error');
      } else {
        res.destroy();
      }
      this.logger.warn(`Relay stream error: ${err}`);
    });
  }
}

/** Parse a `Range: bytes=start-end` header into a clamped [start,end] (inclusive). */
function parseRange(rangeHeader: string | undefined, total: number | undefined): { start: number; end: number; length: number } | undefined {
  if (!rangeHeader || total === undefined) {
    return undefined;
  }
  const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!m) {
    return undefined;
  }
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : total - 1;
  if (rangeHeader.startsWith('bytes=-')) {
    // suffix range: bytes=-N → last N bytes
    const n = parseInt(m[2] ?? '0', 10) || 0;
    start = Math.max(0, total - n);
    end = total - 1;
  }
  if (start < 0) {
    start = 0;
  }
  if (end >= total) {
    end = total - 1;
  }
  if (start > end) {
    return undefined;
  }
  return { start, end, length: end - start + 1 };
}
