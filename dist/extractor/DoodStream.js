"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoodStream = void 0;
const utils_1 = require("../utils");
const MediaFlowProxyExtractor_1 = require("./MediaFlowProxyExtractor");
class DoodStream extends MediaFlowProxyExtractor_1.MediaFlowProxyExtractor {
    id = 'doodstream';
    label = 'DoodStream';
    mfpHost = 'doodstream';
    supports(ctx, url) {
        const supportedDomain = null !== url.host.match(/doodstream|dood\.to|dood\.watch|dood\.pm|dood\.re|dood\.so|dood\.ws|dood\.cx|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|doods\.pro/);
        return supportedDomain && (0, utils_1.supportsMediaFlowProxy)(ctx);
    }
}
exports.DoodStream = DoodStream;
