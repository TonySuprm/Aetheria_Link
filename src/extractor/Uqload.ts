import { Context } from '../types';
import { supportsMediaFlowProxy } from '../utils';
import { MediaFlowProxyExtractor } from './MediaFlowProxyExtractor';

export class Uqload extends MediaFlowProxyExtractor {
  public readonly id = 'uqload';
  public readonly label = 'Uqload';
  public readonly mfpHost = 'uqload';

  public override supports(ctx: Context, url: URL): boolean {
    const supportedDomain = null !== url.host.match(/uqload/);
    return supportedDomain && supportsMediaFlowProxy(ctx);
  }
}
