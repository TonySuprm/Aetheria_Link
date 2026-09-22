import { ContentType } from 'stremio-addon-sdk';
import winston from 'winston';
import { BlockedError } from '../error';
import { Context, CountryCode } from '../types';
import { buildMediaFlowProxyHlsUrl, Fetcher, getTmdbId, getTmdbNameAndYear, Id, supportsMediaFlowProxy } from '../utils';
import { Source, SourceResult } from './Source';

interface MiruroPipeResponse {
  providers?: Record<string, {
    episodes?: {
      sub?: { id: string; number: number; title?: string }[];
      dub?: { id: string; number: number; title?: string }[];
    };
  }>;
}

interface MiruroSourcesResponse {
  streams?: {
    url: string;
    type: string;
    quality: string;
    referer?: string;
  }[];
}

export class Miruro extends Source {
  public readonly id = 'miruro';

  // Hostnames confirmed dead/403 — updated as CDNs go down
  private static readonly DEAD_HOSTNAMES = new Set([
    'playmogo.com',
    'wixstatic.com', // wix-hosted streams - unreliable
  ]);

  public readonly label = 'Miruro';
  public readonly contentTypes: ContentType[] = ['movie', 'series'];
  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.ja, CountryCode.zh, CountryCode.ko, CountryCode.th];
  public readonly baseUrl = 'https://www.miruro.to';
  public override readonly category = 'anime' as const;

  // Miruro's /api/secure/pipe endpoint is behind a Cloudflare WAF that IP-bans
  // datacenter IPs (FlareSolverr confirms: "your IP is banned for this site").
  // The watch page (HTML) works but doesn't embed episode/stream data — all
  // episode IDs and stream URLs come from the pipe API. A residential proxy
  // (PROXY_CONFIG=www.miruro.to:http://user:pass@ip:port) is the only fix;
  // the Fetcher already routes both axios and FlareSolverr through it.
  private static readonly UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  private readonly fetcher: Fetcher;

  private get logger(): winston.Logger {
    return this.fetcher.getLogger();
  }

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  /** Fast liveness check for direct stream URLs — returns false if 403/404/timeout */
  private async isStreamAlive(url: string, referer?: string): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': Miruro.UA,
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      });
      return res.status < 400;
    } catch {
      return false;
    }
  }

  private encodePipe(payload: Record<string, any>): string {
    const jsonStr = JSON.stringify(payload);
    return Buffer.from(jsonStr).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private async decompressPipe(blob: string): Promise<any> {
    if (!blob.startsWith('H4sI')) {
      try { return JSON.parse(blob); } catch (e) { return null; }
    }

    const zlib = require('zlib');
    const b64 = blob.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - blob.length % 4) % 4);
    const buf = Buffer.from(b64, 'base64');

    return await new Promise((resolve) => {
      zlib.gunzip(buf, (err: Error | null, res: Buffer) => {
        if (err) resolve(null);
        else resolve(JSON.parse(res.toString('utf8')));
      });
    });
  }

  private async searchAnilist(ctx: Context, name: string): Promise<number | null> {
    const query = `
      query ($search: String) {
        Page(page: 1, perPage: 1) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english native }
          }
        }
      }
    `;
    const res = await this.fetcher.json(ctx, new URL('https://graphql.anilist.co'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      data: JSON.stringify({ query, variables: { search: name } }),
    }) as any;

    const media = res?.data?.Page?.media?.[0];
    if (!media) return null;

    // Strict title validation to prevent non-anime matches
    const searchName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const enTitle = (media.title?.english || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const jpTitle = (media.title?.romaji || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const nativeTitle = (media.title?.native || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const isMatch = (str1: string, str2: string) => {
      if (str1.length < 3 || str2.length < 3) return false;
      if (str1.includes(str2) || str2.includes(str1)) {
        const ratio = Math.min(str1.length, str2.length) / Math.max(str1.length, str2.length);
        return ratio > 0.7; // Deny fuzzy matches where strings radically differ in length (e.g. Succession -> B The Beginning Succession)
      }
      return false;
    };

    const matchEn = isMatch(enTitle, searchName);
    const matchJp = isMatch(jpTitle, searchName);
    const matchNative = isMatch(nativeTitle, searchName);

    if (!matchEn && !matchJp && !matchNative) {
      this.logger.info(`Miruro: Rejected fuzzy Anilist match. Searched '${name}', got '${media.title?.english}'`, ctx);
      return null;
    }

    return media.id;
  }

  public async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);

    this.logger.info(`Miruro: Starting lookup for ${name} (${year}) ep ${tmdbId.episode || 1}`, ctx);

    const anilistId = await this.searchAnilist(ctx, name);
    if (!anilistId) {
      this.logger.info(`Miruro: Failed to map TMDB to AniList for ${name}`, ctx);
      return [];
    }

    const epsPayload = {
      path: 'episodes',
      method: 'GET',
      query: { anilistId: anilistId.toString() },
      body: null,
      version: '0.2.0',
    };

    const targetEpNumber = tmdbId.episode || 1;
    let epsRes: MiruroPipeResponse;
    try {
      const eParam = this.encodePipe(epsPayload);
      const url = `${this.baseUrl}/api/secure/pipe?e=${eParam}&t=${Date.now()}`;
      const text = await this.fetcher.text(ctx, new URL(url), {
        headers: {
          'User-Agent': Miruro.UA,
          'Accept': '*/*',
          'Referer': this.baseUrl,
          'Origin': this.baseUrl,
        },
      });
      epsRes = await this.decompressPipe(text) as MiruroPipeResponse;
    } catch (e: any) {
      if (e instanceof BlockedError) {
        this.logger.warn(
          `Miruro: API blocked by Cloudflare WAF (IP banned). Configure PROXY_CONFIG=www.miruro.to:http://user:pass@ip:port with a residential proxy to bypass.`,
          ctx,
        );
      } else {
        this.logger.info(`Miruro: Failed episode fetch: ${e?.message ?? e}`, ctx);
      }
      return [];
    }

    if (!epsRes || !epsRes.providers) {
      this.logger.info(`Miruro: Provider mapping failed to resolve`, ctx);
      return [];
    }

    const mappedProviderPromises = Object.keys(epsRes.providers).map(async (provider, index) => {
      const providerData = epsRes.providers![provider];

      const categories = ['sub', 'dub'] as const;
      const categoryPromises = categories.map(async (category) => {
        const epList = providerData?.episodes?.[category];
        if (!epList) return [];

        const ep = epList.find((e: { id: string; number: number }) => e.number === targetEpNumber);
        if (!ep || !ep.id) return [];

        const sourcePayload = {
          path: 'sources',
          method: 'GET',
          query: {
            episodeId: ep.id,
            provider: provider,
            category: category,
            anilistId: anilistId.toString(),
          },
          body: null,
          version: '0.2.0',
        };

        try {
          const apiUrlStr = `${this.baseUrl}/api/secure/pipe?e=${this.encodePipe(sourcePayload)}&t=${Date.now()}`;

          // Stagger requests to avoid 429
          if (index > 0) {
            await new Promise(r => setTimeout(r, index * 600));
          }

          const srcReqText = await this.fetcher.text(ctx, new URL(apiUrlStr), {
            headers: {
              'User-Agent': Miruro.UA,
              'Accept': '*/*',
              'Referer': this.baseUrl,
              'Origin': this.baseUrl,
            },
            timeout: 8000,
          });
          const srcRes = await this.decompressPipe(srcReqText) as MiruroSourcesResponse;

          if (srcRes?.streams) {
            // Filter out known-dead hostnames first
            const liveStreams = srcRes.streams.filter((stream) => {
              try {
                const hostname = new URL(stream.url).hostname;
                if (Miruro.DEAD_HOSTNAMES.has(hostname)) {
                  this.logger.info(`Miruro: Skipping dead hostname ${hostname}`, ctx);
                  return false;
                }
              } catch { return false; }
              return true;
            });

            const streamResults = await Promise.all(liveStreams.map(async (stream) => {
              const isDirect = stream.url.includes('.m3u8') || stream.url.includes('.mp4');
              const isHls = stream.type === 'hls' || stream.url.includes('.m3u8');

              // HEAD-probe direct stream URLs — skip embed-type URLs (can't be probed)
              if (isDirect) {
                const alive = await this.isStreamAlive(stream.url, stream.referer);
                if (!alive) {
                  this.logger.info(`Miruro: Dropping dead stream URL: ${stream.url.substring(0, 80)}`, ctx);
                  return null;
                }
              }

              if (isDirect || stream.type === 'hls') {
                const needsReferer = !!stream.referer;
                const hasProxy = supportsMediaFlowProxy(ctx);
                let finalUrl = new URL(stream.url);

                if (isHls && needsReferer && hasProxy) {
                  finalUrl = buildMediaFlowProxyHlsUrl(ctx, new URL(stream.url), {
                    'Referer': stream.referer!,
                    'User-Agent': Miruro.UA,
                  }, true);
                } else if (!isHls && needsReferer) {
                  finalUrl = new URL('/relay', ctx.hostUrl);
                  finalUrl.searchParams.set('url', stream.url);
                  finalUrl.searchParams.set('referer', stream.referer!);
                }

                return {
                  url: finalUrl,
                  notWebReady: false,
                  meta: {
                    title: `[Miruro - ${provider}]\n${name} S${tmdbId.season || 1}E${targetEpNumber} (${category.toUpperCase()}) - ${stream.quality || 'Auto'} ${isHls ? 'HLS' : 'MP4'}`,
                    sourceLabel: provider,
                    referer: stream.referer || this.baseUrl,
                    countryCodes: [CountryCode.multi, CountryCode.ja, CountryCode.zh, CountryCode.ko, CountryCode.th],
                  },
                } as SourceResult;
              }
              return null;
            }));

            return streamResults.filter(r => r !== null) as SourceResult[];
          }
        } catch (e: any) {
          if (e instanceof BlockedError) {
            this.logger.warn(`Miruro: Source API blocked by Cloudflare WAF for provider ${provider} (${category})`, ctx);
          } else {
            this.logger.info(`Miruro: Source extraction failed for provider ${provider} (${category}): ${e?.message ?? e}`, ctx);
          }
        }
        return [];
      });

      const results = await Promise.all(categoryPromises);
      return results.flat();
    });

    const providerResults = await Promise.all(mappedProviderPromises);
    return providerResults.flat();
  }
}
