"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileMoon = void 0;
const utils_1 = require("../utils");
const MediaFlowProxyExtractor_1 = require("./MediaFlowProxyExtractor");
class FileMoon extends MediaFlowProxyExtractor_1.MediaFlowProxyExtractor {
    id = 'filemoon';
    label = 'FileMoon';
    mfpHost = 'filemoon';
    supports(ctx, url) {
        const supportedDomain = url.host === 'filemoon.sx' || url.host === 'filemoon.to';
        return supportedDomain && (0, utils_1.supportsMediaFlowProxy)(ctx);
    }
}
exports.FileMoon = FileMoon;
