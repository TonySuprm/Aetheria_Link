import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

export class Mega extends Extractor {
  public override readonly id = 'mega';
  public override readonly label = 'Mega';
  public readonly priority = 80;

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public override supports(_ctx: Context, url: URL): boolean {
    return url.host === 'mega.nz' || url.host === 'mega.co.nz';
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const proxyUrl = new URL('/mega-proxy', ctx.hostUrl);
    proxyUrl.searchParams.set('url', url.href);
    return [{
      url: proxyUrl,
      format: Format.unknown,
      notWebReady: true,
      meta: { ...meta, title: meta.title ?? this.label },
    }];
  }
}
