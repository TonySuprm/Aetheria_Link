import { NotFoundError } from '../error';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { buildMediaFlowProxyHlsUrl, supportsMediaFlowProxy, unpackEval } from '../utils';
import { Extractor } from './Extractor';

/**
 * StreamHG-style hosters (filelions, dramacool.men, perfectcrown.buzz, ...) serve a
 * JW Player page whose stream URLs are hidden inside a Dean Edwards packed (`eval(function(p,a,c,k,e,d)`)
 * JavaScript blob.
 *
 * The page defines a `links` object with up to three sources, e.g.:
 *   var links = {
 *     "hls4": "/stream/<token>/.../master.m3u8",                 // RELATIVE — resolves against the page origin
 *     "hls2": "https://<cdn>.premilkyway.com/hls2/.../master.m3u8?t=...",  // absolute
 *     "hls3": "https://<cdn>.solutiondocumentationhub.site/.../master.txt"  // absolute
 *   };
 *
 * MediaFlow's bundled FileLions extractor grabs the first match (`hls4`) and returns it verbatim.
 * For `hls4` that is a **host-less relative path** — fine in a browser (resolved against the page
 * origin) but it breaks the MediaFlow HLS proxy, which then can't reach any host and returns an
 * empty "# Stream unavailable" manifest. See https://github.com/.../perfectcrown-buzz issue.
 *
 * To stay host-agnostic we resolve the page here: unpack the JS, prefer an absolute `.m3u8`
 * URL (`hls2`), fall back to resolving a relative `hls4`/`sources` URL against the page origin,
 * and hand the resulting **absolute** manifest URL to MediaFlow's HLS proxy.
 */
export class FileLions extends Extractor {
  public readonly id = 'filelions';
  public readonly label = 'FileLions';
  public override viaMediaFlowProxy = true;
  public override lazyExtract = true;

  // StreamHG / filelions family of domains. `perfectcrown.buzz` and `dramacool.men` are the
  // hosts the dramacool/embedload chain lands on; the rest are the public filelions domains.
  private readonly knownDomains = [
    'filelions.online',
    'filelions.to',
    'dramacool.men',
    'perfectcrown.buzz',
    'mivalyo.com',
    'callistanise.com',
  ];

  public override supports(ctx: Context, url: URL): boolean {
    return this.knownDomains.includes(url.host) && supportsMediaFlowProxy(ctx);
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const headers = { Referer: meta.referer ?? url.href };

    const html = await this.fetcher.text(ctx, url, { headers });

    // Stream URLs live inside the packed JS; unpack it (no-op if the page isn't packed).
    const searchIn = html.includes('eval(function(p,a,c,k,e,d)')
      ? (() => {
        try {
          return unpackEval(html);
        } catch {
          return html;
        }
      })()
      : html;

    const streamUrl = this.findAbsoluteStreamUrl(searchIn, url);

    // Hand the absolute manifest URL to MediaFlow's HLS proxy (NOT the /extractor/video endpoint,
    // which would re-trigger the buggy relative-URL extraction in the Rust binary).
    const proxyUrl = buildMediaFlowProxyHlsUrl(ctx, streamUrl, headers);

    return [
      {
        url: proxyUrl,
        format: Format.hls,
        meta: { ...meta, extractorId: this.id },
      },
    ];
  }

  /**
   * Extract a playable, **absolute** master-manifest URL from the unpacked page source.
   *
   * Preference order (matches JW Player's `sources:[{file: links.hls4||links.hls3||links.hls2}]`
   * fallback chain, but we bias toward absolute `.m3u8` so the MediaFlow proxy can reach it):
   *   1. `hls2` (absolute CDN `.m3u8`)  — most reliable across hosters
   *   2. `sources:[{file:"..."}]`        — direct JW Player source, may be absolute
   *   3. `hls4` / `hls3`                 — resolved against the page origin if relative
   *
   * Relative URLs (e.g. `/stream/<token>/master.m3u8`) are resolved against `pageUrl` so the
   * downstream HLS proxy has a real host to fetch from.
   */
  private findAbsoluteStreamUrl(unpacked: string, pageUrl: URL): URL {
    const candidates: string[] = [];

    // Prefer the absolute CDN manifest ("hls2") — it is always fully qualified on StreamHG pages.
    const hls2 = unpacked.match(/["']hls2["']\s*:\s*["']([^"']+)["']/);
    if (hls2?.[1]) candidates.push(hls2[1]);

    // JW Player sources array.
    const sourceFile = unpacked.match(/sources\s*:\s*\[\s*\{\s*(?:file|src)\s*:\s*["']([^"']+)["']/);
    if (sourceFile?.[1]) candidates.push(sourceFile[1]);

    // hls4 / hls3 (frequently relative `/stream/...`).
    for (const key of ['hls4', 'hls3']) {
      const m = unpacked.match(new RegExp(`["']${key}["']\\s*:\\s*["']([^"']+)["']`));
      if (m?.[1]) candidates.push(m[1]);
    }

    for (const raw of candidates) {
      const resolved = this.resolveStreamUrl(raw, pageUrl);
      if (resolved) return resolved;
    }

    // No stream on the page — either a "File Not Found" / "deleted" placeholder, or an
    // unrecognized layout. Throwing NotFoundError makes the base class return [] (no result),
    // rather than surfacing a broken stream to the user.
    throw new NotFoundError(`FileLions: no playable stream URL found on ${pageUrl.host}`);
  }

  /**
   * Resolve a raw stream reference to an absolute `.m3u8` URL.
   * Returns `undefined` for non-media references (e.g. `hls3` `.txt` thumb tracks, ad `.jpg`).
   */
  private resolveStreamUrl(raw: string, pageUrl: URL): URL | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    try {
      const resolved = new URL(trimmed, pageUrl);
      const pathname = resolved.pathname.toLowerCase();
      // Only accept HLS manifests; skip thumbnails/ads (.txt, .jpg, .png).
      if (pathname.endsWith('.m3u8')) {
        return resolved;
      }
    } catch {
      // malformed — ignore
    }
    return undefined;
  }
}
