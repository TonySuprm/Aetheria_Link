"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuperVideo = void 0;
const utils_1 = require("../utils");
const MediaFlowProxyExtractor_1 = require("./MediaFlowProxyExtractor");
class SuperVideo extends MediaFlowProxyExtractor_1.MediaFlowProxyExtractor {
    id = 'supervideo';
    label = 'SuperVideo';
    mfpHost = 'supervideo';
    supports(ctx, url) {
        const supportedDomain = url.host === 'supervideo.tv';
        return supportedDomain && (0, utils_1.supportsMediaFlowProxy)(ctx);
    }
}
exports.SuperVideo = SuperVideo;
