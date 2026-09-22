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
    .replace(/\./g, ' ')
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const EXCLUDED_PATH_PATTERNS = ['/payment', '/account/registration', '/register', '/ref/'];

interface PostInfo {
  url: URL;
  title: string;
  height: number | undefined;
}

interface PostLink {
  url: URL;
  height: number | undefined;
  bytes: number | undefined;
}

export class OneDDL extends Source {
  public readonly id = 'oneddl';

  public readonly label = '1DDL';

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.en];

  public readonly baseUrl = 'https://1ddl.org';

  public override readonly category = 'debrid' as const;

  protected override readonly domainKey = 'oneddl';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  public override async prewarm(ctx: Context): Promise<void> {
    try {
      await this.fetcher.text(ctx, new URL(this.baseUrl));
      this.fetcher.getLogger().info('1DDL: pre-warm complete', ctx);
    } catch (error) {
      this.fetcher.getLogger().warn(`1DDL: pre-warm failed: ${error}`, ctx);
    }
  }

  public async handleInternal(ctx: Context, _type: ContentType, id: Id): Promise<SourceResult[]> {
    if (!ctx.config.alldebridApiKey && !ctx.config.realdebridApiKey) return [];

    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
    if (!name) return [];

    const searchHtml = await this.search(ctx, name);
    if (!searchHtml) return [];

    const posts = this.parseSearchResults(searchHtml, name, year, tmdbId.season, tmdbId.episode);
    if (posts.length === 0) {
      const articleCount = (searchHtml.match(/class="column is-12 article"/g) ?? []).length;
      this.fetcher.getLogger().info(`1DDL: 0 matching posts for "${name}" (searched ${articleCount} articles, S${tmdbId.season}E${tmdbId.episode})`, ctx);
      return [];
    }

    this.fetcher.getLogger().info(`1DDL: found ${posts.length} matching posts for "${name}"`, ctx);

    const topPosts = posts.slice(0, 10);

    const results: SourceResult[] = [];

    await Promise.all(
      topPosts.map(async (post) => {
        const links = await this.fetchPostLinks(ctx, post.url);
        for (const link of links) {
          const meta: Meta = {
            title: `[1DDL] ${post.title}`,
            height: link.height ?? post.height,
            bytes: link.bytes,
            countryCodes: this.countryCodes,
            sourceLabel: this.label,
            sourceId: this.id,
            season: tmdbId.season,
            episode: tmdbId.episode,
          };
          results.push({ url: link.url, meta });
        }
      }),
    );

    this.fetcher.getLogger().info(`1DDL: returning ${results.length} result(s) for "${name}"`, ctx);
    return results;
  }

  private async search(ctx: Context, query: string): Promise<string | undefined> {
    const slug = query.trim().split(/\s+/).join('-');

    const pagePromises: Promise<string | undefined>[] = [];
    for (let page = 1; page <= 3; page++) {
      const searchUrl = new URL(`/search/${encodeURIComponent(slug)}`, this.baseUrl);
      if (page > 1) searchUrl.searchParams.set('page', String(page));
      pagePromises.push(
        this.fetcher.text(ctx, searchUrl, { timeout: 15000 })
          .catch(() => undefined),
      );
    }

    const pages = await Promise.all(pagePromises);
    const combined = pages.filter((p): p is string => !!p).join('\n');
    return combined || undefined;
  }

  private parseSearchResults(
    html: string,
    name: string,
    year: number,
    season: number | undefined,
    episode: number | undefined,
  ): PostInfo[] {
    const $ = cheerio.load(html);
    const nameClean = normalize(name);
    const posts: PostInfo[] = [];
    const seenHrefs = new Set<string>();

    const collect = (titleText: string, href: string) => {
      if (!titleText || !href) return;

      const titleClean = normalize(titleText);
      if (!titleClean.includes(nameClean)) return;

      if (!season) {
        const yearMatch = titleText.match(/\b(19[89]\d|20\d{2})\b/);
        if (yearMatch && year && Math.abs(parseInt(yearMatch[0], 10) - year) > 1) return;
      }

      if (season && episode) {
        const epMatch = titleText.match(/s0*(\d+)e0*(\d+)/i);
        if (!epMatch?.[1] || !epMatch?.[2] || parseInt(epMatch[1], 10) !== season || parseInt(epMatch[2], 10) !== episode) return;
      }

      if (season && episode && !/s0*\d+e0*\d+/i.test(titleText) && /complete|pack|s0*\d+\s*complete/i.test(titleText)) return;

      if (seenHrefs.has(href)) return;
      seenHrefs.add(href);

      const height = findHeight(titleText);

      try {
        posts.push({
          url: new URL(href, this.baseUrl),
          title: titleText.replace(/\./g, ' ').replace(/\s+/g, ' ').trim(),
          height,
        });
      } catch { /* invalid URL */ }
    };

    $('.article h2.title a').each((_i, el) => {
      const $el = $(el);
      const title = $el.attr('title') ?? $el.text().trim();
      collect(title, $el.attr('href') ?? '');
    });

    if (posts.length === 0) {
      $('h2 a, h1 a').each((_i, el) => {
        const $el = $(el);
        const title = $el.attr('title') ?? $el.text().trim();
        collect(title, $el.attr('href') ?? '');
      });
    }

    return posts;
  }

  private async fetchPostLinks(ctx: Context, postUrl: URL): Promise<PostLink[]> {
    let html: string;
    try {
      html = await this.fetcher.text(ctx, postUrl, { timeout: 12000 });
    } catch {
      return [];
    }

    const $ = cheerio.load(html);
    const allUrls: URL[] = [];
    const seenHrefs = new Set<string>();

    const contentText = $('.content.item-content').text();
    const postBytes = parseSizeBytes(contentText);

    const resMatch = contentText.match(/(\d{3,4})\s*[*x]\s*(\d{3,4})/);
    const contentHeight = resMatch?.[2] ? parseInt(resMatch[2], 10) : undefined;

    const collectLink = (href: string) => {
      if (!href) return;

      try {
        const url = new URL(href);
        if (!isDebridHoster(url.host)) return;

        if (/\.part\d+\.rar/i.test(url.pathname)) return;

        if (EXCLUDED_PATH_PATTERNS.some(p => url.pathname.toLowerCase().includes(p))) return;

        if (seenHrefs.has(url.href)) return;
        seenHrefs.add(url.href);

        allUrls.push(url);
      } catch { /* invalid URL */ }
    };

    $('.multi-link a[href]').each((_i, el) => {
      collectLink($(el).attr('href') ?? '');
    });

    if (allUrls.length === 0) {
      $('.content.item-content a[href]').each((_i, el) => {
        collectLink($(el).attr('href') ?? '');
      });
    }

    // Return all debrid hoster URLs — the eager extractor resolves each one.
    // Failing hosters are filtered out; working ones become direct streams.
    if (allUrls.length === 0) return [];
    return allUrls.map(url => ({ url, height: contentHeight, bytes: postBytes }));
  }
}
