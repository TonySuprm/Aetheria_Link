"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferIt = void 0;
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
class TransferIt extends Extractor_1.Extractor {
    id = 'transferit';
    label = 'Transfer.it';
    lazyExtract = true;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return /transfer\.it/.test(url.host);
    }
    async extractInternal(_ctx, url, meta) {
        return [{
                url,
                format: types_1.Format.unknown,
                label: this.label,
                meta: {
                    ...meta,
                    extractorId: this.id,
                    referer: url.origin + '/',
                },
            }];
    }
}
exports.TransferIt = TransferIt;
