import * as cheerio from 'cheerio';
import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

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

export class Gdflix extends Extractor {
  public override readonly id = 'gdflix';

  public override readonly label = 'GDFlix';

  // The google video-downloads URL is freshly generated per file-page visit and is short-lived;
  // keep the resolved /relay result cached only briefly so a stale google token doesn't linger.
  public override readonly ttl = 300000; // 5m

  // Lazy extraction: the gdflix chain (FlareSolverr for the CF-403 file page + busycdn redirect)
  // takes ~10-15s. Awaiting it inside StreamResolver's per-source `Promise.all` would block ALL of
  // that source's UrlResults (even the fast dr1 ones) past the stream-response deadline, dropping
  // every WorldFree4u stream from the list. Returning an instant /extract/ proxy defers the real
  // FlareSolverr resolution to play-time (ExtractController), so the 4K stream appears in the list
  // immediately and the google URL is resolved fresh on each play (sidestepping its short TTL).
  public override readonly lazyExtract = true;

  // Pre-warm the extraction at stream-list time (fire-and-forget) so the google /relay URL is
  // already cached when the user hits play — otherwise the first play blocks ~10-15s on FlareSolverr.
  public override readonly prewarmLazy = true;

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public override supports(_ctx: Context, url: URL): boolean {
    return /gdflix\./.test(url.host);
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    // 1. GDFlix file page (Cloudflare 403 → the Fetcher auto-routes through FlareSolverr).
    const html = await this.fetcher.text(ctx, url).catch(() => null);
    if (!html) return [];

    const $ = cheerio.load(html);
    const busyHref = this.firstHref($, BUSYCDN_RE);
    if (!busyHref) return [];

    // 2. busycdn → HTTP 302 → fastcdn-dl.pages.dev/?url=<google>. Fetch with redirects disabled so
    //    the Location header (carrying the google URL in its `url` query param) is captured rather
    //    than followed (following would land on the fastcdn HTML wrapper, losing the google URL).
    const redirect = await this.fetcher.fetch(ctx, busyHref, { maxRedirects: 0 }).catch(() => null);
    const location = redirect?.headers?.['location'];
    if (!location) return [];

    let fastUrl: URL;
    try {
      fastUrl = new URL(location, busyHref.href);
    } catch {
      return [];
    }

    const googleHref = fastUrl.searchParams.get('url');
    if (!googleHref || !GOOGLE_VIDEO_RE.test(googleHref)) return [];

    let googleUrl: URL;
    try {
      googleUrl = new URL(googleHref);
    } catch {
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
        format: Format.unknown,
        isExternal: false,
        notWebReady: true,
        label: this.label,
        meta: { ...meta, extractorId: this.id },
      },
    ];
  }

  /** First `<a href>` on the page matching `re`, parsed to a URL. */
  private firstHref($: cheerio.CheerioAPI, re: RegExp): URL | undefined {
    let found: URL | undefined;
    $('a').each((_, el) => {
      if (found) return;
      const href = $(el).attr('href') ?? '';
      if (re.test(href)) {
        try {
          found = new URL(href);
        } catch {
          // skip invalid
        }
      }
    });
    return found;
  }
}
