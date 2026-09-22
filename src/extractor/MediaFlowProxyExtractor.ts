import { Context, Format, InternalUrlResult, Meta } from '../types';
import { buildMediaFlowProxyExtractorRedirectUrl, supportsMediaFlowProxy } from '../utils';
import { Extractor } from './Extractor';

export abstract class MediaFlowProxyExtractor extends Extractor {
  public override viaMediaFlowProxy = true;

  public abstract override readonly id: string;
  public abstract override readonly label: string;
  public abstract readonly mfpHost: string;

  public override supports(ctx: Context, url: URL): boolean {
    return supportsMediaFlowProxy(ctx) && this.matchesHost(url.host);
  }

  protected matchesHost(host: string): boolean {
    return host === this.mfpHost || host.endsWith('.' + this.mfpHost);
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const redirectUrl = buildMediaFlowProxyExtractorRedirectUrl(ctx, this.mfpHost, url, { Referer: meta.referer ?? url.href });

    // Append a dummy extension directly into the search params locally so ExoPlayer flawlessly executes the 307 follow
    // without stalling the native renderer
    redirectUrl.searchParams.append('dummy', 'ignore.mp4');

    return [
      {
        url: redirectUrl,
        format: Format.mp4,
        meta: { ...meta },
      },
    ];
  };
}
