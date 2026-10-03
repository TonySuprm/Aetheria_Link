"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Voe = void 0;
const utils_1 = require("../utils");
const MediaFlowProxyExtractor_1 = require("./MediaFlowProxyExtractor");
class Voe extends MediaFlowProxyExtractor_1.MediaFlowProxyExtractor {
    id = 'voe';
    label = 'VOE';
    mfpHost = 'voe';
    supports(ctx, url) {
        const supportedDomain = url.host === 'voe.sx' || url.host === 'voe.video';
        return supportedDomain && (0, utils_1.supportsMediaFlowProxy)(ctx);
    }
}
exports.Voe = Voe;
