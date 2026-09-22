import bytes from 'bytes';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode, Meta } from '../types';
import { Fetcher, findHeight, getTmdbId, Id } from '../utils';
import { Source, SourceResult } from './Source';

const PLAYER_KEY = 'f6e324cd9c321d6c6898d09c769478b2273a3a55';
const API_BASE = 'https://streams.iqsmartgames.com';
const DDN_BASE = 'https://ddn.iqsmartgames.com/file';

interface ApiEntry {
  filename: string;
  fileslug: string;
  fsize: string;
}

interface ApiResponse {
  success?: boolean;
  data?: ApiEntry[];
}

const parseSizeBytes = (text: string): number | undefined => {
  const cleaned = text.replace(/,/g, '').trim();
  const parsed = bytes.parse(cleaned);
  return parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export class MkvKing extends Source {
  public readonly id = 'mkvking';

  public readonly label = 'MkvKing';

  public readonly contentTypes: ContentType[] = ['movie', 'series'];

  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.en];

  public readonly baseUrl = 'https://e.mkvking.dad';

  public override readonly category = 'hollywood' as const;

  protected override readonly domainKey = 'mkvking';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  public async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const numericId = tmdbId.id;
    if (!numericId) return [];

    const apiUrl = this.buildApiUrl(type, numericId, tmdbId.season, tmdbId.episode);
    if (!apiUrl) return [];

    let response: ApiResponse;
    try {
      response = await this.fetcher.json(ctx, apiUrl, { timeout: 12000 }) as ApiResponse;
    } catch {
      return [];
    }

    if (!response?.success || !Array.isArray(response.data) || response.data.length === 0) {
      return [];
    }

    const results: SourceResult[] = [];
    for (const entry of response.data) {
      if (!entry.fileslug) continue;

      const url = new URL(`${DDN_BASE}/${entry.fileslug}`);
      const meta: Meta = {
        title: `[MkvKing] ${entry.filename}`,
        height: findHeight(entry.filename),
        bytes: parseSizeBytes(entry.fsize),
        countryCodes: this.countryCodes,
        sourceLabel: this.label,
        sourceId: this.id,
        referer: 'https://pro.iqsmartgames.com/',
        season: tmdbId.season,
        episode: tmdbId.episode,
      };
      results.push({ url, meta });
    }

    this.fetcher.getLogger().info(`MkvKing: returning ${results.length} result(s)`, ctx);
    return results;
  }

  private buildApiUrl(
    type: ContentType,
    id: number,
    season: number | undefined,
    episode: number | undefined,
  ): URL | undefined {
    if (type === 'movie') {
      return new URL(`${API_BASE}/mymovieapi?tmdbid=${id}&key=${PLAYER_KEY}`);
    }

    if (type === 'series' && season && episode) {
      return new URL(
        `${API_BASE}/myseriesapi?tmdbid=${id}&season=${season}&epname=${encodeURIComponent(String(episode))}&key=${PLAYER_KEY}`,
      );
    }

    return undefined;
  }
}
