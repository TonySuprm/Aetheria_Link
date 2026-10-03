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
exports.SinFlix = void 0;
exports.normalize = normalize;
const async_mutex_1 = require("async-mutex");
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const levenshtein = __importStar(require("fast-levenshtein"));
// Strip punctuation but keep spaces for robust matching
function normalize(str) {
    return str.toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}
const RENTRY_URL = 'https://rentry.co/sin-flix';
const RENTRY_TTL = 6 * 60 * 60 * 1000; // 6h cache
let cachedCatalog;
const catalogMutex = new async_mutex_1.Mutex();
/** Matches typical SinFlix entry: "Title [Quality] (ep info) - ID_OR_URL" */
const ENTRY_RE = /^(.*?)\s*(?:\((\d{4})\))?\s*\[(.*?)\]\s*(?:\([^)]+\))?\s*-\s*(.+)$/;
/** Episode tag inside a filename, e.g. "[E05]", ".E05.", or "E005" */
const EPISODE_TAG_RE = /(?:^|[\[\s.\_-])[eE]0*(\d+)/i;
class SinFlix extends Source_1.Source {
    id = 'sinflix';
    label = 'SinFlix';
    contentTypes = ['movie', 'series'];
    // SinFlix features mostly Asian dramas
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.ko, types_1.CountryCode.zh, types_1.CountryCode.ja, types_1.CountryCode.th, types_1.CountryCode.id];
    baseUrl = RENTRY_URL;
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async prewarm(ctx) {
        try {
            await this.fetcher.text(ctx, new URL(this.baseUrl));
            this.fetcher.getLogger().info('SinFlix: pre-warm complete', ctx);
        }
        catch (error) {
            this.fetcher.getLogger().warn(`SinFlix: pre-warm failed: ${error}`, ctx);
        }
    }
    async handleInternal(ctx, _type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        const entries = await this.getCatalog(ctx);
        if (entries.length === 0)
            return [];
        const nameSlug = normalize(name);
        const results = [];
        // Find all entries that match the title
        for (const entry of entries) {
            if (!this.isTitleMatch(normalize(entry.title), nameSlug)) {
                continue;
            }
            if (entry.year && year && entry.year !== year && Math.abs(entry.year - year) > 1) {
                continue; // Loose year match
            }
            const quality = entry.quality;
            // Detect buzzheavier: either a bare 12-char ID or a full buzzheavier/fuckingfast URL
            const isBuzzheavier = entry.isShortId
                || entry.linkSegment.includes('buzzheavier.com')
                || entry.linkSegment.includes('fuckingfast.');
            if (isBuzzheavier) {
                // Build the URL: either from the shortId or use the full URL directly
                const buzzheavierUrl = entry.isShortId
                    ? `https://buzzheavier.com/${entry.linkSegment}`
                    : entry.linkSegment.trim();
                try {
                    results.push({
                        url: new URL(buzzheavierUrl),
                        meta: {
                            title: `${entry.title} [${quality}]`,
                            bytes: 0,
                            height: (0, utils_1.findHeight)(quality),
                            countryCodes: this.countryCodes,
                            season: tmdbId.season,
                            episode: tmdbId.episode,
                        }
                    });
                }
                catch (err) {
                    this.fetcher.getLogger().info(`URL Parse Error for Buzzheavier: ${buzzheavierUrl}`, ctx);
                }
            }
            else if (entry.linkSegment.includes('pst.moe') || entry.linkSegment.includes('rentry.co')) {
                const rawParts = entry.linkSegment.split('|');
                for (const urlStr of rawParts) {
                    const cleanUrl = urlStr.trim();
                    if (!cleanUrl)
                        continue;
                    try {
                        const pasteText = await this.fetcher.text(ctx, new URL(cleanUrl));
                        const pasteLines = pasteText.split('\n');
                        for (const pline of pasteLines) {
                            if (!pline.includes(' - http'))
                                continue;
                            const pMatch = pline.match(/^(.*?)\s*(?:\[[^\]]+\])?\s*-\s*(https?:\/\/.+?)(?:\s|$)/);
                            if (pMatch) {
                                const fname = pMatch[1].trim();
                                const link = pMatch[2].trim();
                                this.processFileResult(results, fname, link, quality, tmdbId);
                            }
                        }
                    }
                    catch (error) {
                        this.fetcher.getLogger().warn(`SinFlix: Failed to scrape paste ${cleanUrl}: ${error}`, ctx);
                    }
                }
            }
            else if (entry.linkSegment.includes('pixeldrain.com')) {
                this.processFileResult(results, entry.title, entry.linkSegment.split('|')[0].trim(), quality, tmdbId, true);
            }
            else if (entry.linkSegment.startsWith('http')) {
                // Catch-all: any other full URL (mega.nz, krakenfiles, etc.)
                try {
                    results.push({
                        url: new URL(entry.linkSegment.trim()),
                        meta: {
                            title: `${entry.title} [${quality}]`,
                            bytes: 0,
                            height: (0, utils_1.findHeight)(quality),
                            countryCodes: this.countryCodes,
                            season: tmdbId.season,
                            episode: tmdbId.episode,
                        }
                    });
                }
                catch { }
            }
        }
        this.fetcher.getLogger().info(`SinFlix: returning ${results.length} result(s) for "${name}"`, ctx);
        return results;
    }
    processFileResult(results, fname, url, quality, tmdbId, isDirect = false) {
        let fileMatches = false;
        if (tmdbId.season !== undefined) {
            const tag = fname.match(EPISODE_TAG_RE);
            if (tag && tag[1] && parseInt(tag[1], 10) === tmdbId.episode) {
                fileMatches = true;
            }
            else if (isDirect && !tag) {
                // If rentry lists a direct Pixeldrain link but doesn't specify filename, we blindly include it
                // This can cause problems for entire series folders, but for now we fallback.
                fileMatches = true;
            }
        }
        else {
            fileMatches = true; // Movie -> include everything
        }
        if (fileMatches) {
            results.push({
                url: new URL(url),
                meta: {
                    title: `${fname} [${quality}]`,
                    bytes: 0,
                    height: (0, utils_1.findHeight)(fname) ?? (0, utils_1.findHeight)(quality),
                    countryCodes: this.countryCodes,
                    season: tmdbId.season,
                    episode: tmdbId.episode,
                }
            });
        }
    }
    isTitleMatch(a, b) {
        if (a === b)
            return true;
        // Strict word-boundary prefix: e.g. Entry is "The Boy Season 1", query is "The Boy"
        if (a.startsWith(b + ' ')) {
            const remainder = a.slice(b.length + 1).trim();
            if (/^(season|s\d|part|vol|complete|uncut|theatrical|extended|director|ep|episode|\d|movie)/.test(remainder)) {
                return true;
            }
        }
        // Distance check for minor typos or single character differences (e.g. spelling errors on Rentry)
        if (a.length > 5 && b.length > 5) {
            const distance = levenshtein.get(a, b);
            if (distance <= 2)
                return true;
        }
        return false;
    }
    async getCatalog(ctx) {
        if (cachedCatalog && Date.now() - cachedCatalog.ts < RENTRY_TTL) {
            return cachedCatalog.entries;
        }
        return catalogMutex.runExclusive(async () => {
            /* istanbul ignore next */
            if (cachedCatalog && Date.now() - cachedCatalog.ts < RENTRY_TTL) {
                return cachedCatalog.entries;
            }
            let text = '';
            try {
                text = await this.fetcher.text(ctx, new URL(RENTRY_URL), { timeout: 30000 });
            }
            catch (error) {
                this.fetcher.getLogger().warn(`SinFlix: failed to fetch catalog: ${error}`, ctx);
                return cachedCatalog?.entries ?? [];
            }
            const entries = [];
            const $ = cheerio.load(text);
            const articleHtml = $('article').html() || '';
            const lines = articleHtml.split(/<br\s*\/?>|\n|<\/?p>/i).map(l => cheerio.load(l).text().trim()).filter(Boolean);
            for (const line of lines) {
                if (!line.includes(' - '))
                    continue;
                const match = line.trim().match(ENTRY_RE);
                if (match) {
                    let [, titleStr, yearStr, quality, linkPart] = match;
                    if (titleStr && linkPart) {
                        // Remove (reup) prefixes
                        titleStr = titleStr.replace(/^\(reup\)\s*/i, '');
                        const isShortId = /^[a-z0-9]{12}$/.test(linkPart.trim());
                        entries.push({
                            title: titleStr.trim(),
                            ...(yearStr ? { year: parseInt(yearStr, 10) } : {}),
                            quality: quality?.trim() ?? '',
                            linkSegment: linkPart.trim(),
                            isShortId
                        });
                    }
                }
            }
            this.fetcher.getLogger().info(`SinFlix: parsed ${entries.length} items from catalog`, ctx);
            cachedCatalog = { entries, ts: Date.now() };
            return entries;
        });
    }
}
exports.SinFlix = SinFlix;
