import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

export class OlaMovies extends Source {
  public readonly id = 'olamovies';

  public readonly label = 'OlaMovies';

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.en, CountryCode.hi];

  public readonly baseUrl = 'https://v2.olamovies.mov';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();

    this.fetcher = fetcher;
  }

  public async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);

    let title: string = name;
    if (tmdbId.season) {
      title += ` ${tmdbId.formatSeasonAndEpisode()}`;
    } else {
      title += ` (${year})`;
    }

    const searchUrl = new URL(`/?s=${encodeURIComponent(name)}`, this.baseUrl);
    const searchHtml = await this.fetcher.text(ctx, searchUrl);

    const $search = cheerio.load(searchHtml);

    const resultUrl = $search('h2.entry-title a, h3.entry-title a, .entry-title a')
      .filter((_, el) => {
        const text = $search(el).text().trim().toLowerCase();
        return text.includes(name.toLowerCase());
      })
      .first()
      .attr('href');

    if (!resultUrl) {
      return [];
    }

    const postHtml = await this.fetcher.text(ctx, new URL(resultUrl));
    const $post = cheerio.load(postHtml);

    const urls: URL[] = [];

    $post('.entry-content a[href*="drive.ol-am.top"], .entry-content a[href*="links.ol-am.top"], .entry-content a[href*="drive.google.com"], .wp-block-button a[href*="links.ol-am.top"], .wp-block-button a[href*="drive.ol-am.top"]').each((_, el) => {
      const href = $post(el).attr('href');
      if (href) {
        try {
          urls.push(new URL(href));
        } catch {
          // ignore invalid URLs
        }
      }
    });

    if (urls.length === 0) {
      return [];
    }

    return urls.map(url => ({ url, meta: { title, countryCodes: [CountryCode.multi, CountryCode.en, CountryCode.hi] } }));
  }
}
