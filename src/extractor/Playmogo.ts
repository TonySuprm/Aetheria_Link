import { MediaFlowProxyExtractor } from './MediaFlowProxyExtractor';

export class Playmogo extends MediaFlowProxyExtractor {
    public override readonly id = 'playmogo';
    public override readonly label = 'Playmogo';
    public readonly priority = 80;
    public override readonly mfpHost = 'playmogo.com';
}
