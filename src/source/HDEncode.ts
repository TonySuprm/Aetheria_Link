import bytes from 'bytes';
import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode, Meta } from '../types';
import {
  Fetcher,
  findHeight,
  getTmdbId,
  getTmdbNameAndYear,
  Id,
  isDebridHoster,
  pickBestHoster,
} from '../utils';
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

interface ReleaseItem {
  title: string;
  url: URL;
  height: number | undefined;
  bytes: number | undefined;
}

export class HDEncode extends Source {
  public readonly id = 'hdencode';

  public readonly label = 'HDEncode';

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.en];

  public readonly baseUrl = 'https://hdencode.org';

  public override readonly category = 'debrid' as const;

  protected override readonly domainKey = 'hdencode';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  public override async prewarm(ctx: Context): Promise<void> {
    try {
      await this.fetcher.text(ctx, new URL(this.baseUrl));
      this.fetcher.getLogger().info('HDEncode: pre-warm complete', ctx);
    } catch (error) {
      this.fetcher.getLogger().warn(`HDEncode: pre-warm failed: ${error}`, ctx);
    }
  }

  public async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
    if (!ctx.config.alldebridApiKey && !ctx.config.realdebridApiKey) return [];

    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
    if (!name) return [];

    const rss = await this.search(ctx, name);
    if (!rss) return [];

    const items = this.parseRss(rss, name, year, type, tmdbId.season, tmdbId.episode);
    if (items.length === 0) {
      this.fetcher.getLogger().info(`HDEncode: 0 matching releases for "${name}"`, ctx);
      return [];
    }

    // Prefer higher resolution, then larger file size.
    items.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bytes ?? 0) - (a.bytes ?? 0));

    const results: SourceResult[] = items.map((item) => {
      const cleanTitle = item.title
        .replace(/\s*[-–]\s*[\d.]+\s*(?:GB|MB|KB|TB)\s*$/i, '')
        .replace(/\./g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const meta: Meta = {
        title: `[HDEncode] ${cleanTitle}`,
        height: item.height,
        bytes: item.bytes,
        countryCodes: this.countryCodes,
        sourceLabel: this.label,
        sourceId: this.id,
        season: tmdbId.season,
        episode: tmdbId.episode,
      };

      return { url: item.url, meta };
    });

    this.fetcher.getLogger().info(
      `HDEncode: returning ${results.length} result(s) for "${name}"`,
      ctx,
    );
    return results;
  }

  private async search(ctx: Context, query: string): Promise<string | undefined> {
    const slug = query.trim().split(/\s+/).map(encodeURIComponent).join('+');

    const pagePromises: Promise<string | undefined>[] = [];
    for (let page = 1; page <= 3; page++) {
      const searchUrl = new URL(`/search/${slug}/feed/rss2/`, this.baseUrl);
      if (page > 1) searchUrl.searchParams.set('paged', String(page));
      pagePromises.push(
        this.fetcher.text(ctx, searchUrl, { timeout: 12000 })
          .catch(() => undefined),
      );
    }

    const pages = await Promise.all(pagePromises);
    const combined = pages.filter((p): p is string => !!p).join('\n');
    return combined || undefined;
  }

  private parseRss(
    xml: string,
    name: string,
    year: number,
    type: ContentType,
    season: number | undefined,
    episode: number | undefined,
  ): ReleaseItem[] {
    const $ = cheerio.load(xml, { xmlMode: true });
    const nameClean = normalize(name);
    const groups = new Map<string, { title: string; urls: URL[]; height: number | undefined; bytes: number | undefined }>();

    $('item').each((_i, el) => {
      const $item = $(el);
      const title = $item.find('title').text().trim();
      if (!title || !normalize(title).includes(nameClean)) return;

      if (type === 'series' && season && episode) {
        const epMatch = title.match(/s0*(\d+)e0*(\d+)/i);
        if (
          !epMatch?.[1] || !epMatch?.[2]
          || parseInt(epMatch[1], 10) !== season
          || parseInt(epMatch[2], 10) !== episode
        ) {
          return;
        }
      } else if (type === 'movie') {
        if (/s0*\d+e0*\d+/i.test(title)) return;
        const yearMatch = title.match(/\b(19[89]\d|20\d{2})\b/);
        if (yearMatch && year && Math.abs(parseInt(yearMatch[0], 10) - year) > 1) return;
      }

      const urls: URL[] = [];
      $item.find('enclosure').each((_j, enc) => {
        const raw = $(enc).attr('url');
        if (!raw) return;
        try {
          const url = new URL(raw);
          if (isDebridHoster(url.host)) urls.push(url);
        } catch { /* invalid URL */ }
      });

      if (urls.length === 0) return;

      // Group by release title (without trailing size) so the same release
      // only produces one result even if it appears with both Rapidgator and
      // Nitroflare enclosures across pages.
      const titleKey = normalize(title.replace(/\s*[-–]\s*[\d.]+\s*(?:GB|MB|KB|TB)\s*$/i, ''));
      const existing = groups.get(titleKey);
      if (existing) {
        existing.urls.push(...urls);
      } else {
        groups.set(titleKey, {
          title,
          urls,
          height: findHeight(title),
          bytes: parseSizeBytes(title),
        });
      }
    });

    const items: ReleaseItem[] = [];
    for (const group of groups.values()) {
      const rapidgator = group.urls.find(
        u => u.host.includes('rapidgator') || u.host === 'rg.to',
      );
      const nitroflare = group.urls.find(
        u => u.host.includes('nitroflare'),
      );
      const best = rapidgator ?? nitroflare ?? pickBestHoster(group.urls);
      if (!best) continue;

      items.push({
        title: group.title,
        url: best,
        height: group.height,
        bytes: group.bytes,
      });
    }

    return items;
  }
}
