import bytes from 'bytes';
import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode, Meta } from '../types';
import { Fetcher, findHeight, getTmdbId, getTmdbNameAndYear, Id, isDebridHoster } from '../utils';
import { Source, SourceResult } from './Source';

const SIZE_RE = /([\d.]+)\s*(TB|GB|MB|KB)/i;

const parseSizeBytes = (text: string): number | undefined => {
  const m = text.match(SIZE_RE);
  if (!m) return undefined;
  return bytes.parse(`${m[1]} ${m[2]}`) ?? undefined;
};

const normalize = (str: string): string =>
  str.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

interface ReleaseInfo {
  url: URL;
  title: string;
  height: number | undefined;
  bytes: number | undefined;
}

export class RapidMoviez extends Source {
  public readonly id = 'rapidmoviez';

  public readonly label = 'RapidMoviez';

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.en];

  public readonly baseUrl = 'https://rapidmoviez.lat';

  public override readonly category = 'debrid' as const;

  protected override readonly domainKey = 'rapidmoviez';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  public override async prewarm(ctx: Context): Promise<void> {
    try {
      await this.fetcher.text(ctx, new URL(this.baseUrl));
      this.fetcher.getLogger().info('RapidMoviez: pre-warm complete', ctx);
    } catch (error) {
      this.fetcher.getLogger().warn(`RapidMoviez: pre-warm failed: ${error}`, ctx);
    }
  }

  public async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
    if (!ctx.config.alldebridApiKey && !ctx.config.realdebridApiKey) return [];

    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
    if (!name) return [];

    const mode = type === 'series' ? 's' : 'm';

    const searchHtml = await this.search(ctx, name, mode);
    if (!searchHtml) return [];

    // Try to find the show page link from search results, but fall back to
    // constructing it directly — the show page URL is predictable:
    // /<show-name-with-hyphens>/<mode> (e.g. /house-of-the-dragon/s).
    const slug = name.trim().toLowerCase().split(/\s+/).join('-');
    const showPageUrl = this.findShowPageUrl(searchHtml, name, mode)
      ?? new URL(`/${slug}/${mode}`, this.baseUrl);
    const showHtml = await this.fetchPage(ctx, showPageUrl);
    if (!showHtml) return [];

    const releases = this.parseShowReleases(showHtml, name, year, tmdbId.season, tmdbId.episode);
    if (releases.length === 0) return [];

    this.fetcher.getLogger().info(`RapidMoviez: found ${releases.length} matching releases for "${name}"`, ctx);

    const topReleases = releases.slice(0, 10);

    const results: SourceResult[] = [];

    await Promise.all(
      topReleases.map(async (release) => {
        const links = await this.fetchReleaseLinks(ctx, release.url);
        for (const link of links) {
          const meta: Meta = {
            title: `[RapidMoviez] ${release.title}`,
            height: release.height,
            bytes: release.bytes,
            countryCodes: this.countryCodes,
            sourceLabel: this.label,
            sourceId: this.id,
            season: tmdbId.season,
            episode: tmdbId.episode,
          };
          results.push({ url: link, meta });
        }
      }),
    );

    this.fetcher.getLogger().info(`RapidMoviez: returning ${results.length} result(s) for "${name}"`, ctx);
    return results;
  }

  /** Search via GET (the POST form 302-redirects with '+' in the URL which breaks
   *  axios — `ERR_FR_REDIRECTION_FAILURE`). The redirect target is
   *  `/search/<query>/all/query/<mode>`, so we GET it directly. */
  private async search(ctx: Context, query: string, mode: string): Promise<string | undefined> {
    const slug = query.trim().split(/\s+/).join('-');
    const searchUrl = new URL(`/search/${encodeURIComponent(slug)}/all/query/${mode}`, this.baseUrl);
    try {
      return await this.fetcher.text(ctx, searchUrl, { timeout: 15000 });
    } catch {
      return undefined;
    }
  }

  /** Find the show/movie page link from search results. The link format is
   *  `/<show-slug>/<mode>` (e.g. `/house-of-the-dragon/s`), excluding
   *  /release/, /search/, /tag/, etc. */
  private findShowPageUrl(html: string, name: string, mode: string): URL | undefined {
    const $ = cheerio.load(html);
    const nameClean = normalize(name);
    let showUrl: URL | undefined;

    $('a[href]').each((_i, el) => {
      if (showUrl) return;
      const $el = $(el);
      const href = $el.attr('href') ?? '';
      const title = $el.attr('title') ?? $el.text().trim();

      if (!href.endsWith(`/${mode}`)) return;
      if (href.includes('/release/') || href.includes('/search/') || href.includes('/tag/')
        || href.includes('/genre/') || href.includes('/category/') || href.includes('/type/')
        || href.includes('/author/') || href.includes('/thumbnail')) return;

      if (title && normalize(title).includes(nameClean)) {
        try {
          showUrl = new URL(href, this.baseUrl);
        } catch { /* invalid URL */ }
      }
    });

    return showUrl;
  }

  private async fetchPage(ctx: Context, url: URL): Promise<string | undefined> {
    try {
      return await this.fetcher.text(ctx, url, { timeout: 15000 });
    } catch {
      return undefined;
    }
  }

  /** Parse the show page for releases matching the requested episode (or movie).
   *  The show page lists all releases in `<li>` elements with
   *  `<a href="/release/<slug>">[RR/NF] Show S03E01 1080p WEB (4.6GB)</a>`. */
  private parseShowReleases(
    html: string,
    name: string,
    year: number,
    season: number | undefined,
    episode: number | undefined,
  ): ReleaseInfo[] {
    const $ = cheerio.load(html);
    const nameClean = normalize(name);
    const releases: ReleaseInfo[] = [];
    const seenHrefs = new Set<string>();

    $('a[href*="/release/"]').each((_i, el) => {
      const $el = $(el);
      const href = $el.attr('href') ?? '';
      const titleText = $el.text().trim();

      if (!titleText || !href) return;

      const titleClean = normalize(titleText);
      if (!titleClean.includes(nameClean)) return;

      if (season && episode) {
        const epMatch = titleText.match(/s0*(\d+)e0*(\d+)/i);
        if (!epMatch?.[1] || !epMatch?.[2] || parseInt(epMatch[1], 10) !== season || parseInt(epMatch[2], 10) !== episode) return;
      }

      if (!season) {
        const yearMatch = titleText.match(/\b(19[89]\d|20\d{2})\b/);
        if (yearMatch && year && Math.abs(parseInt(yearMatch[0], 10) - year) > 1) return;
      }

      if (seenHrefs.has(href)) return;
      seenHrefs.add(href);

      const height = findHeight(titleText);
      const fileSize = parseSizeBytes(titleText);

      try {
        releases.push({
          url: new URL(href, this.baseUrl),
          title: titleText,
          height,
          bytes: fileSize,
        });
      } catch { /* invalid URL */ }
    });

    releases.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    return releases;
  }

  private async fetchReleaseLinks(ctx: Context, releaseUrl: URL): Promise<URL[]> {
    let html: string;
    try {
      html = await this.fetcher.text(ctx, releaseUrl, { timeout: 12000 });
    } catch {
      return [];
    }

    const $ = cheerio.load(html);
    const allUrls: URL[] = [];
    const seenPaths = new Set<string>();

    $('pre.links').each((_i, el) => {
      const inner = $(el).html() ?? '';
      const match = inner.match(/<!--sse-->(.+?)<!--\/sse-->/);
      if (!match?.[1]) return;

      try {
        const url = new URL(match[1].trim());
        // RapidRAR and ClicknUpload posts use rotating mirror domains
        // (rapidrar.cr/cloud/online/space/site, clicknupload.click/link/org/...).
        // RealDebrid (and the common debrid allow-list) recognises the .com/.me
        // canonical domains, so rewrite before passing the link to the debrid
        // extractors. Otherwise each mirror appears as a separate failed link.
        url.host = this.canonicalizeDebridHost(url.host);
        if (!isDebridHoster(url.host)) return;

        const pathKey = url.pathname;
        if (seenPaths.has(pathKey)) return;
        seenPaths.add(pathKey);

        allUrls.push(url);
      } catch { /* invalid URL */ }
    });

    // Return all debrid hoster URLs — the eager extractor resolves each one.
    // Failing hosters are filtered out; working ones become direct streams.
    return allUrls;
  }

  private canonicalizeDebridHost(host: string): string {
    const h = host.toLowerCase();
    if (/^rapidrar\./.test(h)) return 'rapidrar.com';
    if (/^clicknupload\./.test(h)) return 'clicknupload.me';
    return h;
  }
}
