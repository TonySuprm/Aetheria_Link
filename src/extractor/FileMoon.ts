import { Context } from '../types';
import { supportsMediaFlowProxy } from '../utils';
import { MediaFlowProxyExtractor } from './MediaFlowProxyExtractor';

export class FileMoon extends MediaFlowProxyExtractor {
  public readonly id = 'filemoon';
  public readonly label = 'FileMoon';
  public readonly mfpHost = 'filemoon';

  public override supports(ctx: Context, url: URL): boolean {
    const supportedDomain = url.host === 'filemoon.sx' || url.host === 'filemoon.to';
    return supportedDomain && supportsMediaFlowProxy(ctx);
  }
}
