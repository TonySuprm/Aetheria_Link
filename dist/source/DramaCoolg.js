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
exports.DramaCoolg = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
class DramaCoolg extends Source_1.Source {
    id = 'dramacoolg';
    label = 'DramaCoolg';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.ko, types_1.CountryCode.ja, types_1.CountryCode.zh];
    baseUrl = 'https://dramacoolg.top';
    category = 'asiandrama';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, _type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        try {
            // 1. Search for the drama
            const searchUrl = new URL(this.baseUrl);
            searchUrl.searchParams.set('s', name);
            const searchHtml = await this.fetcher.text(ctx, searchUrl, { noProxyHeaders: true });
            const $ = cheerio.load(searchHtml);
            // Find drama-detail links from search results
            const detailLinks = [];
            $('a[href*="/drama-detail/"]').each((_, el) => {
                const href = $(el).attr('href');
                if (href && !detailLinks.includes(href)) {
                    detailLinks.push(href);
                }
            });
            if (detailLinks.length === 0)
                return [];
            // Pick the best-matching drama-detail link
            const searchName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            let bestDetail = detailLinks[0];
            for (const link of detailLinks) {
                const slug = link.split('/drama-detail/')[1]?.replace(/\/$/, '') ?? '';
                if (slug.includes(searchName) || searchName.includes(slug.replace(/-\d{4}$/, ''))) {
                    bestDetail = link;
                    break;
                }
            }
            // 2. Fetch the drama-detail page to find episode links
            const detailUrl = new URL(bestDetail, this.baseUrl);
            const detailHtml = await this.fetcher.text(ctx, detailUrl, {
                noProxyHeaders: true,
                validateStatus: () => true,
            });
            const $detail = cheerio.load(detailHtml);
            const targetEpNumber = tmdbId.episode || 1;
            // Find episode links matching the target episode number
            const episodeLinks = [];
            $detail(`a[href*="-episode-${targetEpNumber}/"], a[href*="-episode-${targetEpNumber}"]`).each((_, el) => {
                const href = $detail(el).attr('href');
                if (href && href.includes(`-episode-${targetEpNumber}`)) {
                    // Ensure exact episode match (e.g. episode-1 should not match episode-10)
                    const epMatch = href.match(/-episode-(\d+)/);
                    if (epMatch && parseInt(epMatch[1], 10) === targetEpNumber) {
                        episodeLinks.push(href);
                    }
                }
            });
            if (episodeLinks.length === 0)
                return [];
            // 3. Fetch the episode page and extract embeds
            const episodeUrl = new URL(episodeLinks[0], this.baseUrl);
            const episodeHtml = await this.fetcher.text(ctx, episodeUrl, {
                noProxyHeaders: true,
                validateStatus: () => true,
            });
            const $ep = cheerio.load(episodeHtml);
            const iframeSrcs = [];
            // Collect all iframe sources
            $ep('iframe').each((_, el) => {
                const src = $ep(el).attr('src')?.trim();
                if (src)
                    iframeSrcs.push(src);
            });
            // Also collect data-src attributes
            $ep('[data-src], [data-url], [data-video]').each((_, el) => {
                const d = ($ep(el).attr('data-src') || $ep(el).attr('data-url') || $ep(el).attr('data-video'))?.trim();
                if (d && d.includes('http'))
                    iframeSrcs.push(d);
            });
            // 4. Resolve embedload.cfd wrapper to the inner embed URL
            const results = [];
            for (const iframeSrc of iframeSrcs) {
                try {
                    const iframeUrl = iframeSrc.startsWith('//') ? `https:${iframeSrc}` : iframeSrc;
                    if (iframeUrl.includes('embedload.cfd') || iframeUrl.includes('embedload.')) {
                        // Resolve the embedload wrapper to get the inner embed
                        const embedHtml = await this.fetcher.text(ctx, new URL(iframeUrl), {
                            noProxyHeaders: true,
                            headers: { 'Referer': episodeUrl.href },
                            validateStatus: () => true,
                        });
                        const $embed = cheerio.load(embedHtml);
                        $embed('iframe').each((_, el) => {
                            const innerSrc = $embed(el).attr('src')?.trim();
                            if (innerSrc && innerSrc.includes('http')) {
                                results.push({
                                    url: new URL(innerSrc),
                                    meta: {
                                        title: name,
                                        referer: iframeUrl,
                                        countryCodes: this.countryCodes,
                                    },
                                });
                            }
                        });
                    }
                    else {
                        // Direct embed URL (dramacool.men etc.)
                        results.push({
                            url: new URL(iframeUrl),
                            meta: {
                                title: name,
                                referer: episodeUrl.href,
                                countryCodes: this.countryCodes,
                            },
                        });
                    }
                }
                catch { /* ignore individual iframe failures */ }
            }
            // Deduplicate by URL
            const seen = new Set();
            return results.filter(r => {
                const key = r.url.href;
                if (seen.has(key))
                    return false;
                seen.add(key);
                return true;
            });
        }
        catch {
            return [];
        }
    }
}
exports.DramaCoolg = DramaCoolg;
