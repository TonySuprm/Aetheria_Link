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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HDEncode = void 0;
const bytes_1 = __importDefault(require("bytes"));
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const SIZE_RE = /([\d.]+)\s*(TB|GB|MB|KB)/i;
const parseSizeBytes = (text) => {
    const m = text.match(SIZE_RE);
    if (!m)
        return undefined;
    return bytes_1.default.parse(`${m[1]} ${m[2]}`) ?? undefined;
};
const normalize = (str) => str.toLowerCase()
    .replace(/\./g, ' ')
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
class HDEncode extends Source_1.Source {
    id = 'hdencode';
    label = 'HDEncode';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.en];
    baseUrl = 'https://hdencode.org';
    category = 'debrid';
    domainKey = 'hdencode';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async prewarm(ctx) {
        try {
            await this.fetcher.text(ctx, new URL(this.baseUrl));
            this.fetcher.getLogger().info('HDEncode: pre-warm complete', ctx);
        }
        catch (error) {
            this.fetcher.getLogger().warn(`HDEncode: pre-warm failed: ${error}`, ctx);
        }
    }
    async handleInternal(ctx, type, id) {
        if (!ctx.config.alldebridApiKey && !ctx.config.realdebridApiKey)
            return [];
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        const rss = await this.search(ctx, name);
        if (!rss)
            return [];
        const items = this.parseRss(rss, name, year, type, tmdbId.season, tmdbId.episode);
        if (items.length === 0) {
            this.fetcher.getLogger().info(`HDEncode: 0 matching releases for "${name}"`, ctx);
            return [];
        }
        // Prefer higher resolution, then larger file size.
        items.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bytes ?? 0) - (a.bytes ?? 0));
        const results = items.map((item) => {
            const cleanTitle = item.title
                .replace(/\s*[-–]\s*[\d.]+\s*(?:GB|MB|KB|TB)\s*$/i, '')
                .replace(/\./g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const meta = {
                title: `[HDEncode] ${cleanTitle}`,
                height: item.height,
                bytes: item.bytes,
                countryCodes: this.countryCodes,
                sourceLabel: this.label,
                sourceId: this.id,
                season: tmdbId.season,
                episode: tmdbId.episode,
            };
            return { url: item.url, meta };
        });
        this.fetcher.getLogger().info(`HDEncode: returning ${results.length} result(s) for "${name}"`, ctx);
        return results;
    }
    async search(ctx, query) {
        const slug = query.trim().split(/\s+/).map(encodeURIComponent).join('+');
        const pagePromises = [];
        for (let page = 1; page <= 3; page++) {
            const searchUrl = new URL(`/search/${slug}/feed/rss2/`, this.baseUrl);
            if (page > 1)
                searchUrl.searchParams.set('paged', String(page));
            pagePromises.push(this.fetcher.text(ctx, searchUrl, { timeout: 12000 })
                .catch(() => undefined));
        }
        const pages = await Promise.all(pagePromises);
        const combined = pages.filter((p) => !!p).join('\n');
        return combined || undefined;
    }
    parseRss(xml, name, year, type, season, episode) {
        const $ = cheerio.load(xml, { xmlMode: true });
        const nameClean = normalize(name);
        const groups = new Map();
        $('item').each((_i, el) => {
            const $item = $(el);
            const title = $item.find('title').text().trim();
            if (!title || !normalize(title).includes(nameClean))
                return;
            if (type === 'series' && season && episode) {
                const epMatch = title.match(/s0*(\d+)e0*(\d+)/i);
                if (!epMatch?.[1] || !epMatch?.[2]
                    || parseInt(epMatch[1], 10) !== season
                    || parseInt(epMatch[2], 10) !== episode) {
                    return;
                }
            }
            else if (type === 'movie') {
                if (/s0*\d+e0*\d+/i.test(title))
                    return;
                const yearMatch = title.match(/\b(19[89]\d|20\d{2})\b/);
                if (yearMatch && year && Math.abs(parseInt(yearMatch[0], 10) - year) > 1)
                    return;
            }
            const urls = [];
            $item.find('enclosure').each((_j, enc) => {
                const raw = $(enc).attr('url');
                if (!raw)
                    return;
                try {
                    const url = new URL(raw);
                    if ((0, utils_1.isDebridHoster)(url.host))
                        urls.push(url);
                }
                catch { /* invalid URL */ }
            });
            if (urls.length === 0)
                return;
            // Group by release title (without trailing size) so the same release
            // only produces one result even if it appears with both Rapidgator and
            // Nitroflare enclosures across pages.
            const titleKey = normalize(title.replace(/\s*[-–]\s*[\d.]+\s*(?:GB|MB|KB|TB)\s*$/i, ''));
            const existing = groups.get(titleKey);
            if (existing) {
                existing.urls.push(...urls);
            }
            else {
                groups.set(titleKey, {
                    title,
                    urls,
                    height: (0, utils_1.findHeight)(title),
                    bytes: parseSizeBytes(title),
                });
            }
        });
        const items = [];
        for (const group of groups.values()) {
            const rapidgator = group.urls.find(u => u.host.includes('rapidgator') || u.host === 'rg.to');
            const nitroflare = group.urls.find(u => u.host.includes('nitroflare'));
            const best = rapidgator ?? nitroflare ?? (0, utils_1.pickBestHoster)(group.urls);
            if (!best)
                continue;
            items.push({
                title: group.title,
                url: best,
                height: group.height,
                bytes: group.bytes,
            });
        }
        return items;
    }
}
exports.HDEncode = HDEncode;
