import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

interface GoFileContent {
  name?: string;
  size?: number;
  mime?: string;
  link?: string;
  directLink?: string;
}

interface GoFileAccountResponse {
  status?: string;
  data?: { token?: string };
}

interface GoFileContentsResponse {
  status?: string;
  data?: {
    contents?: Record<string, GoFileContent>;
  };
}

// Gofile's current API (2026): a guest account token is obtained via POST /accounts and then sent
// as the `accountToken` cookie to GET /contents/<id>, which returns the per-file direct links.
// (The old `wt` "website token" — previously scraped from the page — has moved into an obfuscated
// JS bundle and is no longer needed; the guest accountToken authorizes content lookups instead.)
export class GoFile extends Extractor {
  public override readonly id = 'gofile';

  public override readonly label = 'GoFile';

  public override readonly ttl = 900000; // 15m

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public override supports(_ctx: Context, url: URL): boolean {
    return /gofile/.test(url.host);
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const segments = url.pathname.split('/').filter(Boolean);
    const contentId = segments[segments.length - 1];
    if (!contentId) {
      return [];
    }

    // 1. Create a guest account to obtain an authorizing token.
    const account = await this.fetcher.json(ctx, new URL('https://api.gofile.io/accounts'), { method: 'POST', noProxyHeaders: true }).catch(() => null) as GoFileAccountResponse | null;
    const token = account?.data?.token;
    if (!token) {
      return [];
    }

    // 2. Look up the content's files using the guest token (Authorization: Bearer). noProxyHeaders
    //    avoids sending Forwarded/X-Real-IP headers, which GoFile's API rejects with HTTP 401.
    const apiUrl = new URL(`https://api.gofile.io/contents/${contentId}`);
    apiUrl.searchParams.set('contentFilter', '');
    apiUrl.searchParams.set('page', '1');
    apiUrl.searchParams.set('pageSize', '1000');
    apiUrl.searchParams.set('sortField', 'name');
    apiUrl.searchParams.set('sortDirection', '1');

    const response = await this.fetcher.json(ctx, apiUrl, { noProxyHeaders: true, headers: { Authorization: `Bearer ${token}` } }).catch(() => null) as GoFileContentsResponse | null;
    if (!response || response.status !== 'ok' || !response.data?.contents) {
      return [];
    }

    const files = Object.values(response.data.contents).filter(f => f && (f.link || f.directLink));
    if (files.length === 0) {
      return [];
    }

    // Prefer playable video containers, then the largest file.
    const isVideo = (name?: string) => /\.(mp4|mkv|webm|avi|mov|m4v)(\?|$)/i.test(name ?? '');
    files.sort((a, b) => {
      const av = isVideo(a.name) ? 1 : 0;
      const bv = isVideo(b.name) ? 1 : 0;
      if (av !== bv) {
        return bv - av;
      }
      return (b.size ?? 0) - (a.size ?? 0);
    });

    const best = files[0] as GoFileContent;
    const link = best.directLink ?? best.link;
    if (!link) {
      return [];
    }

    return [{
      url: new URL(link),
      format: isVideo(best.name) ? Format.mp4 : Format.unknown,
      label: 'GoFile',
      meta: {
        ...meta,
        extractorId: this.id,
        bytes: best.size,
        title: best.name,
        referer: 'https://gofile.io/',
      },
      requestHeaders: { Referer: 'https://gofile.io/' },
    }];
  }
}
