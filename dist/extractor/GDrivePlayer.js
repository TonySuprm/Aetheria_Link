"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GDrivePlayer = void 0;
const MediaFlowProxyExtractor_1 = require("./MediaFlowProxyExtractor");
class GDrivePlayer extends MediaFlowProxyExtractor_1.MediaFlowProxyExtractor {
    id = 'gdriveplayer';
    label = 'GDrivePlayer';
    priority = 80;
    mfpHost = 'gdriveplayer.to';
}
exports.GDrivePlayer = GDrivePlayer;
