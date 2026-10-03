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
exports.XYZ111477 = void 0;
const bytes_1 = __importDefault(require("bytes"));
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
/**
 * 111477.xyz source.
 *
 * Scrapes an nginx autoindex directory listing on a.111477.xyz, fuzzy-matches the TMDB name to a
 * movie/TV folder, and lists the .mkv/.mp4/.avi files inside (per-season folder for series).
 *
 * Delivery: every file URL is routed through this addon's /relay (RelayController). The raw file
 * URL cannot be handed to Stremio directly: a.111477.xyz 307-redirects (NO CORS headers) via
 * p.111477.xyz to a *.workers.dev CDN, and Stremio's streaming server cannot follow that
 * cross-host redirect chain (→ 0:00 / "can't open"). The relay follows the chain server-side,
 * forwards the player's Range (workers.dev honours 206) and the global CORS middleware makes the
 * relay URL same-origin for Stremio. The workers.dev per-worker burst 429 (which stalled playback
 * at 0:00) is handled by the relay's fast worker rotation with a short backoff — see
 * RelayController.
 */
class XYZ111477 extends Source_1.Source {
    id = '111477';
    label = '111477.xyz';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi];
    isAdult = false;
    baseUrl = 'https://a.111477.xyz';
    fetcher;
    static movieCache = null;
    static tvCache = null;
    static cacheTimestamp = 0;
    CACHE_TTL_MS = 3600 * 1000;
    static pageCache = new Map();
    PAGE_CACHE_TTL_MS = 3600 * 1000;
    // In-flight dedupe: concurrent fetches of the SAME page share one upstream request. Replaces the
    // old static serial fetchQueue, which blocked EVERY 111477 fetch (prewarm + all live requests)
    // behind a single hung fetch — see fetchCapped.
    static inflight = new Map();
    get logger() {
        return this.fetcher.getLogger();
    }
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    clean(str) {
        return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    buildSourceResult(ctx, fileMatch, size) {
        const finalUrl = new URL(fileMatch, this.baseUrl).href;
        const height = (0, utils_1.findHeight)(fileMatch);
        const fileClean = fileMatch.split('/').pop() || '';
        // Encode '[' / ']' (present in many release names) for broad player compatibility.
        const sanitizedUrl = finalUrl.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
        const directUrl = new URL(sanitizedUrl);
        // The raw a.111477.xyz file URL redirects (307, NO CORS) via p.111477.xyz to a *.workers.dev
        // CDN. Stremio's streaming server CANNOT follow that cross-host redirect chain (→ 0:00 / "can't
        // open"). Route through the addon's /relay: it follows the chain server-side, forwards the
        // player's Range (workers.dev honours 206), and the global CORS middleware makes the relay URL
        // same-origin for Stremio. The workers.dev per-worker burst 429 is handled by the relay's fast
        // worker rotation (short backoff, see RelayController).
        //
        // Wrapping in /relay is also REQUIRED so the ExternalUrl extractor matches (isProxyStream check
        // on /relay path). Without it, the raw p.111477.xyz URL matches no extractor and produces 0
        // stream results.
        const cleanUrl = directUrl.pathname;
        const rawUrl = `https://a.111477.xyz${cleanUrl}`;
        const proxyUrl = new URL(`https://p.111477.xyz/bulk?u=${encodeURIComponent(rawUrl)}`);
        // Include the file name in the relay path so RelayController.passThrough() detects the .mkv
        // extension and sets Content-Type: video/x-matroska (instead of application/octet-stream which
        // Stremio's streaming server may refuse to proxy through ffmpeg).
        const relayFileName = (fileClean || 'video.mkv').replace(/[^a-zA-Z0-9._-]/g, '_');
        const relayUrl = new URL(`/relay/${relayFileName}`, ctx.hostUrl);
        relayUrl.searchParams.set('url', proxyUrl.href);
        const sizeBytes = size ? bytes_1.default.parse(size) ?? undefined : undefined;
        const sizeBadge = size ? `⬇️ ${size}` : '';
        const resBadge = height ? (0, utils_1.getClosestResolution)(height) : 'Unknown';
        const formatRegex = /(remux|x265|hevc|hdr|10-bit|10bit|sdr|avc|h264|h265|dts-hd|dts|hd-ma|dd\+?5\.1|bluray|web-dl|webrip)/ig;
        const metadataMatches = fileClean.match(formatRegex);
        const tagStr = metadataMatches ? ` - ${Array.from(new Set(metadataMatches.map(t => t.toUpperCase()))).join(' | ')}` : '';
        return {
            url: relayUrl,
            notWebReady: true,
            meta: {
                title: `[111477.xyz] ${resBadge}${tagStr} ${sizeBadge}\n${fileClean}`,
                ...(height && { height }),
                ...(sizeBytes && { bytes: sizeBytes }),
                sourceLabel: '111477',
                countryCodes: this.countryCodes,
            },
        };
    }
    async throttledFetch(ctx, url) {
        const now = Date.now();
        const cached = XYZ111477.pageCache.get(url);
        if (cached && (now - cached.ts) < this.PAGE_CACHE_TTL_MS) {
            this.logger.info(`XYZ111477: Cache HIT for ${url}`, ctx);
            return cached.html;
        }
        // Dedupe concurrent identical fetches so parallel requests for the same page share one
        // upstream call (the page cache alone can't dedupe in-flight fetches).
        const existing = XYZ111477.inflight.get(url);
        if (existing) {
            return existing;
        }
        const promise = this.fetchCapped(ctx, url).finally(() => XYZ111477.inflight.delete(url));
        XYZ111477.inflight.set(url, promise);
        return promise;
    }
    /**
     * Fetch a page with a hard per-request cap. A stalled connection — or the Fetcher's 60s
     * Puppeteer Cloudflare-bypass fallback on a 403 — would otherwise hang this source past
     * Stremio's ~18s stream deadline. The cap rejects early so handleInternal's try/catch returns
     * [] for that page instead of stalling the whole /stream response.
     */
    async fetchCapped(ctx, url) {
        const CAP_MS = 7000;
        const fetchPromise = this.fetcher.text(ctx, new URL(url), { timeout: CAP_MS });
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`XYZ111477 fetch timed out: ${url}`)), CAP_MS);
        });
        try {
            this.logger.info(`XYZ111477: Fetch ${url}`, ctx);
            const html = await Promise.race([fetchPromise, timeoutPromise]);
            XYZ111477.pageCache.set(url, { html, ts: Date.now() });
            return html;
        }
        finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
    async ensureIndex(ctx, type) {
        if (type !== 'movie' && type !== 'series')
            return [];
        const now = Date.now();
        if (now - XYZ111477.cacheTimestamp > this.CACHE_TTL_MS) {
            XYZ111477.movieCache = null;
            XYZ111477.tvCache = null;
            XYZ111477.cacheTimestamp = now;
        }
        if (type === 'movie' && XYZ111477.movieCache)
            return XYZ111477.movieCache;
        if (type === 'series' && XYZ111477.tvCache)
            return XYZ111477.tvCache;
        const url = type === 'movie' ? `${this.baseUrl}/movies/` : `${this.baseUrl}/tvs/`;
        this.logger.info(`XYZ111477: Refreshing Memory Map from ${url}`, ctx);
        try {
            const html = await this.throttledFetch(ctx, url);
            const folders = [];
            const regex = /href="(\/(movies|tvs)\/[^"]+?)\/"/g;
            for (const m of html.matchAll(regex)) {
                const path = m[1];
                if (path)
                    folders.push(decodeURIComponent(path));
            }
            if (type === 'movie') {
                XYZ111477.movieCache = folders;
                return XYZ111477.movieCache;
            }
            else {
                XYZ111477.tvCache = folders;
                return XYZ111477.tvCache;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.warn(`XYZ111477: Failed to index ${url}: ${msg}`, ctx);
            return [];
        }
    }
    async prewarmIndex(ctx) {
        this.logger.info('XYZ111477: pre-warming /movies/ + /tvs/ indexes...', ctx);
        await Promise.all([
            this.ensureIndex(ctx, 'movie'),
            this.ensureIndex(ctx, 'series'),
        ]);
        this.logger.info('XYZ111477: index pre-warm complete', ctx);
    }
    async handleInternal(ctx, type, id) {
        if (type !== 'movie' && type !== 'series')
            return [];
        const folderMap = await this.ensureIndex(ctx, type);
        if (!folderMap.length)
            return [];
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        const tmdbTarget = this.clean(name);
        const tmdbYearStr = year ? year.toString() : '';
        const matchedFolder = folderMap.find((f) => {
            const folderNameRaw = f.split('/').pop() || '';
            const folderClean = this.clean(folderNameRaw);
            if (type === 'movie' && tmdbYearStr) {
                const targetWithYear = this.clean(`${name}${year}`);
                if (folderClean === targetWithYear || folderClean.includes(targetWithYear))
                    return true;
                if (folderClean === tmdbTarget && folderNameRaw.includes(tmdbYearStr))
                    return true;
            }
            else {
                if (folderClean === tmdbTarget || folderClean.includes(tmdbTarget))
                    return true;
            }
            return false;
        });
        if (!matchedFolder) {
            this.logger.info(`XYZ111477: No index folder matched TMDB "${name}"`, ctx);
            return [];
        }
        this.logger.info(`XYZ111477: Matched folder [${matchedFolder}]`, ctx);
        const results = [];
        if (type === 'series') {
            if (!id.season || !id.episode)
                return [];
            const targetSeason = id.season;
            const targetEpisode = id.episode;
            const seasonUrl = new URL(`${this.baseUrl}${matchedFolder}/Season ${targetSeason}/`).href;
            try {
                const sHtml = await this.throttledFetch(ctx, seasonUrl);
                const $ = cheerio.load(sHtml);
                const urlNodes = [];
                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    if (href && (href.match(/\.mkv$/i) || href.match(/\.mp4$/i) || href.match(/\.avi$/i))) {
                        const file = decodeURIComponent(href);
                        let size = $(el).closest('tr').find('td.size').text().trim();
                        if (!size)
                            size = $(el).parent().siblings().text().replace(/\s+/g, ' ').trim();
                        urlNodes.push({ file, size });
                    }
                });
                const p1 = new RegExp(`s0*${targetSeason}e0*${targetEpisode}\\b`, 'i');
                const p2 = new RegExp(`\\b${targetSeason}x0*${targetEpisode}\\b`, 'i');
                const epNodes = urlNodes.filter(n => p1.test(n.file) || p2.test(n.file));
                for (const node of epNodes) {
                    results.push(this.buildSourceResult(ctx, node.file, node.size));
                }
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.info(`XYZ111477: Failed scraping Season URL ${seasonUrl}: ${msg}`, ctx);
            }
        }
        else {
            const movieUrl = new URL(`${this.baseUrl}${matchedFolder}/`).href;
            try {
                const mHtml = await this.throttledFetch(ctx, movieUrl);
                const $ = cheerio.load(mHtml);
                const urlNodes = [];
                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    if (href && (href.match(/\.mkv$/i) || href.match(/\.mp4$/i) || href.match(/\.avi$/i))) {
                        const file = decodeURIComponent(href);
                        let size = $(el).closest('tr').find('td.size').text().trim();
                        if (!size)
                            size = $(el).parent().siblings().text().replace(/\s+/g, ' ').trim();
                        urlNodes.push({ file, size });
                    }
                });
                for (const node of urlNodes) {
                    results.push(this.buildSourceResult(ctx, node.file, node.size));
                }
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.info(`XYZ111477: Failed scraping Movie folder ${movieUrl}: ${msg}`, ctx);
            }
        }
        return results;
    }
}
exports.XYZ111477 = XYZ111477;
