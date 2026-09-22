import bytes from 'bytes';
import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode, Meta } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

interface DownloadLink {
  url: URL;
  height: number;
  bytes: number | undefined;
  label: string;
}

const SIZE_RE = /([\d.]+)\s*(GB|MB)/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;

// Hoster URLs supported by this add-on's extractor registry.
//   - gdflix `/file/`        → GDFlix extractor (supports `/gdflix\./` host; resolves to Google video-downloads CDN, relayed)
//   - hubcloud `/drive/`|`/video/` (NOT `/packs/`) → HubCloud extractor (supports `/hubcloud/` host; resolves to seekable FSL/FSLv2 servers)
// `links.kmhd.eu` is gated (needs a POST unlock; no extractor) — skipped.
// `drivehub.cfd` has no extractor — skipped.
// `*/pack/`|`*/packs/` → season/episode pack pages (not single playable files) — skipped.
const VALID_HOSTER_RE = /gdflix\.[a-z]+\/file\/|hubcloud\.[a-z]+\/(drive|video)\//i;

/** Parse "480p Links [1GB]" → { height: 480, bytes: ... }. 4K/2160p/1080p/720p only; 480p dropped. */
const parseQuality = (text: string): { height: number; bytes: number | undefined } => {
  let height = 0;
  if (/2160p|4k/i.test(text)) height = 2160;
  else if (/1080p/i.test(text)) height = 1080;
  else if (/720p/i.test(text)) height = 720;
  else if (/480p/i.test(text)) height = 480;

  let parsedBytes: number | undefined;
  const sizeMatch = text.match(SIZE_RE);
  if (sizeMatch) {
    parsedBytes = bytes.parse(`${sizeMatch[1]} ${sizeMatch[2]}`) ?? undefined;
  }
  return { height, bytes: parsedBytes };
};

export class KatMovieHD extends Source {
  public readonly id = 'katmoviehd';
  public readonly label = 'KatMovieHD';
  // Movies only: katmoviehd is primarily a Hindi-dubbed movie site. series posts use gated `links.kmhd.eu`
  // redirect pages + external `drivehub.cfd` hoster (neither has an extractor) and season/episode
  // `gdflix.dev/pack/<id>` / `hubcloud.foo/video/packs/<id>` pack-listing pages (not single
  // playable files). Adding series support would ship broken streams, so it is intentionally omitted.
  public readonly contentTypes: ContentType[] = ['movie'];
  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.hi];
  public readonly baseUrl = 'https://new.katmoviehd.top';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  public override async prewarm(ctx: Context): Promise<void> {
    try {
      await this.fetcher.text(ctx, new URL(this.baseUrl));
      this.fetcher.getLogger().info('KatMovieHD: pre-warm complete', ctx);
    } catch (error) {
      this.fetcher.getLogger().warn(`KatMovieHD: pre-warm failed: ${error}`, ctx);
    }
  }

  private clean(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private get logger() {
    return this.fetcher.getLogger();
  }

  protected async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
    if (type !== 'movie') return [];

    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
    if (!name) return [];

    const postUrl = await this.findPost(ctx, name, year);
    if (!postUrl) {
      this.logger.info(`KatMovieHD: no post matched TMDB "${name}" ${year ?? ''}`, ctx);
      return [];
    }

    const html = await this.fetcher.text(ctx, postUrl, { headers: { Referer: this.baseUrl } });
    const $ = cheerio.load(html);

    const targets = this.collectDownloadLinks($);

    const results: SourceResult[] = [];
    for (const target of targets) {
      // 4K (2160p) + 1080p + 720p only; 480p dropped (matching SSRmovies/Worldfree4u). Users can still
      // exclude a resolution via the add-on's "Exclude resolution" config (StreamResolver honours it downstream).
      if (target.height !== 2160 && target.height !== 1080 && target.height !== 720) continue;

      // No `referer`: matching SSRmovies/4KHDHub format: Setting meta.referer would make
      // StreamResolver attach proxyHeaders (Referer = katmoviehd post) to the lazy /extract URL,
      // forcing Stremio to wrap it through its internal proxy and forward that Referer to the
      // final HubCloud/GDFlix CDN link — which rejects the foreign Referer and playback stalls at 0:00.
      const meta: Meta = {
        countryCodes: this.countryCodes,
        height: target.height,
        title: target.label,
        ...(target.bytes && { bytes: target.bytes }),
        sourceLabel: this.label,
      };

      results.push({ url: target.url, meta });
    }

    return results;
  }

  /**
   * Search the WP site and pick the post whose URL slug starts with the name + matches the year.
   *
   * Matching uses the slug (e.g. "avatar-fire-and-ash-2025-hindi") rather than the card's visible text: each card's `<a>` text begins with a rotated year badge ("2025") before the title, so a `startsWith` check on the text would never match. The slug is clean and also discriminates "avatar-fire-and-ash-2025" from "operation-avatar-fire-and-ash-2025" (whose slug starts with "operation-"). Year is verified against the combined slug + card text.
   *
   * WordPress search returns "no results" when the query carries punctuation such as the subtitle colon in "Avatar: Fire and Ash" (the post exists as slug "avatar-fire-and-ash-2025" but the colon makes WP match nothing). Strip everything but letters/digits/spaces before searching.
   */
  private async findPost(ctx: Context, name: string, year: number | undefined): Promise<URL | undefined> {
    const searchName = name.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
    const searchUrl = new URL(`/?s=${encodeURIComponent(searchName)}`, this.baseUrl);
    let html: string;
    try {
      html = await this.fetcher.text(ctx, searchUrl, { headers: { Referer: this.baseUrl } });
    } catch {
      return undefined;
    }

    const $ = cheerio.load(html);
    const nameClean = this.clean(name);
    const candidates: { href: string; slug: string; text: string }[] = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href.startsWith(`${this.baseUrl}/`)) return;
      if (href.includes('/page/') || href.includes('/category/') || href.includes('/wp-') || href.endsWith('/feed/') || href.includes('/search/')) return;
      const slug = decodeURIComponent(href.replace(`${this.baseUrl}/`, '').replace(/\/+$/, ''));
      if (!slug || slug.includes('.') || slug.includes('/')) return;
      candidates.push({ href, slug, text: $(el).text() });
    });

    for (const { href, slug, text } of candidates) {
      if (!this.clean(slug).startsWith(nameClean)) continue;

      const matchText = `${slug} ${text}`;
      const yearMatch = matchText.match(YEAR_RE);
      if (year && yearMatch) {
        if (Math.abs(parseInt(yearMatch[0], 10) - year) > 1) continue;
      }

      return new URL(href);
    }

    return undefined;
  }

  /**
   * Post page: download links are plain centered `<h2>`/`<h3>` anchors inside the article body (`.entry-content`).
   * Each quality is a separate anchor whose text carries the quality + size, e.g. "1080p 10bit 5.1 Links [4.7GB]".
   * Mirror pairs appear as `2160p WEB SDR [36GB] | GD2` — a second anchor labeled `GD2` is an alternate hoster for the same quality.
   *
   * Only collect hoster URLs supported by this add-on's extractor registry (see VALID_HOSTER_RE above).
   */
  private collectDownloadLinks($: cheerio.CheerioAPI): DownloadLink[] {
    const links: DownloadLink[] = [];
    $('.entry-content a, article a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href) return;
      if (!VALID_HOSTER_RE.test(href)) return;
      // Skip non-file hoster links: season/episode packs + the watch-online player.
      if (/\/packs?\/|\/play\?/i.test(href)) return;
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        return;
      }
      const text = $(el).text().trim();
      if (!text) return;
      const { height, bytes } = parseQuality(text);
      if (!height) return;
      links.push({ url, height, bytes, label: text });
    });

    // Mirror pairs: multiple anchors with the same quality pointing to different hosters → dedup by href.
    const seen = new Set<string>();
    const unique: DownloadLink[] = [];
    for (const link of links) {
      if (seen.has(link.url.href)) continue;
      seen.add(link.url.href);
      unique.push(link);
    }
    return unique;
  }
}
