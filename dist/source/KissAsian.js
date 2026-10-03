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
exports.KissAsian = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
/**
 * Embed hosts that are consistently dead, quota-limited, or require browser JS/CAPTCHA
 * that the addon cannot solve server-side. Filtered out so users never see non-playable links.
 */
const DEAD_HOSTS = [
    'drive.google.com',
    'justplay.cam',
    'highload.to',
];
class KissAsian extends Source_1.Source {
    id = 'kissasian';
    label = 'KissAsian';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.ko, types_1.CountryCode.ja];
    baseUrl = 'https://kissasian.cam';
    category = 'asiandrama';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, _type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, _year, _original_name, original_language] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        // Strict Origin Lock: Prevent KissAsian from polluting English search queries natively.
        // By restricting execution to known SE Asian TMDB definitions, we guarantee it only runs on target media,
        // solving the pollution bug while letting it eagerly activate regardless of user language checkboxes.
        const asianLanguages = new Set(['ko', 'ja', 'zh', 'cn', 'th', 'vi']);
        if (original_language && !asianLanguages.has(original_language.toLowerCase())) {
            return [];
        }
        if (!name) {
            return [];
        }
        const searchUrl = new URL('https://kissasian.cam/');
        searchUrl.searchParams.set('s', name);
        try {
            const searchHtml = await this.fetcher.text(ctx, searchUrl, { noProxyHeaders: true });
            const $ = cheerio.load(searchHtml);
            const firstResult = $('a[href*="/series/"]').first().attr('href');
            if (!firstResult) {
                return [];
            }
            // Extract slug from series URL: /series/slug/ → slug
            const seriesUrl = new URL(firstResult);
            const slug = seriesUrl.pathname.split('/').filter(Boolean).pop();
            if (!slug) {
                return [];
            }
            const targetEpNumber = tmdbId.episode || 1;
            // Construct episode URL directly — skip fetching the series page entirely
            const episodeUrl = new URL(`https://kissasian.cam/${slug}-episode-${targetEpNumber}/`);
            const episodeHtml = await this.fetcher.text(ctx, episodeUrl, { noProxyHeaders: true });
            const $ep = cheerio.load(episodeHtml);
            // Collect iframes from the episode page itself
            const iframes = [];
            $ep('iframe').each((_, el) => {
                const src = $ep(el).attr('src')?.trim();
                if (src)
                    iframes.push(src);
            });
            // Collect mirror endpoints and fetch them ALL in parallel
            const mirrorEndpoints = [];
            $ep('select.mirror option, select option').each((_, el) => {
                const val = $ep(el).attr('value')?.trim();
                if (val && val.includes('/v/')) {
                    mirrorEndpoints.push(val);
                }
            });
            const mirrorResults = await Promise.all(mirrorEndpoints.map(async (mirrorUrl) => {
                try {
                    const fullUrl = mirrorUrl.startsWith('http') ? mirrorUrl : `https://kissasian.cam${mirrorUrl}`;
                    const mirrorHtml = await this.fetcher.text(ctx, new URL(fullUrl), { noProxyHeaders: true });
                    const $mirror = cheerio.load(mirrorHtml);
                    const mirrorIframes = [];
                    $mirror('iframe').each((_, el) => {
                        const src = $mirror(el).attr('src')?.trim();
                        if (src)
                            mirrorIframes.push(src);
                    });
                    return mirrorIframes;
                }
                catch {
                    return [];
                }
            }));
            for (const mirrorIframes of mirrorResults) {
                iframes.push(...mirrorIframes);
            }
            // Deduplicate and filter out dead hosts
            const distinctIframes = Array.from(new Set(iframes)).filter((embedUrl) => {
                try {
                    const host = new URL(embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl).host;
                    return !DEAD_HOSTS.some(dead => host === dead || host.endsWith('.' + dead));
                }
                catch {
                    return false;
                }
            });
            if (!distinctIframes.length) {
                return [];
            }
            return distinctIframes.map(embedUrl => ({
                url: new URL(embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl),
                meta: { title: `${name}`, referer: episodeUrl.href, countryCodes: this.countryCodes },
            }));
        }
        catch {
            return [];
        }
    }
}
exports.KissAsian = KissAsian;
