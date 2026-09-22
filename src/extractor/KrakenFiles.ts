import * as cheerio from 'cheerio';
import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

export class KrakenFiles extends Extractor {
  public override readonly id = 'krakenfiles';
  public override readonly label = 'KrakenFiles';
  public override readonly lazyExtract = true;

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public override supports(_ctx: Context, url: URL): boolean {
    return url.host.includes('krakenfiles.com');
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const embedHtml = await this.fetcher.text(ctx, url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': meta.referer ?? url.href,
      },
    });

    const $ = cheerio.load(embedHtml);

    // KrakenFiles embed pages contain <source src="https://phs*.krakencloud.net/play/video/...">
    const sourceUrl = $('source').attr('src') || $('video source').attr('src') || $('video').attr('src');

    if (!sourceUrl) {
      // Fallback: search for krakencloud.net video URL directly in HTML
      const cloudMatch = embedHtml.match(/(https?:\/\/phs\d+\.krakencloud\.net\/play\/video\/[^\s"'<>]+)/);
      if (!cloudMatch?.[1]) {
        this.logger.warn(`[KrakenFiles] No <source> tag found on ${url.href}`);
        return [];
      }
      const videoUrl = new URL(cloudMatch[1]);
      const relayUrl = new URL('/relay', ctx.hostUrl);
      relayUrl.searchParams.set('url', videoUrl.href);
      relayUrl.searchParams.set('referer', 'https://krakenfiles.com/');
      return [{
        url: relayUrl,
        format: Format.mp4,
        meta: { ...meta, title: meta.title ?? this.label, referer: 'https://krakenfiles.com/' },
      }];
    }

    const videoUrl = new URL(sourceUrl.startsWith('//') ? `https:${sourceUrl}` : sourceUrl);

    // We must route through our internal relay so LibVLC doesn't drop the spoofed referer!
    const relayUrl = new URL('/relay', ctx.hostUrl);
    relayUrl.searchParams.set('url', videoUrl.href);
    relayUrl.searchParams.set('referer', 'https://krakenfiles.com/');

    return [{
      url: relayUrl,
      format: Format.mp4,
      meta: { ...meta, title: meta.title ?? this.label, referer: 'https://krakenfiles.com/' },
    }];
  }
}
