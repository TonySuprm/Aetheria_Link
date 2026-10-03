"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KissKh = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const winston_1 = __importDefault(require("winston"));
class KissKh extends Source_1.Source {
    id = 'kisskh';
    label = 'KissKH';
    baseUrl = 'https://kisskh.do';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi];
    fetcher;
    logger = winston_1.default.createLogger({ transports: [new winston_1.default.transports.Console()] });
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name) {
            return [];
        }
        let foundDramaId = null;
        let foundDramaTitle = null;
        try {
            const searchUrl = new URL(`/api/DramaList/Search?q=${encodeURIComponent(name)}`, this.baseUrl);
            const searchJson = await this.fetcher.json(ctx, searchUrl);
            if (searchJson) {
                const firstMatch = searchJson[0];
                if (firstMatch) {
                    foundDramaId = firstMatch.id;
                    foundDramaTitle = firstMatch.title;
                }
            }
        }
        catch (e) {
            this.logger.warn(`[KissKh] Search failed: ${e}`);
        }
        if (!foundDramaId) {
            return [];
        }
        try {
            const s = tmdbId.season;
            const e = tmdbId.episode;
            const infoUrl = new URL(`/api/DramaList/Drama/${foundDramaId}?isq=false`, this.baseUrl);
            const infoJson = await this.fetcher.json(ctx, infoUrl);
            let epId = null;
            if (type === 'movie') {
                epId = infoJson.episodes?.[0]?.id ?? null;
            }
            else if (s && e) {
                const targetEp = typeof e === 'string' ? parseInt(e, 10) : e;
                const epMatch = infoJson.episodes?.find((ep) => ep.number === targetEp);
                epId = epMatch?.id ?? null;
            }
            if (!epId) {
                return [];
            }
            let m3u8Url = null;
            const parsedTitle = foundDramaTitle?.replace(/([^a-zA-Z0-9]+)/g, '-') || 'Show';
            const episodePageUrl = new URL(`/Drama/${parsedTitle}/Episode-${e || 1}?id=${foundDramaId}&ep=${epId}&pn=1`, this.baseUrl);
            this.logger.info(`[KissKh] Extracting Stream tokens securely via Puppeteer context: ${episodePageUrl.href}`, ctx);
            await (0, utils_1.puppeteerFetch)(this.logger, episodePageUrl.href, {
                waitUntil: 'networkidle2',
                timeout: 25000,
                evaluate: async (page) => {
                    page.on('response', async (res) => {
                        if (res.url().includes('/api/DramaList/Episode/') && res.url().includes('.png') && res.url().includes('kkey=')) {
                            try {
                                const text = await res.text();
                                const json = JSON.parse(text);
                                if (json.Video) {
                                    m3u8Url = json.Video;
                                }
                            }
                            catch (err) { }
                        }
                    });
                    await new Promise(r => setTimeout(r, 6000));
                    return m3u8Url || '';
                }
            });
            if (!m3u8Url) {
                this.logger.warn(`[KissKh] Failed to capture embedded m3u8 mapping from XHR buffers natively.`);
                return [];
            }
            return [{
                    url: new URL(m3u8Url),
                    meta: { title: `${name}`, countryCodes: this.countryCodes }
                }];
        }
        catch (err) {
            this.logger.warn(`[KissKh] Error fetching episodes: ${err}`);
            return [];
        }
    }
}
exports.KissKh = KissKh;
