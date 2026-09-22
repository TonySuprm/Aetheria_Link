import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

interface JustPlaySource {
  url?: string;
  mimeType?: string;
  label?: string;
  height?: number;
}

interface JustPlayApiResponse {
  sources?: JustPlaySource[];
  source?: string;
  streamUrl?: string;
  hls?: string;
  dash?: string;
  file?: string;
  error?: string;
}

export class JustPlay extends Extractor {
  public override readonly id = 'justplay';
  public override readonly label = 'JustPlay';
  public override readonly lazyExtract = true;

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public override supports(_ctx: Context, url: URL): boolean {
    return url.host === 'justplay.cam' || url.host.includes('justplay');
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    // Extract video ID from embed URL: /e/${id} or /e/${id}/${slug}
    const pathParts = url.pathname.split('/').filter(Boolean);
    const eIndex = pathParts.indexOf('e');
    if (eIndex < 0 || eIndex + 1 >= pathParts.length) {
      this.logger.warn(`JustPlay: could not extract video ID from ${url.href}`);
      return [];
    }
    const videoId = pathParts[eIndex + 1];
    if (!videoId) {
      this.logger.warn(`JustPlay: could not extract video ID from ${url.href}`);
      return [];
    }

    // Call the JustPlay API to get video sources
    const apiUrl = new URL(`https://justplay.cam/api/videos/${encodeURIComponent(videoId)}/`);

    let apiData: JustPlayApiResponse;
    try {
      apiData = await this.fetcher.json(ctx, apiUrl, {
        headers: {
          'Referer': url.href,
          'X-Embed-Parent': meta.referer ?? url.origin,
          'Accept': 'application/json',
        },
      }) as JustPlayApiResponse;
    } catch {
      this.logger.warn(`JustPlay: API request failed for video ${videoId}`);
      return [];
    }

    if (apiData.error) {
      this.logger.warn(`JustPlay: API error for video ${videoId}: ${apiData.error}`);
      return [];
    }

    const results: InternalUrlResult[] = [];

    // Extract from sources array (primary format)
    if (Array.isArray(apiData.sources)) {
      for (const source of apiData.sources) {
        if (source.url) {
          results.push({
            url: new URL(source.url),
            format: source.mimeType?.includes('mpegurl')
              ? Format.hls
              : source.mimeType?.includes('mp4')
                ? Format.mp4
                : source.url.includes('.m3u8')
                  ? Format.hls
                  : source.url.includes('.mp4')
                    ? Format.mp4
                    : Format.unknown,
            meta: {
              ...meta,
              title: meta.title ?? this.label,
              ...(source.height && { height: source.height }),
            },
          });
        }
      }
    }

    // Fallback: single stream URL fields
    if (results.length === 0) {
      const directUrl = apiData.streamUrl ?? apiData.hls ?? apiData.dash ?? apiData.file ?? apiData.source;
      if (directUrl) {
        results.push({
          url: new URL(directUrl),
          format: directUrl.includes('.m3u8')
            ? Format.hls
            : directUrl.includes('.mp4')
              ? Format.mp4
              : Format.unknown,
          meta: { ...meta, title: meta.title ?? this.label },
        });
      }
    }

    if (results.length === 0) {
      this.logger.warn(`JustPlay: no video sources found for video ${videoId}`);
      return [];
    }

    // Route through internal relay to spoof Referer and avoid 403s
    return results.map((result) => {
      const relayUrl = new URL('/relay', ctx.hostUrl);
      relayUrl.searchParams.set('url', result.url.href);
      relayUrl.searchParams.set('referer', url.origin);
      return {
        url: relayUrl,
        format: result.format,
        meta: { ...result.meta, referer: url.origin },
      };
    });
  }
}
