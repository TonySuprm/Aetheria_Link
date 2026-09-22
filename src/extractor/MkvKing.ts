import winston from 'winston';
import { NotFoundError } from '../error';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

const REFERER = 'https://pro.iqsmartgames.com/';
const FILEURL_RE = /const\s+fileurl\s*=\s*"([^"]+)";/;

export class MkvKing extends Extractor {
  public readonly id = 'mkvking';

  public readonly label = 'MkvKing';

  public override readonly lazyExtract = true;

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public supports(_ctx: Context, url: URL): boolean {
    return url.hostname === 'ddn.iqsmartgames.com' && url.pathname.startsWith('/file/');
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const response = await this.fetcher.fetch(ctx, url, {
      headers: { Referer: REFERER },
      timeout: 12000,
    });

    const html = typeof response.data === 'string' ? response.data : '';
    const match = html.match(FILEURL_RE);
    if (!match?.[1]) {
      throw new NotFoundError();
    }

    const rawFileUrl = match[1].replace(/\\\//g, '/');
    const directUrl = new URL(rawFileUrl);
    const cookie = this.extractCookie(response.headers['set-cookie']);
    const result: InternalUrlResult = {
      url: directUrl,
      format: Format.mp4,
      meta,
    };
    if (cookie) {
      result.requestHeaders = { Cookie: cookie };
    }

    return [result];
  }

  private extractCookie(setCookies: string[] | undefined): string | undefined {
    if (!setCookies) return undefined;
    const cookies = setCookies
      .map(c => c.split(';')[0])
      .filter(Boolean);
    return cookies.length > 0 ? cookies.join('; ') : undefined;
  }
}
