import winston from 'winston';
import { unpack } from 'unpacker';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

export class Mixdrop extends Extractor {
  public override readonly id = 'mixdrop';
  public override readonly label = 'Mixdrop';
  public override readonly lazyExtract = true;

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public override supports(_ctx: Context, url: URL): boolean {
    return null !== url.host.match(/mixdrop|mixdrp|mixdroop|m1xdrop/);
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const html = await this.fetcher.text(ctx, url, { headers: { Referer: url.href } });

    const packedRegex = /(eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\).+?<\/script>)/is;
    const packedMatch = html.match(packedRegex);

    if (!packedMatch) {
      this.logger.warn(`[Mixdrop] Could not locate p.a.c.k.e.d script on ${url.href}`);
      return [];
    }

    const scriptText = packedMatch[1] as string;
    let unpacked: string;
    try {
      unpacked = unpack(scriptText);
    } catch (e) {
      this.logger.warn(`[Mixdrop] Failed to unpack script on ${url.href}`);
      return [];
    }

    // e.g. MDCore.wurl="//s-delivery40.mxdcontent.net/v/..."
    const wurlMatch = unpacked.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/i);
    if (!wurlMatch || !wurlMatch[1]) {
      return [];
    }

    const videoUrlStr = wurlMatch[1].startsWith('//') ? `https:${wurlMatch[1]}` : wurlMatch[1];
    const videoUrl = new URL(videoUrlStr);

    const relayUrl = new URL('/relay', ctx.hostUrl);
    relayUrl.searchParams.set('url', videoUrl.href);
    relayUrl.searchParams.set('referer', url.origin + '/');

    return [{
      url: relayUrl,
      format: Format.mp4,
      meta: { ...meta, title: meta.title ?? this.label, referer: url.origin + '/' }
    }];
  }
}
