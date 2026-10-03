"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealDebrid = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
/**
 * RealDebrid extractor — resolves NitroFlare / Rapidgator / RapidRAR / ClicknUpload
 * (and any other debrid-supported hoster) URLs into premium direct-download links
 * via the RealDebrid REST API. Only matches when a RealDebrid API token is configured
 * in the user's add-on config (`realdebridApiKey`).
 *
 * Eager: the debrid API is called at stream-list time so Stremio receives direct,
 * short CDN URLs instead of long `/extract/` proxy URLs. Cached (10m TTL).
 */
class RealDebrid extends Extractor_1.Extractor {
    id = 'realdebrid';
    label = 'RealDebrid';
    ttl = 600000; // 10m
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(ctx, url) {
        if (!ctx.config.realdebridApiKey)
            return false;
        return (0, utils_1.isRealDebridHoster)(url.host);
    }
    async extractInternal(ctx, url, meta) {
        const apiToken = ctx.config.realdebridApiKey;
        if (!apiToken)
            return [];
        this.logger.info(`RealDebrid: unrestricting ${url.host} link`, ctx);
        const result = await (0, utils_1.unrestrictRealDebrid)(ctx, this.fetcher, apiToken, url);
        const mergedMeta = (0, utils_1.mergeDebridMeta)(meta, result);
        return [
            {
                url: result.url,
                format: types_1.Format.unknown,
                isExternal: false,
                notWebReady: true,
                label: this.label,
                meta: mergedMeta,
            },
        ];
    }
}
exports.RealDebrid = RealDebrid;
