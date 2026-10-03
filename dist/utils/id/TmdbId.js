"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KitsuMappedTmdbId = exports.TmdbId = void 0;
class TmdbId {
    id;
    season;
    episode;
    constructor(id, season, episode) {
        this.id = id;
        this.season = season;
        this.episode = episode;
    }
    static fromString(id) {
        const idParts = id.split(':');
        if (!idParts[0] || !/^\d+$/.test(idParts[0])) {
            throw new Error(`TMDB ID "${id}" is invalid`);
        }
        return new TmdbId(parseInt(idParts[0]), idParts[1] ? parseInt(idParts[1]) : undefined, idParts[2] ? parseInt(idParts[2]) : undefined);
    }
    toString() {
        return this.season ? `${this.id}:${this.season}:${this.episode}` : `${this.id}`;
    }
    formatSeasonAndEpisode() {
        return `S${String(this.season).padStart(2, '0')}E${String(this.episode).padStart(2, '0')}`;
    }
}
exports.TmdbId = TmdbId;
/**
 * Fallback TmdbId produced when a Kitsu ID cannot be mapped to a real TMDB entry.
 * It carries the Kitsu metadata so downstream sources can still search by title.
 */
class KitsuMappedTmdbId extends TmdbId {
    kitsuName;
    kitsuYear;
    kitsuOriginalName;
    kitsuOriginalLanguage;
    constructor(id, season, episode, kitsuName, kitsuYear, kitsuOriginalName, kitsuOriginalLanguage) {
        super(id, season, episode);
        this.kitsuName = kitsuName;
        this.kitsuYear = kitsuYear;
        this.kitsuOriginalName = kitsuOriginalName;
        this.kitsuOriginalLanguage = kitsuOriginalLanguage;
    }
}
exports.KitsuMappedTmdbId = KitsuMappedTmdbId;
