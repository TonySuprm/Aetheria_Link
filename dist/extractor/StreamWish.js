"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamWish = void 0;
const utils_1 = require("../utils");
const MediaFlowProxyExtractor_1 = require("./MediaFlowProxyExtractor");
class StreamWish extends MediaFlowProxyExtractor_1.MediaFlowProxyExtractor {
    id = 'streamwish';
    label = 'StreamWish';
    mfpHost = 'streamwish';
    supports(ctx, url) {
        const supportedDomain = url.host === 'streamwish.com' || url.host === 'streamwish.to';
        return supportedDomain && (0, utils_1.supportsMediaFlowProxy)(ctx);
    }
}
exports.StreamWish = StreamWish;
