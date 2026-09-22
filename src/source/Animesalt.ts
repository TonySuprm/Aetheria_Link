import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode, Meta } from '../types';
import { buildMediaFlowProxyHlsUrl, Fetcher, getTmdbId, getTmdbNameAndYear, Id, supportsMediaFlowProxy } from '../utils';
import { Source, SourceResult } from './Source';

// Animesalt (animesalt.ac) — WordPress anime site (Hindi / English / Japanese multi-audio). Series
// posts `/series/<slug>/` list per-episode links `/episode/<slug>-<S>x<E>/`; movie posts
// `/movies/<slug>/` serve the player directly.
//
// Each episode/movie page embeds a FirePlayer iframe: `https://as-cdn21.top/video/<hash>`. The
// FirePlayer backend exposes a POST API at `/player/index.php?data=<hash>&do=getVideo` that
// returns a JSON object with `videoSource` — a time-limited HLS m3u8 URL on as-cdn21.top (with
// md5 + expires query params, ~6h TTL). The m3u8 is multi-audio (Hindi/Tamil/Telugu/English/Japanese).
//
// Chain:
//   WP search `?s=<name>` -> match `/series/<slug>/` (series) or `/movies/<slug>/` (movie) by slug
//   series -> fetch post -> find `/episode/<slug>-<S>x<E>/` matching the requested season+episode
//   fetch episode page (series) or movie page (movie) -> extract `as-cdnXX.top/video/<hash>` from iframe
//   POST `https://as-cdn21.top/player/index.php?data=<hash>&do=getVideo` -> JSON -> `videoSource` m3u8
//   HLS m3u8 -> MediaFlow HLS proxy (if configured), else raw url with Referer (Stremio proxies it)

const YEAR_RE = /\b(19|20)\d{2}\b/;
const CDN_PLAYER_BASE = 'https://as-cdn21.top';
const VIDEO_HASH_RE = /as-cdn\d+\.top\/video\/([a-f0-9]+)/i;

export class Animesalt extends Source {
  public readonly id = 'animesalt';
  public readonly label = 'AnimeSalt';
  public readonly contentTypes: ContentType[] = ['movie', 'series'];
  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.en, CountryCode.hi];
  public readonly baseUrl = 'https://animesalt.link';
  public override readonly category = 'anime' as const;
  // FirePlayer m3u8 URLs expire ~6h (md5+expires query params). Use 1h cache so URL is always fresh.
  public override readonly ttl = 3600000; // 1h — m3u8 URLs expire ~6h

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  private get logger() {
    return this.fetcher.getLogger();
  }

  private clean(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  protected async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
    if (type !== 'movie' && type !== 'series') return [];

    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
    if (!name) return [];

    const postUrl = await this.findPost(ctx, name, year, type);
    if (!postUrl) {
      this.logger.info(`Animesalt: no post matched TMDB "${name}" ${year ?? ''}`, ctx);
      return [];
    }

    let pageUrl = postUrl;
    if (type === 'series') {
      const episodeUrl = await this.findEpisode(ctx, postUrl, tmdbId.season, tmdbId.episode);
      if (!episodeUrl) {
        this.logger.info(`Animesalt: no episode matched S${tmdbId.season ?? '?'}E${tmdbId.episode ?? '?'} on ${postUrl.pathname}`, ctx);
        return [];
      }
      pageUrl = episodeUrl;
    }

    let html: string;
    try {
      html = await this.fetcher.text(ctx, pageUrl, { headers: { Referer: this.baseUrl } });
    } catch {
      return [];
    }

    const hashMatch = html.match(VIDEO_HASH_RE);
    if (!hashMatch?.[1]) {
      this.logger.info(`Animesalt: no video hash on ${pageUrl.pathname}`, ctx);
      return [];
    }

    const m3u8Url = await this.resolveVideoSource(ctx, hashMatch[1]);
    if (!m3u8Url) {
      this.logger.info(`Animesalt: no video source for hash ${hashMatch[1]}`, ctx);
      return [];
    }

    const label = type === 'series'
      ? `[AnimeSalt] ${name} S${tmdbId.season ?? 1}E${tmdbId.episode ?? 1} [Multi-Audio]`
      : `[AnimeSalt] ${name} [Multi-Audio]`;

    const meta: Meta = {
      countryCodes: this.countryCodes,
      height: 1080,
      title: label,
      sourceLabel: this.label,
      referer: `${CDN_PLAYER_BASE}/`,
      ...(tmdbId.season && { season: tmdbId.season }),
      ...(tmdbId.episode && { episode: tmdbId.episode }),
    };

    return [{ url: this.buildStreamUrl(ctx, m3u8Url), meta, notWebReady: false }];
  }

  /** Search the WP site and pick the post whose slug contains the cleaned name (+ loose year). */
  private async findPost(ctx: Context, name: string, year: number | undefined, type: ContentType): Promise<URL | undefined> {
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
    const pathPrefix = type === 'movie' ? '/movies/' : '/series/';

    const seen = new Set<string>();
    const candidates: { href: string; text: string }[] = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href.startsWith(`${this.baseUrl}${pathPrefix}`)) return;
      if (seen.has(href)) return;
      seen.add(href);
      candidates.push({ href, text: $(el).text() });
    });

    for (const { href, text } of candidates) {
      const slug = decodeURIComponent(href.replace(`${this.baseUrl}${pathPrefix}`, '').replace(/\/+$/, ''));
      if (!slug || slug.includes('/')) continue;
      const combined = `${slug} ${text}`;
      if (!this.clean(combined).includes(nameClean)) continue;

      const yearMatch = combined.match(YEAR_RE);
      if (year && yearMatch?.[0] && Math.abs(parseInt(yearMatch[0], 10) - year) > 1) continue;

      return new URL(href);
    }

    return undefined;
  }

  /** On a series post, find the `/episode/<slug>-<S>x<E>/` link matching the requested episode. */
  private async findEpisode(ctx: Context, postUrl: URL, season: number | undefined, episode: number | undefined): Promise<URL | undefined> {
    if (season === undefined || episode === undefined) return undefined;
    let html: string;
    try {
      html = await this.fetcher.text(ctx, postUrl, { headers: { Referer: this.baseUrl } });
    } catch {
      return undefined;
    }

    const $ = cheerio.load(html);
    let found: URL | undefined;
    $('a').each((_, el) => {
      if (found) return;
      const href = $(el).attr('href') ?? '';
      if (!href.startsWith(`${this.baseUrl}/episode/`)) return;
      const slug = decodeURIComponent(href.replace(`${this.baseUrl}/episode/`, '').replace(/\/+$/, ''));
      const m = slug.match(/-(\d+)x(\d+)$/i);
      if (!m?.[1] || !m?.[2]) return;
      if (parseInt(m[1], 10) === season && parseInt(m[2], 10) === episode) {
        found = new URL(href);
      }
    });
    return found;
  }

  /**
   * POST to the FirePlayer backend to resolve a video hash into a time-limited HLS m3u8 URL.
   * The API returns JSON with `videoSource` (m3u8), `hls` (boolean), and `securedLink`.
   */
  private async resolveVideoSource(ctx: Context, hash: string): Promise<URL | undefined> {
    try {
      const apiUrl = new URL(`${CDN_PLAYER_BASE}/player/index.php?data=${hash}&do=getVideo`);
      const body = `hash=${hash}&r=${encodeURIComponent(this.baseUrl + '/')}`;
      const response = await this.fetcher.textPost(ctx, apiUrl, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${CDN_PLAYER_BASE}/video/${hash}`,
          'Origin': CDN_PLAYER_BASE,
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 10000,
      });
      const data = JSON.parse(response) as { videoSource?: string };
      if (!data?.videoSource) return undefined;
      return new URL(data.videoSource);
    } catch {
      return undefined;
    }
  }

  /**
   * Build the playable URL: HLS via MediaFlow proxy (if configured), else the raw m3u8.
   * StreamResolver attaches proxyHeaders (Referer) from meta.referer so Stremio proxies it.
   */
  private buildStreamUrl(ctx: Context, m3u8Url: URL): URL {
    if (supportsMediaFlowProxy(ctx)) {
      return buildMediaFlowProxyHlsUrl(ctx, m3u8Url, {
        Referer: `${CDN_PLAYER_BASE}/`,
      }, true);
    }
    return m3u8Url;
  }
}
