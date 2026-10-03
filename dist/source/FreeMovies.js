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
exports.FreeMovies = void 0;
const bytes_1 = __importDefault(require("bytes"));
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const SIZE_RE = /([\d.]+)\s*(TB|GB|MB|KB)/i;
const SIZE_LABEL_RE = /File size\s*[-:]?\s*([\d.]+\s*(?:TB|GB|MB|KB))/i;
/** Parse a file size (e.g. "3.05 GiB", "1.69 GiB") from media-info text into bytes. */
const parseSizeBytes = (text) => {
    const m = text.match(SIZE_RE);
    if (!m)
        return undefined;
    return bytes_1.default.parse(`${m[1]} ${m[2]}`) ?? undefined;
};
/** Strip punctuation and normalise for fuzzy title comparison. */
const normalize = (str) => str.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
/** Hoster domains backed by an extractor that returns a short, immediately
 *  playable URL. Pattern suffixes are used so variants like pixeldrain.dev are
 *  also accepted. GoFile and SendCm/SendNow are intentionally excluded:
 *  - GoFile's contents API now requires a premium account and fails for guests.
 *  - send.now is behind Cloudflare Turnstile and frequently serves dead links.
 *  Keeping them produced long `/extract/` proxy URLs that never played. */
const SUPPORTED_HOSTERS = [
    'mega.nz',
    'mega.co',
    'pixeldrain.',
    'usersdrive.',
];
const isSupportedHoster = (host) => SUPPORTED_HOSTERS.some(h => host.includes(h));
/** Preferred order for FreeMovies hosters. Mega is the fastest/most reliable, PixelDrain
 *  is the next-best fallback, and UsersDrive is last (requires debrid and often reports
 *  dead links). */
const HOSTER_PRIORITY = {
    'mega.nz': 1,
    'mega.co': 1,
    'pixeldrain.': 2,
    'usersdrive.': 3,
};
const hosterPriority = (host) => {
    for (const [pattern, priority] of Object.entries(HOSTER_PRIORITY)) {
        if (host.includes(pattern))
            return priority;
    }
    return 99;
};
/** Decode the real hoster URL from an ouo.io shortener wrapper.
 *  ouo.io links look like: http://ouo.io/st/<id>/?s=<url-encoded-real-url>
 *  The real URL is directly in the `s` query param, so we can extract it
 *  without following the shortener (which would require a browser/JS). */
const decodeOuoUrl = (href) => {
    try {
        const url = new URL(href);
        const s = url.searchParams.get('s');
        if (s)
            return s;
    }
    catch {
        // not a URL — maybe it's already the raw hoster link text
    }
    return undefined;
};
/** Decode common HTML entities (e.g. &#8217; -> ’) for titles coming from the
 *  WordPress REST API. */
const decodeEntities = (raw) => cheerio.load(raw).text();
class FreeMovies extends Source_1.Source {
    id = 'freemovies';
    label = 'FreeMovies';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.en];
    baseUrl = 'https://freemovies.link';
    domainKey = 'freemovies';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    /** Pre-warm the Cloudflare clearance cookies at startup so real stream requests
     *  don't have to wait for FlareSolverr to solve the challenge (which would
     *  exceed the 18s stream deadline). We warm the homepage, because it is the
     *  entry point Cloudflare protects, and a REST API search query, because the
     *  new source flow reads posts through the WordPress REST API. */
    async prewarm(ctx) {
        const urls = [
            new URL(this.baseUrl),
            new URL(`/wp-json/wp/v2/posts?search=${encodeURIComponent('House of the Dragon')}&per_page=5`, this.baseUrl),
        ];
        await Promise.all(urls.map(async (url) => {
            try {
                await this.fetcher.text(ctx, url);
                this.fetcher.getLogger().info(`FreeMovies: pre-warm complete for ${url.pathname}${url.search}`, ctx);
            }
            catch (error) {
                this.fetcher.getLogger().warn(`FreeMovies: pre-warm failed for ${url.pathname}${url.search}: ${error}`, ctx);
            }
        }));
    }
    async handleInternal(ctx, type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        // Search freemovies.link via the WordPress REST API.
        const posts = await this.searchPosts(ctx, name);
        if (posts.length === 0) {
            this.fetcher.getLogger().info(`FreeMovies: no WordPress posts found for "${name}"`, ctx);
            return [];
        }
        const results = [];
        for (const post of posts) {
            // For series, only keep the requested episode.
            if (type === 'series' && tmdbId.season !== undefined && tmdbId.episode !== undefined) {
                if (post.season !== tmdbId.season || post.episode !== tmdbId.episode) {
                    continue;
                }
            }
            // For movies, skip series-episode release posts and only keep posts whose
            // year is within ±1 of the TMDB movie year.
            if (type === 'movie') {
                if (post.season !== undefined || post.episode !== undefined) {
                    continue;
                }
                if (year && post.year && Math.abs(post.year - year) > 1) {
                    continue;
                }
            }
            // The post title must still contain the searched name (the WP search can
            // return loosely related posts). Titles are dotted release names, so turn
            // dots into spaces before normalising.
            if (!normalize(post.title.replace(/\./g, ' ')).includes(normalize(name.replace(/\./g, ' ')))) {
                continue;
            }
            const hosterUrls = post.hosterUrls?.length
                ? post.hosterUrls
                : await this.fetchHosterUrls(ctx, post.url);
            // Order results by preferred hoster so Mega > PixelDrain > UsersDrive.
            const orderedHosterUrls = [...hosterUrls].sort((a, b) => hosterPriority(a.host) - hosterPriority(b.host));
            for (const hosterUrl of orderedHosterUrls) {
                // Use the explicit "File size" label if available; otherwise try to parse
                // a size from the release title (e.g. "... 6.6 GB ...").
                const fileSize = post.fileSize ?? parseSizeBytes(post.title);
                const meta = {
                    title: this.buildTitle(post, name),
                    height: post.height,
                    bytes: fileSize,
                    countryCodes: this.countryCodes,
                    season: post.season,
                    episode: post.episode,
                };
                results.push({ url: hosterUrl, meta });
            }
        }
        this.fetcher.getLogger().info(`FreeMovies: returning ${results.length} result(s) for "${name}"`, ctx);
        return results;
    }
    /** Build a human-readable stream card title. */
    buildTitle(post, name) {
        const epLabel = post.season !== undefined && post.episode !== undefined
            ? `S${String(post.season).padStart(2, '0')}E${String(post.episode).padStart(2, '0')}`
            : '';
        const quality = post.height ? `${post.height}p` : '';
        return `[FreeMovies] ${name} ${epLabel} ${quality}`.replace(/\s+/g, ' ').trim();
    }
    /** Search freemovies.link for posts matching a title.
     *  The site's HTML search (?s=) is unusable (404 page) and the origin
     *  (free-movies.to) is behind an unsolvable Cloudflare challenge. The
     *  freemovies.link WordPress REST API is reachable once CF clearance cookies
     *  are warm, so we use it to discover posts and then fetch their pages for
     *  the actual download links. */
    async searchPosts(ctx, name) {
        const searchUrl = new URL(`/wp-json/wp/v2/posts?search=${encodeURIComponent(name)}&per_page=100`, this.baseUrl);
        let raw;
        try {
            raw = await this.fetcher.text(ctx, searchUrl);
        }
        catch {
            return [];
        }
        let posts = [];
        try {
            posts = JSON.parse(raw);
        }
        catch {
            // FlareSolverr sometimes returns the browser-rendered JSON view wrapped
            // in a <pre> tag. Try to extract the JSON body before giving up.
            const preMatch = raw.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
            if (preMatch) {
                try {
                    posts = JSON.parse((preMatch[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
                }
                catch {
                    return [];
                }
            }
            else {
                return [];
            }
        }
        if (!Array.isArray(posts)) {
            this.fetcher.getLogger().info(`FreeMovies: search response is not an array (type ${typeof posts})`, ctx);
            return [];
        }
        const nameClean = normalize(name);
        this.fetcher.getLogger().info(`FreeMovies: ${posts.length} raw post(s), nameClean="${nameClean}", first title="${posts[0]?.title?.rendered ?? 'n/a'}"`, ctx);
        const matched = posts.reduce((acc, post) => {
            const titleRaw = post.title?.rendered;
            const title = titleRaw ? decodeEntities(titleRaw) : '';
            const link = post.link;
            if (!title || !link) {
                this.fetcher.getLogger().info(`FreeMovies: skipping post with missing title/link`, ctx);
                return acc;
            }
            // Only accept posts whose title contains the searched name. The titles are
            // dotted release names (e.g. "House.of.the.Dragon.S03E02..."), so turn dots
            // into spaces before normalising.
            if (!normalize(title.replace(/\./g, ' ')).includes(nameClean)) {
                this.fetcher.getLogger().info(`FreeMovies: title "${title}" does not include "${nameClean}"`, ctx);
                return acc;
            }
            const epMatch = title.match(/S0*(\d+)E0*(\d+)/i);
            const season = epMatch && epMatch[1] ? parseInt(epMatch[1], 10) : undefined;
            const episode = epMatch && epMatch[2] ? parseInt(epMatch[2], 10) : undefined;
            // Parse quality from the dotted release title.
            const dottedTitle = title.replace(/\./g, ' ');
            const height = (0, utils_1.findHeight)(title);
            const quality = dottedTitle.replace(/\s+/g, ' ').trim();
            // Try to extract a file size and any direct hoster URLs from the rendered
            // post content. The REST API returns the links as plain text here, so we
            // can avoid a separate (Cloudflare-protected) post-page fetch.
            let fileSize;
            let hosterUrls;
            const contentHtml = post.content?.rendered;
            if (contentHtml) {
                const decodedContent = decodeEntities(contentHtml);
                const sizeMatch = decodedContent.match(SIZE_LABEL_RE);
                if (sizeMatch)
                    fileSize = parseSizeBytes(sizeMatch[0]);
                hosterUrls = this.extractHosterUrlsFromHtml(decodedContent);
            }
            const yearMatch = title.match(/\b(19[89]\d|20\d{2})\b/);
            const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined;
            try {
                acc.push({ url: new URL(link), title, season, episode, height, quality, fileSize, year, hosterUrls });
            }
            catch { /* invalid URL */ }
            return acc;
        }, []);
        this.fetcher.getLogger().info(`FreeMovies: returning ${matched.length} matched post(s)`, ctx);
        return matched;
    }
    /** Fetch a freemovies.link post page and extract supported hoster URLs.
     *  kep as a fallback for posts whose REST API `content.rendered` is empty. */
    async fetchHosterUrls(ctx, postUrl) {
        let html;
        try {
            html = await this.fetcher.text(ctx, postUrl);
        }
        catch {
            return [];
        }
        return this.extractHosterUrlsFromHtml(html);
    }
    /** Extract supported hoster URLs from an HTML fragment. Handles:
     *  - direct `<a href="https://gofile.io/...">` links;
     *  - ouo.io shortener wrappers (decode the `?s=` param);
     *  - plain-text URLs in the page/content text (e.g. REST API `content.rendered`). */
    extractHosterUrlsFromHtml(html) {
        const $ = cheerio.load(html);
        const urls = [];
        const seen = new Set();
        const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
        const tryAdd = (candidate) => {
            if (!candidate || !candidate.startsWith('http'))
                return;
            if (candidate.includes('freemovies.link') || candidate.includes('free-movies.to'))
                return;
            if (candidate.includes('ouo.io')) {
                const decoded = decodeOuoUrl(candidate);
                if (decoded) {
                    candidate = decoded;
                }
                else {
                    return;
                }
            }
            try {
                const url = new URL(candidate);
                if (!isSupportedHoster(url.host))
                    return;
                if (seen.has(url.href))
                    return;
                seen.add(url.href);
                urls.push(url);
            }
            catch { /* ignore invalid URL */ }
        };
        $('a[href]').each((_i, el) => {
            const $el = $(el);
            tryAdd($el.attr('href'));
            tryAdd($el.text().trim());
        });
        for (const match of ($.text() || '').match(URL_RE) ?? []) {
            tryAdd(match);
        }
        return urls;
    }
}
exports.FreeMovies = FreeMovies;
