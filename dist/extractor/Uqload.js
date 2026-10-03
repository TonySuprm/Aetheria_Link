"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Uqload = void 0;
const utils_1 = require("../utils");
const MediaFlowProxyExtractor_1 = require("./MediaFlowProxyExtractor");
class Uqload extends MediaFlowProxyExtractor_1.MediaFlowProxyExtractor {
    id = 'uqload';
    label = 'Uqload';
    mfpHost = 'uqload';
    supports(ctx, url) {
        const supportedDomain = null !== url.host.match(/uqload/);
        return supportedDomain && (0, utils_1.supportsMediaFlowProxy)(ctx);
    }
}
exports.Uqload = Uqload;
