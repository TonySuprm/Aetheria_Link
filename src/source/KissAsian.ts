import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

/**
 * Embed hosts that are consistently dead, quota-limited, or require browser JS/CAPTCHA
 * that the addon cannot solve server-side. Filtered out so users never see non-playable links.
 */
const DEAD_HOSTS = [
  'drive.google.com',
  'justplay.cam',
  'highload.to',
];

export class KissAsian extends Source {
  public override readonly id = 'kissasian';
  public override readonly label = 'KissAsian';

  public override readonly contentTypes: ContentType[] = ['movie', 'series'];
  public override readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.ko, CountryCode.ja];
  public override readonly baseUrl = 'https://kissasian.cam';
  public override readonly category = 'asiandrama' as const;

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  public override async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, _year, _original_name, original_language] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);

    // Strict Origin Lock: Prevent KissAsian from polluting English search queries natively.
    // By restricting execution to known SE Asian TMDB definitions, we guarantee it only runs on target media,
    // solving the pollution bug while letting it eagerly activate regardless of user language checkboxes.
    const asianLanguages = new Set(['ko', 'ja', 'zh', 'cn', 'th', 'vi']);
    if (original_language && !asianLanguages.has(original_language.toLowerCase())) {
      return [];
    }

    if (!name) {
      return [];
    }

    const searchUrl = new URL('https://kissasian.cam/');
    searchUrl.searchParams.set('s', name);

    try {
      const searchHtml = await this.fetcher.text(ctx, searchUrl, { noProxyHeaders: true });
      const $ = cheerio.load(searchHtml);

      const firstResult = $('a[href*="/series/"]').first().attr('href');
      if (!firstResult) {
        return [];
      }

      // Extract slug from series URL: /series/slug/ → slug
      const seriesUrl = new URL(firstResult);
      const slug = seriesUrl.pathname.split('/').filter(Boolean).pop();
      if (!slug) {
        return [];
      }

      const targetEpNumber = tmdbId.episode || 1;

      // Construct episode URL directly — skip fetching the series page entirely
      const episodeUrl = new URL(`https://kissasian.cam/${slug}-episode-${targetEpNumber}/`);

      const episodeHtml = await this.fetcher.text(ctx, episodeUrl, { noProxyHeaders: true });
      const $ep = cheerio.load(episodeHtml);

      // Collect iframes from the episode page itself
      const iframes: string[] = [];
      $ep('iframe').each((_, el) => {
        const src = $ep(el).attr('src')?.trim();
        if (src) iframes.push(src);
      });

      // Collect mirror endpoints and fetch them ALL in parallel
      const mirrorEndpoints: string[] = [];
      $ep('select.mirror option, select option').each((_, el) => {
        const val = $ep(el).attr('value')?.trim();
        if (val && val.includes('/v/')) {
          mirrorEndpoints.push(val);
        }
      });

      const mirrorResults = await Promise.all(mirrorEndpoints.map(async (mirrorUrl) => {
        try {
          const fullUrl = mirrorUrl.startsWith('http') ? mirrorUrl : `https://kissasian.cam${mirrorUrl}`;
          const mirrorHtml = await this.fetcher.text(ctx, new URL(fullUrl), { noProxyHeaders: true });
          const $mirror = cheerio.load(mirrorHtml);
          const mirrorIframes: string[] = [];
          $mirror('iframe').each((_, el) => {
            const src = $mirror(el).attr('src')?.trim();
            if (src) mirrorIframes.push(src);
          });
          return mirrorIframes;
        } catch {
          return [];
        }
      }));

      for (const mirrorIframes of mirrorResults) {
        iframes.push(...mirrorIframes);
      }

      // Deduplicate and filter out dead hosts
      const distinctIframes = Array.from(new Set(iframes)).filter((embedUrl) => {
        try {
          const host = new URL(embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl).host;
          return !DEAD_HOSTS.some(dead => host === dead || host.endsWith('.' + dead));
        } catch {
          return false;
        }
      });

      if (!distinctIframes.length) {
        return [];
      }

      return distinctIframes.map(embedUrl => ({
        url: new URL(embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl),
        meta: { title: `${name}`, referer: episodeUrl.href, countryCodes: this.countryCodes },
      }));
    } catch {
      return [];
    }
  }
}
