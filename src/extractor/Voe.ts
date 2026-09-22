import { Context } from '../types';
import { supportsMediaFlowProxy } from '../utils';
import { MediaFlowProxyExtractor } from './MediaFlowProxyExtractor';

export class Voe extends MediaFlowProxyExtractor {
  public readonly id = 'voe';
  public readonly label = 'VOE';
  public readonly mfpHost = 'voe';

  public override supports(ctx: Context, url: URL): boolean {
    const supportedDomain = url.host === 'voe.sx' || url.host === 'voe.video';
    return supportedDomain && supportsMediaFlowProxy(ctx);
  }
}
