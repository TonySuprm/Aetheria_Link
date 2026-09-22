import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

export class CineHDPlus extends Source {
  public readonly id = 'cinehdplus';

  public readonly label = 'CineHDPlus';

  public readonly contentTypes: ContentType[] = ['series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.es, CountryCode.mx];

  public readonly baseUrl = 'https://cinehdplus.zone';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();

    this.fetcher = fetcher;
  }

  public async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);

    let name: string;
    try {
      [name] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId, 'es');
    } catch {
      return [];
    }

    const seriesPageUrl = await this.fetchSeriesPageUrl(ctx, name);
    if (!seriesPageUrl) {
      return [];
    }

    const html = await this.fetcher.text(ctx, seriesPageUrl);

    const $ = cheerio.load(html);

    const countryCodes = [($('.details__langs').html() as string).includes('Latino') ? CountryCode.mx : CountryCode.es];

    const title = `${($('meta[property="og:title"]').attr('content') as string).trim()} ${tmdbId.formatSeasonAndEpisode()}`;

    return Promise.all(
      $(`[data-num="${tmdbId.season}x${tmdbId.episode}"]`)
        .siblings('.mirrors')
        .children('[data-link]')
        .map((_i, el) => new URL(($(el).attr('data-link') as string).replace(/^(https:)?\/\//, 'https://')))
        .toArray()
        .filter(url => !url.host.match(/cinehdplus/))
        .map(url => ({ url, meta: { countryCodes, referer: seriesPageUrl.href, title } })),
    );
  };

  // Case-insensitive match handles TMDB/CineHDPlus capitalization differences (e.g. "La casa de dragón" vs "La Casa del Dragón")
  private fetchSeriesPageUrl = async (ctx: Context, name: string): Promise<URL | undefined> => {
    const html = await this.fetcher.text(ctx, new URL(`/series/?story=${encodeURIComponent(name)}&do=search&subaction=search`, this.baseUrl));

    const $ = cheerio.load(html);

    const url = $('.card__title a[href]')
      .filter((_i, el) => $(el).text().trim().toLowerCase() === name.toLowerCase())
      .attr('href');

    return url !== undefined ? new URL(url) : url;
  };
}
