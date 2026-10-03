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
exports.RapidMoviez = void 0;
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
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
class RapidMoviez extends Source_1.Source {
    id = 'rapidmoviez';
    label = 'RapidMoviez';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.en];
    baseUrl = 'https://rapidmoviez.lat';
    category = 'debrid';
    domainKey = 'rapidmoviez';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async prewarm(ctx) {
        try {
            await this.fetcher.text(ctx, new URL(this.baseUrl));
            this.fetcher.getLogger().info('RapidMoviez: pre-warm complete', ctx);
        }
        catch (error) {
            this.fetcher.getLogger().warn(`RapidMoviez: pre-warm failed: ${error}`, ctx);
        }
    }
    async handleInternal(ctx, type, id) {
        if (!ctx.config.alldebridApiKey && !ctx.config.realdebridApiKey)
            return [];
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        const mode = type === 'series' ? 's' : 'm';
        const searchHtml = await this.search(ctx, name, mode);
        if (!searchHtml)
            return [];
        // Try to find the show page link from search results, but fall back to
        // constructing it directly — the show page URL is predictable:
        // /<show-name-with-hyphens>/<mode> (e.g. /house-of-the-dragon/s).
        const slug = name.trim().toLowerCase().split(/\s+/).join('-');
        const showPageUrl = this.findShowPageUrl(searchHtml, name, mode)
            ?? new URL(`/${slug}/${mode}`, this.baseUrl);
        const showHtml = await this.fetchPage(ctx, showPageUrl);
        if (!showHtml)
            return [];
        const releases = this.parseShowReleases(showHtml, name, year, tmdbId.season, tmdbId.episode);
        if (releases.length === 0)
            return [];
        this.fetcher.getLogger().info(`RapidMoviez: found ${releases.length} matching releases for "${name}"`, ctx);
        const topReleases = releases.slice(0, 10);
        const results = [];
        await Promise.all(topReleases.map(async (release) => {
            const links = await this.fetchReleaseLinks(ctx, release.url);
            for (const link of links) {
                const meta = {
                    title: `[RapidMoviez] ${release.title}`,
                    height: release.height,
                    bytes: release.bytes,
                    countryCodes: this.countryCodes,
                    sourceLabel: this.label,
                    sourceId: this.id,
                    season: tmdbId.season,
                    episode: tmdbId.episode,
                };
                results.push({ url: link, meta });
            }
        }));
        this.fetcher.getLogger().info(`RapidMoviez: returning ${results.length} result(s) for "${name}"`, ctx);
        return results;
    }
    /** Search via GET (the POST form 302-redirects with '+' in the URL which breaks
     *  axios — `ERR_FR_REDIRECTION_FAILURE`). The redirect target is
     *  `/search/<query>/all/query/<mode>`, so we GET it directly. */
    async search(ctx, query, mode) {
        const slug = query.trim().split(/\s+/).join('-');
        const searchUrl = new URL(`/search/${encodeURIComponent(slug)}/all/query/${mode}`, this.baseUrl);
        try {
            return await this.fetcher.text(ctx, searchUrl, { timeout: 15000 });
        }
        catch {
            return undefined;
        }
    }
    /** Find the show/movie page link from search results. The link format is
     *  `/<show-slug>/<mode>` (e.g. `/house-of-the-dragon/s`), excluding
     *  /release/, /search/, /tag/, etc. */
    findShowPageUrl(html, name, mode) {
        const $ = cheerio.load(html);
        const nameClean = normalize(name);
        let showUrl;
        $('a[href]').each((_i, el) => {
            if (showUrl)
                return;
            const $el = $(el);
            const href = $el.attr('href') ?? '';
            const title = $el.attr('title') ?? $el.text().trim();
            if (!href.endsWith(`/${mode}`))
                return;
            if (href.includes('/release/') || href.includes('/search/') || href.includes('/tag/')
                || href.includes('/genre/') || href.includes('/category/') || href.includes('/type/')
                || href.includes('/author/') || href.includes('/thumbnail'))
                return;
            if (title && normalize(title).includes(nameClean)) {
                try {
                    showUrl = new URL(href, this.baseUrl);
                }
                catch { /* invalid URL */ }
            }
        });
        return showUrl;
    }
    async fetchPage(ctx, url) {
        try {
            return await this.fetcher.text(ctx, url, { timeout: 15000 });
        }
        catch {
            return undefined;
        }
    }
    /** Parse the show page for releases matching the requested episode (or movie).
     *  The show page lists all releases in `<li>` elements with
     *  `<a href="/release/<slug>">[RR/NF] Show S03E01 1080p WEB (4.6GB)</a>`. */
    parseShowReleases(html, name, year, season, episode) {
        const $ = cheerio.load(html);
        const nameClean = normalize(name);
        const releases = [];
        const seenHrefs = new Set();
        $('a[href*="/release/"]').each((_i, el) => {
            const $el = $(el);
            const href = $el.attr('href') ?? '';
            const titleText = $el.text().trim();
            if (!titleText || !href)
                return;
            const titleClean = normalize(titleText);
            if (!titleClean.includes(nameClean))
                return;
            if (season && episode) {
                const epMatch = titleText.match(/s0*(\d+)e0*(\d+)/i);
                if (!epMatch?.[1] || !epMatch?.[2] || parseInt(epMatch[1], 10) !== season || parseInt(epMatch[2], 10) !== episode)
                    return;
            }
            if (!season) {
                const yearMatch = titleText.match(/\b(19[89]\d|20\d{2})\b/);
                if (yearMatch && year && Math.abs(parseInt(yearMatch[0], 10) - year) > 1)
                    return;
            }
            if (seenHrefs.has(href))
                return;
            seenHrefs.add(href);
            const height = (0, utils_1.findHeight)(titleText);
            const fileSize = parseSizeBytes(titleText);
            try {
                releases.push({
                    url: new URL(href, this.baseUrl),
                    title: titleText,
                    height,
                    bytes: fileSize,
                });
            }
            catch { /* invalid URL */ }
        });
        releases.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
        return releases;
    }
    async fetchReleaseLinks(ctx, releaseUrl) {
        let html;
        try {
            html = await this.fetcher.text(ctx, releaseUrl, { timeout: 12000 });
        }
        catch {
            return [];
        }
        const $ = cheerio.load(html);
        const allUrls = [];
        const seenPaths = new Set();
        $('pre.links').each((_i, el) => {
            const inner = $(el).html() ?? '';
            const match = inner.match(/<!--sse-->(.+?)<!--\/sse-->/);
            if (!match?.[1])
                return;
            try {
                const url = new URL(match[1].trim());
                // RapidRAR and ClicknUpload posts use rotating mirror domains
                // (rapidrar.cr/cloud/online/space/site, clicknupload.click/link/org/...).
                // RealDebrid (and the common debrid allow-list) recognises the .com/.me
                // canonical domains, so rewrite before passing the link to the debrid
                // extractors. Otherwise each mirror appears as a separate failed link.
                url.host = this.canonicalizeDebridHost(url.host);
                if (!(0, utils_1.isDebridHoster)(url.host))
                    return;
                const pathKey = url.pathname;
                if (seenPaths.has(pathKey))
                    return;
                seenPaths.add(pathKey);
                allUrls.push(url);
            }
            catch { /* invalid URL */ }
        });
        // Return all debrid hoster URLs — the eager extractor resolves each one.
        // Failing hosters are filtered out; working ones become direct streams.
        return allUrls;
    }
    canonicalizeDebridHost(host) {
        const h = host.toLowerCase();
        if (/^rapidrar\./.test(h))
            return 'rapidrar.com';
        if (/^clicknupload\./.test(h))
            return 'clicknupload.me';
        return h;
    }
}
exports.RapidMoviez = RapidMoviez;
