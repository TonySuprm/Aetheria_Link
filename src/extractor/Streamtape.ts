import bytes from 'bytes';
import * as cheerio from 'cheerio';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { buildMediaFlowProxyExtractorRedirectUrl, supportsMediaFlowProxy } from '../utils';
import { Extractor } from './Extractor';

export class Streamtape extends Extractor {
  public readonly id = 'streamtape';
  public readonly label = 'Streamtape';
  public override viaMediaFlowProxy = true;

  public supports(ctx: Context, url: URL): boolean {
    const supportedDomain = null !== url.host.match(/streamtape/)
      || [
        'strtape.cloud',
        'streamta.pe',
        'strcloud.link',
        'strcloud.club',
        'strtpe.link',
        'scloud.online',
        'stape.fun',
        'streamadblockplus.com',
        'shavetape.cash',
        'streamta.site',
        'streamadblocker.xyz',
        'tapewithadblock.org',
        'adblocktape.wiki',
        'antiadtape.com',
        'tapeblocker.com',
        'streamnoads.com',
        'tapeadvertisement.com',
        'tapeadsenjoyer.com',
        'watchadsontape.com',
        'sbfull.com',
        'sbchill.com',
        'strcloud.in',
      ].includes(url.host);

    return supportedDomain && supportsMediaFlowProxy(ctx);
  }

  public override normalize(url: URL): URL {
    return new URL(url.href.replace('/e/', '/v/'));
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const headers = { Referer: meta.referer ?? url.href };

    await this.fetcher.text(ctx, new URL(url.href.replace('/v/', '/e/')), { headers });

    const html = await this.fetcher.text(ctx, url, { headers });

    const sizeMatch = html.match(/([\d.]+ ?[GM]B)/);

    const $ = cheerio.load(html);
    const title = $('meta[name="og:title"]').attr('content');

    const resultMeta: Meta = { ...meta };
    if (title) resultMeta.title = title;
    if (sizeMatch?.[1]) {
      const parsedBytes = bytes.parse(sizeMatch[1]);
      if (parsedBytes !== null && Number.isFinite(parsedBytes) && parsedBytes > 0) {
        resultMeta.bytes = parsedBytes;
      }
    }

    return [
      {
        url: buildMediaFlowProxyExtractorRedirectUrl(ctx, 'Streamtape', url, headers),
        format: Format.mp4,
        meta: resultMeta,
      },
    ];
  };
}
