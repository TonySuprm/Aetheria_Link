"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaFlowProxyExtractor = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
class MediaFlowProxyExtractor extends Extractor_1.Extractor {
    viaMediaFlowProxy = true;
    supports(ctx, url) {
        return (0, utils_1.supportsMediaFlowProxy)(ctx) && this.matchesHost(url.host);
    }
    matchesHost(host) {
        return host === this.mfpHost || host.endsWith('.' + this.mfpHost);
    }
    async extractInternal(ctx, url, meta) {
        const redirectUrl = (0, utils_1.buildMediaFlowProxyExtractorRedirectUrl)(ctx, this.mfpHost, url, { Referer: meta.referer ?? url.href });
        // Append a dummy extension directly into the search params locally so ExoPlayer flawlessly executes the 307 follow
        // without stalling the native renderer
        redirectUrl.searchParams.append('dummy', 'ignore.mp4');
        return [
            {
                url: redirectUrl,
                format: types_1.Format.mp4,
                meta: { ...meta },
            },
        ];
    }
    ;
}
exports.MediaFlowProxyExtractor = MediaFlowProxyExtractor;
