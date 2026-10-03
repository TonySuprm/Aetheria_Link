"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MkvKing = void 0;
const bytes_1 = __importDefault(require("bytes"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const PLAYER_KEY = 'f6e324cd9c321d6c6898d09c769478b2273a3a55';
const API_BASE = 'https://streams.iqsmartgames.com';
const DDN_BASE = 'https://ddn.iqsmartgames.com/file';
const parseSizeBytes = (text) => {
    const cleaned = text.replace(/,/g, '').trim();
    const parsed = bytes_1.default.parse(cleaned);
    return parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
class MkvKing extends Source_1.Source {
    id = 'mkvking';
    label = 'MkvKing';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.en];
    baseUrl = 'https://e.mkvking.dad';
    category = 'hollywood';
    domainKey = 'mkvking';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const numericId = tmdbId.id;
        if (!numericId)
            return [];
        const apiUrl = this.buildApiUrl(type, numericId, tmdbId.season, tmdbId.episode);
        if (!apiUrl)
            return [];
        let response;
        try {
            response = await this.fetcher.json(ctx, apiUrl, { timeout: 12000 });
        }
        catch {
            return [];
        }
        if (!response?.success || !Array.isArray(response.data) || response.data.length === 0) {
            return [];
        }
        const results = [];
        for (const entry of response.data) {
            if (!entry.fileslug)
                continue;
            const url = new URL(`${DDN_BASE}/${entry.fileslug}`);
            const meta = {
                title: `[MkvKing] ${entry.filename}`,
                height: (0, utils_1.findHeight)(entry.filename),
                bytes: parseSizeBytes(entry.fsize),
                countryCodes: this.countryCodes,
                sourceLabel: this.label,
                sourceId: this.id,
                referer: 'https://pro.iqsmartgames.com/',
                season: tmdbId.season,
                episode: tmdbId.episode,
            };
            results.push({ url, meta });
        }
        this.fetcher.getLogger().info(`MkvKing: returning ${results.length} result(s)`, ctx);
        return results;
    }
    buildApiUrl(type, id, season, episode) {
        if (type === 'movie') {
            return new URL(`${API_BASE}/mymovieapi?tmdbid=${id}&key=${PLAYER_KEY}`);
        }
        if (type === 'series' && season && episode) {
            return new URL(`${API_BASE}/myseriesapi?tmdbid=${id}&season=${season}&epname=${encodeURIComponent(String(episode))}&key=${PLAYER_KEY}`);
        }
        return undefined;
    }
}
exports.MkvKing = MkvKing;
