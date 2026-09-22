import * as cheerio from 'cheerio';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { buildMediaFlowProxyExtractorRedirectUrl, supportsMediaFlowProxy } from '../utils';
import { Extractor } from './Extractor';

export class VidFast extends Extractor {
  public readonly id = 'vidfast';
  public readonly label = 'VidFast';
  public override viaMediaFlowProxy = true;

  public supports(ctx: Context, url: URL): boolean {
    const supportedDomain = null !== url.host.match(/vidfast/);
    return supportedDomain && supportsMediaFlowProxy(ctx);
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const headers = { Referer: meta.referer ?? url.href };

    const html = await this.fetcher.text(ctx, url, { headers });

    const $ = cheerio.load(html);

    const title = $('meta[name="og:title"]').attr('content') as string;

    return [
      {
        url: buildMediaFlowProxyExtractorRedirectUrl(ctx, 'VidFast', url, headers),
        format: Format.mp4,
        meta: { ...meta, title },
      },
    ];
  };
}
