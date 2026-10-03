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
exports.PaheInk = void 0;
const bytes_1 = __importDefault(require("bytes"));
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const resolution_1 = require("../utils/resolution");
const Source_1 = require("./Source");
// Pahe.ink — WordPress movie/series aggregator using a Sahifa-theme download-box layout.
// Each post has vertical tabs per episode (series) and one or more .box.download blocks per tab.
// Quality lines like "1080p x265 6CH | 973 MB" are followed by shortc-button shortlinks (MG/SD/GD/PD etc.)
// on tpi.li / oii.la. Those shortlinks contain a hidden form token whose base64 tail encodes the
// destination hoster URL (mega.nz, send.now, gdflix.dev, etc.). We decode it and return the
// resolved hoster URL so the extractor registry can route it through the existing Mega/SendCm/Gdflix
// extractors.
const DEFAULT_BASE_URL = 'https://pahe.ink';
const SIZE_RE = /\b([\d.]+)\s*(GB|MB)\b/i;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/g;
const SPINOFF_KEYWORDS = ['challenge', 'conversation', 'story', 'inconversation'];
const SHORTLINK_HOSTS = new Set([
    'tpi.li',
    'oii.la',
    'www.tpi.li',
    'www.oii.la',
]);
// Known shortener frontends that cannot be resolved server-side and lead to
// non-playable URLs. Skipped to avoid wasted extractor calls.
const UNSUPPORTED_SHORTLINK_HOSTS = new Set([
    'teknoasian.com',
    'www.teknoasian.com',
]);
const JUNK_HOSTS = new Set([
    'pahe.ink',
    'cloudflare.com',
    'gravatar.com',
    'wp.com',
    'wordpress.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'youtube.com',
    'youtu.be',
    'google.com',
]);
const clean = (str) => str
    .toLowerCase()
    .replace(/\s*&\s*/g, 'and')
    .replace(/[^a-z0-9]/g, '');
const compareMedia = (resultTitle, wantedTitle, year, type) => {
    const normalizedResult = clean(resultTitle);
    const normalizedWanted = clean(wantedTitle);
    if (!normalizedResult.includes(normalizedWanted)) {
        return false;
    }
    const wantedLower = wantedTitle.toLowerCase();
    if (SPINOFF_KEYWORDS.some(kw => normalizedResult.includes(clean(kw)) && !wantedLower.includes(kw))) {
        return false;
    }
    const hasSeasonMarker = /\bseason\s*\d+|\bs\d+e\d+|\bepisode\s*\d+/i.test(resultTitle);
    if (type === 'movie' && hasSeasonMarker) {
        return false;
    }
    if (year) {
        const years = (resultTitle.match(YEAR_RE) ?? []).map(y => parseInt(y, 10));
        const hasMatchingYear = years.length === 0 || years.some(y => Math.abs(y - year) <= 1);
        if (!hasMatchingYear)
            return false;
    }
    return true;
};
const parseHeight = (text) => {
    if (/2160p/i.test(text))
        return 2160;
    if (/1080p/i.test(text))
        return 1080;
    if (/720p/i.test(text))
        return 720;
    if (/480p/i.test(text))
        return 480;
    return undefined;
};
const parseCodec = (text) => {
    if (/\bx265\b/i.test(text))
        return 'x265';
    if (/\bx264\b/i.test(text))
        return 'x264';
    return undefined;
};
const parseSize = (text) => {
    const m = text.match(SIZE_RE);
    if (!m)
        return undefined;
    return bytes_1.default.parse(`${m[1]} ${m[2]}`);
};
const decodeTokenUrl = (token) => {
    // tpi.li / oii.la embed the destination URL as base64 starting with the HTTPS marker.
    const httpsIdx = token.indexOf('aHR0cHM');
    if (httpsIdx < 0)
        return undefined;
    try {
        const decoded = Buffer.from(token.substring(httpsIdx), 'base64').toString('utf8');
        return decoded.startsWith('http') ? decoded : undefined;
    }
    catch {
        return undefined;
    }
};
class PaheInk extends Source_1.Source {
    id = 'paheink';
    label = 'Pahe.ink';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi];
    isAdult = false;
    baseUrl = DEFAULT_BASE_URL;
    priority = 0;
    domainKey = 'paheink';
    fetcher;
    get logger() {
        return this.fetcher.getLogger();
    }
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, type, id) {
        if (type !== 'movie' && type !== 'series')
            return [];
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        const season = id.season ?? 0;
        const episode = id.episode ?? 0;
        // 1. Search
        const postUrl = await this.findPost(ctx, name, year, type);
        if (!postUrl) {
            this.logger.info(`PaheInk: No post found for "${name}"`, ctx);
            return [];
        }
        // 2. Fetch post (append a query to avoid some Cloudflare path blocks on bare permalinks).
        const fetchUrl = new URL(postUrl);
        fetchUrl.searchParams.set('v', '1');
        this.logger.info(`PaheInk: Fetching ${fetchUrl.href}`, ctx);
        let postHtml;
        try {
            postHtml = await this.fetcher.text(ctx, fetchUrl);
        }
        catch (e) {
            this.logger.warn(`PaheInk: Post fetch failed: ${e}`, ctx);
            return [];
        }
        // 3. Collect episode panes.
        const panes = this.selectEpisodePanes(postHtml, type, season, episode);
        if (panes.length === 0) {
            this.logger.info(`PaheInk: No matching episode pane for ${name} S${season}E${episode}`, ctx);
            return [];
        }
        // 4. Parse quality links and filter to 1080p/2160p x264/x265.
        const entries = [];
        for (const pane of panes) {
            for (const entry of this.parsePane(pane)) {
                if (this.isRequestedQuality(entry)) {
                    entries.push(entry);
                }
            }
        }
        if (entries.length === 0) {
            this.logger.info(`PaheInk: No 1080p/4K x264/x265 links for ${name} S${season}E${episode}`, ctx);
            return [];
        }
        // 5. Resolve tpi.li / oii.la shortlinks to hoster URLs in parallel.
        const linkTasks = entries.flatMap(entry => entry.links.map(async (link) => {
            const host = link.url.hostname.replace(/^www\./, '');
            if (UNSUPPORTED_SHORTLINK_HOSTS.has(link.url.hostname) || UNSUPPORTED_SHORTLINK_HOSTS.has(host)) {
                this.logger.info(`PaheInk: Skipping unsupported shortlink ${link.url.hostname}`, ctx);
                return undefined;
            }
            if (!SHORTLINK_HOSTS.has(link.url.hostname) && !SHORTLINK_HOSTS.has(host)) {
                return this.buildResult(link.url, entry, link.label, name, season, episode);
            }
            const resolved = await this.resolveShortlink(ctx, link.url);
            return resolved ? this.buildResult(resolved, entry, link.label, name, season, episode) : undefined;
        }));
        const results = (await Promise.all(linkTasks)).filter((r) => r !== undefined);
        if (results.length === 0) {
            this.logger.info(`PaheInk: Could not resolve any shortlinks for ${name} S${season}E${episode} (hoster may be bot-protected)`, ctx);
        }
        return this.deduplicate(results);
    }
    async findPost(ctx, name, year, type) {
        const query = encodeURIComponent(name);
        const searchUrls = [
            new URL(`/?s=${query}`, DEFAULT_BASE_URL),
            new URL(`/page/1/?s=${query}`, DEFAULT_BASE_URL),
        ];
        let lastError;
        for (const searchUrl of searchUrls) {
            let html;
            try {
                html = await this.fetcher.text(ctx, searchUrl);
            }
            catch (e) {
                lastError = e;
                this.logger.info(`PaheInk: Search ${searchUrl.href} failed: ${e}`, ctx);
                continue;
            }
            const candidate = this.pickSearchCandidate(html, name, year, type);
            if (candidate)
                return candidate;
        }
        if (lastError) {
            this.logger.warn(`PaheInk: All searches failed for "${name}": ${lastError}`, ctx);
        }
        return undefined;
    }
    pickSearchCandidate(html, name, year, type) {
        const $ = cheerio.load(html);
        const candidates = [];
        $('h2, h3').each((_, el) => {
            const $el = $(el);
            const $a = $el.find('a').first();
            const href = $a.attr('href');
            const title = ($a.attr('title') ?? $a.text()).trim();
            const skipPath = /\/(category|tag|author|page)\//i;
            if (href && title && href.startsWith('https://pahe.ink/') && !skipPath.test(href)) {
                candidates.push({ href, title });
            }
        });
        for (const c of candidates) {
            if (compareMedia(c.title, name, year, type))
                return c.href;
        }
        // Fallback: title containment without strict year matching.
        const wantedClean = clean(name);
        for (const c of candidates) {
            if (clean(c.title).includes(wantedClean))
                return c.href;
        }
        return undefined;
    }
    selectEpisodePanes(html, type, _season, episode) {
        const $ = cheerio.load(html);
        const tabsVer = $('.post-tabs-ver').first();
        if (tabsVer.length === 0 || type === 'movie') {
            // Movies or non-tabbed posts: use whole body and look for download boxes.
            return [$('body').html() ?? html];
        }
        const labels = tabsVer.find('ul.tabs-nav > li')
            .map((_, el) => $(el).text().trim())
            .get();
        const panes = tabsVer.find('> .pane')
            .map((_, el) => $.html(el))
            .get();
        if (labels.length === 0 || panes.length === 0) {
            return [$('body').html() ?? html];
        }
        // Match requested episode against tab labels. Accept exact "Episode N", ranges "Episode N-M",
        // and "Season Packs" / "Batch" only when the requested episode is not in any specific tab.
        const matchingPanes = [];
        const exactRegex = new RegExp(`^\\s*Episode\\s*0*${episode}\\s*$`, 'i');
        const rangeRegex = new RegExp(`^\\s*Episode\\s*(\\d+)(?:\\s*[-~]\\s*Episode\\s*|\\s*[-~]\\s*)(\\d+)\\s*$`, 'i');
        labels.forEach((label, idx) => {
            const paneHtml = panes[idx];
            if (!paneHtml)
                return;
            if (exactRegex.test(label)) {
                matchingPanes.push(paneHtml);
                return;
            }
            const rangeMatch = label.match(rangeRegex);
            if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (episode >= start && episode <= end) {
                    matchingPanes.push(paneHtml);
                }
            }
        });
        if (matchingPanes.length > 0)
            return matchingPanes;
        // No specific match; accept a "Season Packs" / "Batch" tab as a last resort.
        labels.forEach((label, idx) => {
            const paneHtml = panes[idx];
            if (paneHtml && /season\s*pack|batch|complete/i.test(label)) {
                matchingPanes.push(paneHtml);
            }
        });
        if (matchingPanes.length > 0)
            return matchingPanes;
        // If only one pane exists, treat it as dedicated to the requested episode.
        return panes.length === 1 && panes[0] ? [panes[0]] : [];
    }
    parsePane(paneHtml) {
        const $ = cheerio.load(paneHtml);
        const entries = [];
        let current;
        const finishQuality = () => {
            if (current && current.links.length > 0) {
                entries.push(current);
            }
            current = undefined;
        };
        $('.box.download').each((_, box) => {
            let textAccum = '';
            $(box).find('.box-inner-block').contents().each((__, node) => {
                // Links: process as link if we have a current quality entry
                if (node.type === 'tag' && node.name === 'a' && current) {
                    const $a = $(node);
                    const href = $a.attr('href');
                    const label = $a.text().trim();
                    if (href) {
                        try {
                            const url = new URL(href);
                            const host = url.hostname.replace(/^www\./, '');
                            if (JUNK_HOSTS.has(host))
                                return;
                            current.links.push({ url, label, resolved: !SHORTLINK_HOSTS.has(host) });
                        }
                        catch {
                            // ignore bad URLs
                        }
                    }
                    textAccum = '';
                    return;
                }
                // Accumulate text from non-link nodes. Quality lines on movie pages are split
                // across <b>/<strong> tags and text nodes (e.g. "<b>720p x264</b> | 1.4 GB"), so the
                // regex can only match on the combined text.
                if (node.type === 'text' || node.type === 'tag') {
                    textAccum += $(node).text();
                    const qualityMatch = textAccum.match(/\b(480|720|1080|2160)p\s*(x264|x265)?[^|]*\|\s*[\d.]+\s*(?:GB|MB)/i);
                    if (qualityMatch) {
                        finishQuality();
                        const height = parseHeight(qualityMatch[0]);
                        const codec = parseCodec(qualityMatch[0]);
                        if (height) {
                            current = {
                                text: qualityMatch[0],
                                height,
                                codec,
                                bytes: parseSize(qualityMatch[0]),
                                links: [],
                            };
                        }
                        textAccum = '';
                    }
                }
            });
            finishQuality();
        });
        return entries;
    }
    isRequestedQuality(entry) {
        return entry.height >= 1080;
    }
    async resolveShortlink(ctx, url) {
        const host = url.hostname.replace(/^www\./, '');
        if (!SHORTLINK_HOSTS.has(host))
            return url;
        this.logger.info(`PaheInk: Resolving shortlink ${url.href}`, ctx);
        let html;
        try {
            html = await this.fetcher.text(ctx, url, { timeout: 15000 });
        }
        catch (e) {
            this.logger.warn(`PaheInk: Shortlink fetch failed ${url.href}: ${e}`, ctx);
            return undefined;
        }
        const $ = cheerio.load(html);
        const token = $('input[name="token"]').attr('value');
        if (!token) {
            this.logger.info(`PaheInk: No token input on ${url.href}`, ctx);
            return undefined;
        }
        const resolved = decodeTokenUrl(token);
        if (!resolved) {
            this.logger.info(`PaheInk: Could not decode token for ${url.href}`, ctx);
            return undefined;
        }
        try {
            return new URL(resolved);
        }
        catch {
            return undefined;
        }
    }
    buildResult(url, entry, hosterLabel, name, season, episode) {
        const resolution = (0, resolution_1.getClosestResolution)(entry.height);
        const resLabel = entry.codec === 'x265' ? `${resolution} x265` : `${resolution} x264`;
        const host = url.hostname.replace(/^www\./, '');
        const parts = [`[Pahe] ${name}`];
        if (season > 0 && episode > 0) {
            parts[0] += ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
        }
        parts[0] += ` - ${resLabel}`;
        parts.push(host);
        if (hosterLabel)
            parts.push(hosterLabel);
        const meta = {
            title: parts.join('\n'),
            sourceLabel: this.label,
            countryCodes: this.countryCodes,
            height: entry.height,
            ...(entry.bytes && { bytes: entry.bytes }),
        };
        return { url, meta };
    }
    deduplicate(results) {
        const seen = new Set();
        return results.filter((r) => {
            const key = r.url.href;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
}
exports.PaheInk = PaheInk;
