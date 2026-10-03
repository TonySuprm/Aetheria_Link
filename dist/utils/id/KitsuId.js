"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KitsuId = void 0;
class KitsuId {
    id;
    season = undefined;
    episode;
    constructor(id, episode) {
        this.id = id;
        this.episode = episode;
    }
    static fromString(id) {
        const idParts = id.split(':');
        if (!idParts[0] || !/^\d+$/.test(idParts[0])) {
            throw new Error(`Kitsu ID "${id}" is invalid`);
        }
        return new KitsuId(idParts[0], idParts[1] ? parseInt(idParts[1], 10) : undefined);
    }
    toString() {
        return this.episode !== undefined ? `${this.id}:${this.episode}` : this.id;
    }
}
exports.KitsuId = KitsuId;
