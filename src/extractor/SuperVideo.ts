import { Context } from '../types';
import { supportsMediaFlowProxy } from '../utils';
import { MediaFlowProxyExtractor } from './MediaFlowProxyExtractor';

export class SuperVideo extends MediaFlowProxyExtractor {
  public readonly id = 'supervideo';
  public readonly label = 'SuperVideo';
  public readonly mfpHost = 'supervideo';

  public override supports(ctx: Context, url: URL): boolean {
    const supportedDomain = url.host === 'supervideo.tv';
    return supportedDomain && supportsMediaFlowProxy(ctx);
  }
}
