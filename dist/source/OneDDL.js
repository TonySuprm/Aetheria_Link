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
exports.OneDDL = void 0;
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
const EXCLUDED_PATH_PATTERNS = ['/payment', '/account/registration', '/register', '/ref/'];
class OneDDL extends Source_1.Source {
    id = 'oneddl';
    label = '1DDL';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.en];
    baseUrl = 'https://1ddl.org';
    category = 'debrid';
    domainKey = 'oneddl';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async prewarm(ctx) {
        try {
            await this.fetcher.text(ctx, new URL(this.baseUrl));
            this.fetcher.getLogger().info('1DDL: pre-warm complete', ctx);
        }
        catch (error) {
            this.fetcher.getLogger().warn(`1DDL: pre-warm failed: ${error}`, ctx);
        }
    }
    async handleInternal(ctx, _type, id) {
        if (!ctx.config.alldebridApiKey && !ctx.config.realdebridApiKey)
            return [];
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        const searchHtml = await this.search(ctx, name);
        if (!searchHtml)
            return [];
        const posts = this.parseSearchResults(searchHtml, name, year, tmdbId.season, tmdbId.episode);
        if (posts.length === 0) {
            const articleCount = (searchHtml.match(/class="column is-12 article"/g) ?? []).length;
            this.fetcher.getLogger().info(`1DDL: 0 matching posts for "${name}" (searched ${articleCount} articles, S${tmdbId.season}E${tmdbId.episode})`, ctx);
            return [];
        }
        this.fetcher.getLogger().info(`1DDL: found ${posts.length} matching posts for "${name}"`, ctx);
        const topPosts = posts.slice(0, 10);
        const results = [];
        await Promise.all(topPosts.map(async (post) => {
            const links = await this.fetchPostLinks(ctx, post.url);
            for (const link of links) {
                const meta = {
                    title: `[1DDL] ${post.title}`,
                    height: link.height ?? post.height,
                    bytes: link.bytes,
                    countryCodes: this.countryCodes,
                    sourceLabel: this.label,
                    sourceId: this.id,
                    season: tmdbId.season,
                    episode: tmdbId.episode,
                };
                results.push({ url: link.url, meta });
            }
        }));
        this.fetcher.getLogger().info(`1DDL: returning ${results.length} result(s) for "${name}"`, ctx);
        return results;
    }
    async search(ctx, query) {
        const slug = query.trim().split(/\s+/).join('-');
        const pagePromises = [];
        for (let page = 1; page <= 3; page++) {
            const searchUrl = new URL(`/search/${encodeURIComponent(slug)}`, this.baseUrl);
            if (page > 1)
                searchUrl.searchParams.set('page', String(page));
            pagePromises.push(this.fetcher.text(ctx, searchUrl, { timeout: 15000 })
                .catch(() => undefined));
        }
        const pages = await Promise.all(pagePromises);
        const combined = pages.filter((p) => !!p).join('\n');
        return combined || undefined;
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
            if (season && episode && !/s0*\d+e0*\d+/i.test(titleText) && /complete|pack|s0*\d+\s*complete/i.test(titleText))
                return;
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
        $('.article h2.title a').each((_i, el) => {
            const $el = $(el);
            const title = $el.attr('title') ?? $el.text().trim();
            collect(title, $el.attr('href') ?? '');
        });
        if (posts.length === 0) {
            $('h2 a, h1 a').each((_i, el) => {
                const $el = $(el);
                const title = $el.attr('title') ?? $el.text().trim();
                collect(title, $el.attr('href') ?? '');
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
        const allUrls = [];
        const seenHrefs = new Set();
        const contentText = $('.content.item-content').text();
        const postBytes = parseSizeBytes(contentText);
        const resMatch = contentText.match(/(\d{3,4})\s*[*x]\s*(\d{3,4})/);
        const contentHeight = resMatch?.[2] ? parseInt(resMatch[2], 10) : undefined;
        const collectLink = (href) => {
            if (!href)
                return;
            try {
                const url = new URL(href);
                if (!(0, utils_1.isDebridHoster)(url.host))
                    return;
                if (/\.part\d+\.rar/i.test(url.pathname))
                    return;
                if (EXCLUDED_PATH_PATTERNS.some(p => url.pathname.toLowerCase().includes(p)))
                    return;
                if (seenHrefs.has(url.href))
                    return;
                seenHrefs.add(url.href);
                allUrls.push(url);
            }
            catch { /* invalid URL */ }
        };
        $('.multi-link a[href]').each((_i, el) => {
            collectLink($(el).attr('href') ?? '');
        });
        if (allUrls.length === 0) {
            $('.content.item-content a[href]').each((_i, el) => {
                collectLink($(el).attr('href') ?? '');
            });
        }
        // Return all debrid hoster URLs — the eager extractor resolves each one.
        // Failing hosters are filtered out; working ones become direct streams.
        if (allUrls.length === 0)
            return [];
        return allUrls.map(url => ({ url, height: contentHeight, bytes: postBytes }));
    }
}
exports.OneDDL = OneDDL;
