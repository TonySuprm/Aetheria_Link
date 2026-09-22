import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

export class TransferIt extends Extractor {
    public override readonly id = 'transferit';
    public override readonly label = 'Transfer.it';
    public override readonly lazyExtract = true;

    public constructor(fetcher: Fetcher, logger: winston.Logger) {
        super(fetcher, logger);
    }

    public override supports(_ctx: Context, url: URL): boolean {
        return /transfer\.it/.test(url.host);
    }

    protected override async extractInternal(_ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
        return [{
            url,
            format: Format.unknown,
            label: this.label,
            meta: {
                ...meta,
                extractorId: this.id,
                referer: url.origin + '/',
            },
        }];
    }
}
