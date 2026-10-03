"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DDLValley = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const normalize = (str) => str.toLowerCase()
    .replace(/\./g, ' ')
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
class DDLValley extends Source_1.Source {
    id = 'ddlvalley';
    label = 'DDLValley';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.en];
    baseUrl = 'https://www.ddlvalley.me';
    category = 'debrid';
    domainKey = 'ddlvalley';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, type, id) {
        if (!ctx.config.alldebridApiKey && !ctx.config.realdebridApiKey)
            return [];
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        let posts = [];
        if (type === 'series' && tmdbId.season && tmdbId.episode) {
            // WordPress search is Cloudflare-protected; daily archives are cached
            // and load without a challenge, so start with the episode air-date page.
            posts = await this.searchByAirDateArchive(ctx, tmdbId, name);
        }
        if (posts.length === 0) {
            const searchHtml = await this.search(ctx, name);
            if (searchHtml) {
                posts = this.parseSearchResults(searchHtml, name, year, tmdbId.season, tmdbId.episode);
            }
        }
        if (posts.length === 0)
            return [];
        this.fetcher.getLogger().info(`DDLValley: found ${posts.length} matching posts for "${name}"`, ctx);
        const results = [];
        const topPosts = posts.slice(0, 5);
        await Promise.all(topPosts.map(async (post) => {
            const links = await this.fetchPostLinks(ctx, post.url);
            for (const link of links) {
                const meta = {
                    title: `[DDLValley] ${post.title}`,
                    height: post.height,
                    countryCodes: this.countryCodes,
                    sourceLabel: this.label,
                    sourceId: this.id,
                    season: tmdbId.season,
                    episode: tmdbId.episode,
                };
                results.push({ url: link, meta });
            }
        }));
        this.fetcher.getLogger().info(`DDLValley: returning ${results.length} result(s) for "${name}"`, ctx);
        return results;
    }
    async search(ctx, query) {
        const searchUrl = new URL(`/?s=${encodeURIComponent(query)}`, this.baseUrl);
        try {
            return await this.fetcher.text(ctx, searchUrl, { timeout: 15000 });
        }
        catch {
            return undefined;
        }
    }
    async searchByAirDateArchive(ctx, tmdbId, name) {
        const airDate = await (0, utils_1.getTmdbEpisodeAirDate)(ctx, this.fetcher, tmdbId);
        if (!airDate)
            return [];
        const base = new Date(airDate);
        if (Number.isNaN(base.getTime()))
            return [];
        const offsets = [0, -1, 1, -2, 2];
        const posts = [];
        await Promise.all(offsets.map(async (offset) => {
            const date = new Date(base);
            date.setDate(date.getDate() + offset);
            const archiveUrl = new URL(`/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/`, this.baseUrl);
            try {
                const html = await this.fetcher.text(ctx, archiveUrl, { timeout: 12000 });
                if (!html)
                    return;
                const dayPosts = this.parseSearchResults(html, name, 0, tmdbId.season, tmdbId.episode);
                if (dayPosts.length > 0) {
                    posts.push(...dayPosts);
                }
            }
            catch { /* archive day missing or blocked */ }
        }));
        return posts;
    }
    parseSearchResults(html, name, year, season, episode) {
        const $ = cheerio.load(html);
        const nameClean = normalize(name);
        const posts = [];
        const seenHrefs = new Set();
        const collect = (titleText, href) => {
            if (!titleText || !href)
                return;
            const titleClean = normalize(titleText);
            if (!titleClean.includes(nameClean))
                return;
            if (!season) {
                const yearMatch = titleText.match(/\b(19[89]\d|20\d{2})\b/);
                if (yearMatch && year && Math.abs(parseInt(yearMatch[0], 10) - year) > 1)
                    return;
            }
            if (season && episode) {
                const epMatch = titleText.match(/s0*(\d+)e0*(\d+)/i);
                if (!epMatch?.[1] || !epMatch?.[2] || parseInt(epMatch[1], 10) !== season || parseInt(epMatch[2], 10) !== episode)
                    return;
            }
            if (seenHrefs.has(href))
                return;
            seenHrefs.add(href);
            const height = (0, utils_1.findHeight)(titleText);
            try {
                posts.push({
                    url: new URL(href, this.baseUrl),
                    title: titleText.replace(/\./g, ' ').replace(/\s+/g, ' ').trim(),
                    height,
                });
            }
            catch { /* invalid URL */ }
        };
        $('h2 a[rel="bookmark"]').each((_i, el) => {
            const $el = $(el);
            collect($el.text().trim(), $el.attr('href') ?? '');
        });
        if (posts.length === 0) {
            $('a[rel="bookmark"]').each((_i, el) => {
                const $el = $(el);
                collect($el.text().trim(), $el.attr('href') ?? '');
            });
        }
        return posts;
    }
    async fetchPostLinks(ctx, postUrl) {
        let html;
        try {
            html = await this.fetcher.text(ctx, postUrl, { timeout: 12000 });
        }
        catch {
            return [];
        }
        const $ = cheerio.load(html);
        const seenHrefs = new Set();
        // Group hoster links by normalized filename so we return only ONE hoster
        // per file (NitroFlare preferred). A single DDLValley post often has both
        // NitroFlare and RapidGator for the same .mkv — returning both creates
        // duplicate streams in Stremio for the same release.
        const fileMap = new Map();
        $('a[href]').each((_i, el) => {
            const href = $(el).attr('href');
            if (!href)
                return;
            try {
                const url = new URL(href);
                if (!(0, utils_1.isDebridHoster)(url.host))
                    return;
                if (/\.part\d+\.rar/i.test(url.pathname))
                    return;
                if (seenHrefs.has(url.href))
                    return;
                seenHrefs.add(url.href);
                const fileKey = (0, utils_1.normalizeFilename)(url);
                const bucket = fileMap.get(fileKey);
                if (bucket) {
                    bucket.push(url);
                }
                else {
                    fileMap.set(fileKey, [url]);
                }
            }
            catch { /* invalid URL */ }
        });
        // Return all debrid hoster URLs — the eager AllDebrid/RealDebrid extractor
        // resolves each one at stream-list time. Failing hosters (e.g. NitroFlare
        // under maintenance on AllDebrid) are filtered out; working ones (e.g.
        // Rapidgator) become direct CDN URL streams. Cross-source dedup in
        // StreamResolver collapses the same file from different hosters.
        return [...fileMap.values()].flat();
    }
}
exports.DDLValley = DDLValley;
