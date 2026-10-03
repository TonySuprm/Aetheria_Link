"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Playmogo = void 0;
const MediaFlowProxyExtractor_1 = require("./MediaFlowProxyExtractor");
class Playmogo extends MediaFlowProxyExtractor_1.MediaFlowProxyExtractor {
    id = 'playmogo';
    label = 'Playmogo';
    priority = 80;
    mfpHost = 'playmogo.com';
}
exports.Playmogo = Playmogo;
