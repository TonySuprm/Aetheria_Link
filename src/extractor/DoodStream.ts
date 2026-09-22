import { Context } from '../types';
import { supportsMediaFlowProxy } from '../utils';
import { MediaFlowProxyExtractor } from './MediaFlowProxyExtractor';

export class DoodStream extends MediaFlowProxyExtractor {
  public readonly id = 'doodstream';
  public readonly label = 'DoodStream';
  public readonly mfpHost = 'doodstream';

  public override supports(ctx: Context, url: URL): boolean {
    const supportedDomain = null !== url.host.match(/doodstream|dood\.to|dood\.watch|dood\.pm|dood\.re|dood\.so|dood\.ws|dood\.cx|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|doods\.pro/);
    return supportedDomain && supportsMediaFlowProxy(ctx);
  }
}
