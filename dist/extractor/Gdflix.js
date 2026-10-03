"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Gdflix = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
// GDFlix (`gdflix.dev/file/<id>`) is a Cloudflare-fronted file host used by WorldFree4u's linkos
// pages as an alternate hoster for qualities whose MultiCloud view page is broken (e.g. the 4K
// page renders a JS "Generating Secure Links…" loader with no server-side hoster anchors).
// The file page lists an `instant.busycdn.xyz` interstitial which 302-redirects to a
// `fastcdn-dl.pages.dev/?url=<google>` wrapper. That `url` param is a Google Drive
// `video-downloads.googleusercontent.com` direct-file URL — the real MKV (Range is rejected with
// 400; a plain GET with a browser UA returns 200 + video/mkv). Because the player always sends
// Range, the google URL is routed through the addon's /relay (plain-GET + local-slice profile,
// like dr1/multidownload.shop), which injects a browser UA and serves the player's Range locally.
const BUSYCDN_RE = /instant\.busycdn\.xyz\//i;
const GOOGLE_VIDEO_RE = /video-downloads\.googleusercontent\.com\//i;
class Gdflix extends Extractor_1.Extractor {
    id = 'gdflix';
    label = 'GDFlix';
    // The google video-downloads URL is freshly generated per file-page visit and is short-lived;
    // keep the resolved /relay result cached only briefly so a stale google token doesn't linger.
    ttl = 300000; // 5m
    // Lazy extraction: the gdflix chain (FlareSolverr for the CF-403 file page + busycdn redirect)
    // takes ~10-15s. Awaiting it inside StreamResolver's per-source `Promise.all` would block ALL of
    // that source's UrlResults (even the fast dr1 ones) past the stream-response deadline, dropping
    // every WorldFree4u stream from the list. Returning an instant /extract/ proxy defers the real
    // FlareSolverr resolution to play-time (ExtractController), so the 4K stream appears in the list
    // immediately and the google URL is resolved fresh on each play (sidestepping its short TTL).
    lazyExtract = true;
    // Pre-warm the extraction at stream-list time (fire-and-forget) so the google /relay URL is
    // already cached when the user hits play — otherwise the first play blocks ~10-15s on FlareSolverr.
    prewarmLazy = true;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return /gdflix\./.test(url.host);
    }
    async extractInternal(ctx, url, meta) {
        // 1. GDFlix file page (Cloudflare 403 → the Fetcher auto-routes through FlareSolverr).
        const html = await this.fetcher.text(ctx, url).catch(() => null);
        if (!html)
            return [];
        const $ = cheerio.load(html);
        const busyHref = this.firstHref($, BUSYCDN_RE);
        if (!busyHref)
            return [];
        // 2. busycdn → HTTP 302 → fastcdn-dl.pages.dev/?url=<google>. Fetch with redirects disabled so
        //    the Location header (carrying the google URL in its `url` query param) is captured rather
        //    than followed (following would land on the fastcdn HTML wrapper, losing the google URL).
        const redirect = await this.fetcher.fetch(ctx, busyHref, { maxRedirects: 0 }).catch(() => null);
        const location = redirect?.headers?.['location'];
        if (!location)
            return [];
        let fastUrl;
        try {
            fastUrl = new URL(location, busyHref.href);
        }
        catch {
            return [];
        }
        const googleHref = fastUrl.searchParams.get('url');
        if (!googleHref || !GOOGLE_VIDEO_RE.test(googleHref))
            return [];
        let googleUrl;
        try {
            googleUrl = new URL(googleHref);
        }
        catch {
            return [];
        }
        // 3. Route through /relay: the google video-downloads URL 400s on Range and requires a browser
        //    UA. The relay sends RELAY_UA + a plain GET and slices the player's Range locally
        //    (same profile as dr1). `video-downloads.googleusercontent.com` is allow-listed for this.
        const relay = new URL('/relay', ctx.hostUrl);
        relay.searchParams.set('url', googleUrl.href);
        return [
            {
                url: relay,
                format: types_1.Format.unknown,
                isExternal: false,
                notWebReady: true,
                label: this.label,
                meta: { ...meta, extractorId: this.id },
            },
        ];
    }
    /** First `<a href>` on the page matching `re`, parsed to a URL. */
    firstHref($, re) {
        let found;
        $('a').each((_, el) => {
            if (found)
                return;
            const href = $(el).attr('href') ?? '';
            if (re.test(href)) {
                try {
                    found = new URL(href);
                }
                catch {
                    // skip invalid
                }
            }
        });
        return found;
    }
}
exports.Gdflix = Gdflix;
