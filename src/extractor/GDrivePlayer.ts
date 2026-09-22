import { MediaFlowProxyExtractor } from './MediaFlowProxyExtractor';

export class GDrivePlayer extends MediaFlowProxyExtractor {
    public override readonly id = 'gdriveplayer';
    public override readonly label = 'GDrivePlayer';
    public readonly priority = 80;
    public override readonly mfpHost = 'gdriveplayer.to';
}
