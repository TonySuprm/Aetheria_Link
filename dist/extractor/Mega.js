"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mega = void 0;
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
class Mega extends Extractor_1.Extractor {
    id = 'mega';
    label = 'Mega';
    priority = 80;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return url.host === 'mega.nz' || url.host === 'mega.co.nz';
    }
    async extractInternal(ctx, url, meta) {
        const proxyUrl = new URL('/mega-proxy', ctx.hostUrl);
        proxyUrl.searchParams.set('url', url.href);
        return [{
                url: proxyUrl,
                format: types_1.Format.unknown,
                notWebReady: true,
                meta: { ...meta, title: meta.title ?? this.label },
            }];
    }
}
exports.Mega = Mega;
