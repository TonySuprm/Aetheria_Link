import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher, supportsMediaFlowProxy } from '../utils';
import { Extractor } from './Extractor';

export class StrCloud extends Extractor {
  public override readonly id = 'strcloud';
  public override readonly label = 'StrCloud';
  public override readonly lazyExtract = true;

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public override supports(_ctx: Context, url: URL): boolean {
    return url.host.includes('strcloud.in');
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const embedHtml = await this.fetcher.text(ctx, url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': meta.referer ?? url.href,
      },
    });

    // Search for direct MP4 links packed in the JS or HTML
    const fileMatch = embedHtml.match(/file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i);
    let videoUrlStr = '';

    if (fileMatch) {
      videoUrlStr = fileMatch[1] as string;
    } else {
      // Strcloud sometimes hides within simple video tags
      const videoTagMatch = embedHtml.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
      if (videoTagMatch) {
        videoUrlStr = videoTagMatch[1] as string;
      } else {
        // StrCloud pages may contain a streamtape.com redirect URL
        const streamtapeMatch = embedHtml.match(/(https?:\/\/(?:[a-z0-9-]+\.)*(?:streamtape|strcloud|sbfull|sbchill)\.[a-z]+\/e\/[^"'\s<>]+)/i);
        if (streamtapeMatch) {
          videoUrlStr = streamtapeMatch[1] as string;
        }
      }
    }

    if (!videoUrlStr) {
      this.logger.warn(`[StrCloud] No direct mp4 URL found on ${url.href}`);
      return [];
    }

    const videoUrl = new URL(videoUrlStr);

    if (supportsMediaFlowProxy(ctx)) {
      const proxyUrl = ctx.config.mediaFlowProxyUrl?.replace(/^https?:\/\//, '') ?? '';
      const protocol = ctx.config.mediaFlowProxyUrl?.startsWith('https://') ? 'https:' : 'http:';
      const proxyStreamUrl = new URL('/proxy/stream', `${protocol}//${proxyUrl}`);

      if (ctx.config.mediaFlowProxyPassword) {
        proxyStreamUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
      }
      proxyStreamUrl.searchParams.append('d', videoUrl.href);
      proxyStreamUrl.searchParams.append('h_referer', url.href);
      proxyStreamUrl.searchParams.append('h_origin', url.origin);

      return [{
        url: proxyStreamUrl,
        format: Format.mp4,
        meta: meta,
      }];
    }

    return [{
      url: videoUrl,
      format: Format.mp4,
      meta: meta,
    }];
  }
}
