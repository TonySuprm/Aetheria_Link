import { Context } from '../types';
import { supportsMediaFlowProxy } from '../utils';
import { MediaFlowProxyExtractor } from './MediaFlowProxyExtractor';

export class StreamWish extends MediaFlowProxyExtractor {
  public readonly id = 'streamwish';
  public readonly label = 'StreamWish';
  public readonly mfpHost = 'streamwish';

  public override supports(ctx: Context, url: URL): boolean {
    const supportedDomain = url.host === 'streamwish.com' || url.host === 'streamwish.to';
    return supportedDomain && supportsMediaFlowProxy(ctx);
  }
}
