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
exports.MisterDonghua = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const clean = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
class MisterDonghua extends Source_1.Source {
    id = 'misterdonghua';
    label = 'MisterDonghua';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.ja];
    baseUrl = 'https://misterdonghua.com';
    category = 'donghua';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year, originalName] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        let title = name;
        if (tmdbId.season) {
            title += ` ${tmdbId.formatSeasonAndEpisode()}`;
        }
        else {
            title += ` (${year})`;
        }
        // Try the TMDB English name first; fall back to original title if not found
        let seriesPageUrl = await this.fetchSeriesPageUrl(ctx, name, type, tmdbId);
        if (!seriesPageUrl && originalName && originalName !== name) {
            seriesPageUrl = await this.fetchSeriesPageUrl(ctx, originalName, type, tmdbId);
        }
        if (!seriesPageUrl) {
            return [];
        }
        let episodePageUrl = seriesPageUrl;
        if (type === 'series') {
            const epUrl = await this.fetchEpisodePageUrl(ctx, seriesPageUrl, tmdbId);
            if (!epUrl) {
                return [];
            }
            episodePageUrl = epUrl;
        }
        const embedOpts = await this.extractEmbedUrls(ctx, episodePageUrl);
        if (embedOpts.length === 0) {
            return [];
        }
        return embedOpts.map(embed => {
            let displayTitle = title;
            if (embed.quality) {
                displayTitle = `${title} [${embed.quality}]`;
            }
            return {
                url: embed.url,
                meta: { title: displayTitle, countryCodes: [types_1.CountryCode.ja, types_1.CountryCode.multi] }
            };
        });
    }
    ;
    fetchSeriesPageUrl = async (ctx, name, type, tmdbId) => {
        const params = new URLSearchParams({ s: name });
        const searchUrl = new URL(`/?${params.toString()}`, this.baseUrl);
        let html;
        try {
            html = await this.fetcher.text(ctx, searchUrl);
        }
        catch {
            return undefined;
        }
        const $ = cheerio.load(html);
        const nameClean = clean(name);
        const wantMovie = type === 'movie';
        const candidates = [];
        // MisterDonghua uses the same WordPress Anime Themes Madara / Animes theme
        // Results are in .listupd cards with .bsx articles.
        $('.listupd .bsx, .listupd article, article.bs').each((_, el) => {
            const $el = $(el);
            const headingText = ($el.find('h2, h3').first().text() || '').trim();
            const anchor = $el.find('a').first();
            const href = anchor.attr('href') ?? '';
            if (!href.startsWith('http'))
                return;
            const title = headingText || (anchor.attr('title') || anchor.text()).trim();
            if (!title)
                return;
            const typez = $el.find('.typez, .type').first().text().trim().toLowerCase();
            const isEpisode = typez.includes('ep') || typez === 'episode' || title.toLowerCase().includes('episode ');
            if (isEpisode)
                return;
            candidates.push({ href, title, isMovie: typez === 'movie', exact: clean(title) === nameClean });
        });
        if (candidates.length === 0) {
            // Fallback: grab any series links from the page
            $('a[href*="/anime/"]').each((_, el) => {
                const href = $(el).attr('href') ?? '';
                const title = ($(el).attr('title') || $(el).text()).trim();
                if (href.startsWith('http') && title && !href.includes('/episode/')) {
                    candidates.push({ href, title, isMovie: false, exact: clean(title) === nameClean });
                }
            });
        }
        // Derive effective season
        const nameSeasonMatch = name.match(/season\s*(\d+)/i);
        const effectiveSeason = (tmdbId.season && tmdbId.season > 1)
            ? tmdbId.season
            : (nameSeasonMatch ? parseInt(nameSeasonMatch[1] ?? '0', 10) : (tmdbId.season !== undefined ? tmdbId.season : 1));
        const scored = candidates
            .filter((c) => {
            const t = clean(c.title);
            const nameBase = nameClean.replace(/season\d+/, '').replace(/s\d+$/, '');
            return t.includes(nameBase) || nameBase.includes(t);
        })
            .sort((a, b) => {
            let aHasS = false;
            let bHasS = false;
            if (effectiveSeason > 1) {
                const aTitle = clean(a.title);
                const bTitle = clean(b.title);
                const sStrs = [`season${effectiveSeason}`, `season${effectiveSeason}th`, `season${effectiveSeason}nd`, `season${effectiveSeason}rd`, `s${effectiveSeason}`];
                aHasS = sStrs.some(s => aTitle.includes(s));
                bHasS = sStrs.some(s => bTitle.includes(s));
            }
            if (aHasS && !bHasS)
                return -1;
            if (!aHasS && bHasS)
                return 1;
            if (a.exact !== b.exact)
                return a.exact ? -1 : 1;
            const aTypeOk = a.isMovie === wantMovie ? 0 : 1;
            const bTypeOk = b.isMovie === wantMovie ? 0 : 1;
            if (aTypeOk !== bTypeOk)
                return aTypeOk - bTypeOk;
            return a.title.length - b.title.length;
        });
        const best = scored[0];
        return best ? new URL(best.href) : undefined;
    };
    fetchEpisodePageUrl = async (ctx, seriesPageUrl, tmdbId) => {
        const html = await this.fetcher.text(ctx, seriesPageUrl);
        const $ = cheerio.load(html);
        if (tmdbId.episode) {
            // MisterDonghua episode links are in .eplister or li.ep-item
            const allLinks = $('.eplister a, li.ep-item a, .episodesList a, #episode_by_series a').toArray();
            for (const el of allLinks) {
                const href = $(el).attr('href');
                if (href) {
                    // URL pattern: /anime/series-slug/episode/series-slug-episode-152/
                    const hrefMatch = href.match(/episode[^/]*[-_](\d+)\/?$/i) || href.match(/episode.*?(\d+)/i) || href.match(/[-_]ep[-_]?(\d+)/i);
                    if (hrefMatch && hrefMatch[1] && parseInt(hrefMatch[1], 10) === tmdbId.episode) {
                        try {
                            return new URL(href, seriesPageUrl.href);
                        }
                        catch { /* invalid href */ }
                    }
                    // Fallback: check link text
                    const linkText = $(el).text().trim();
                    const textMatch = linkText.match(/^0*(\d+)/) || linkText.match(/episode[^\d]*(\d+)/i);
                    if (textMatch && textMatch[1] && parseInt(textMatch[1], 10) === tmdbId.episode) {
                        try {
                            return new URL(href, seriesPageUrl.href);
                        }
                        catch { /* invalid href */ }
                    }
                }
            }
            // Construct the episode URL directly if we know the series slug
            // MisterDonghua pattern: /anime/{slug}/episode/{slug}-episode-{n}/
            const seriesSlug = seriesPageUrl.pathname.replace(/^\/anime\//, '').replace(/\/$/, '');
            if (seriesSlug) {
                const constructedUrl = new URL(`/anime/${seriesSlug}/episode/${seriesSlug}-episode-${tmdbId.episode}/`, this.baseUrl);
                try {
                    const testHtml = await this.fetcher.text(ctx, constructedUrl);
                    // Verify it's a valid episode page and not a redirect to the homepage
                    if (testHtml && !testHtml.includes('<title>Mister Donghua') || testHtml.includes('episode')) {
                        return constructedUrl;
                    }
                }
                catch { /* not a valid episode URL */ }
            }
        }
        // Fallback: first episode link on the page
        const links = $('.eplister a, li.ep-item a, .episodesList a, #episode_by_series a');
        if (links.length > 0) {
            const href = links.first().attr('href');
            if (href) {
                try {
                    return new URL(href, seriesPageUrl.href);
                }
                catch { }
            }
        }
        const link = $('a[href*="episode"]').first().attr('href');
        try {
            return link ? new URL(link, seriesPageUrl.href) : undefined;
        }
        catch {
            return undefined;
        }
    };
    extractEmbedUrls = async (ctx, episodePageUrl) => {
        const html = await this.fetcher.text(ctx, episodePageUrl);
        const $ = cheerio.load(html);
        const results = [];
        const seenUrls = new Set();
        const addResult = (src, quality = undefined) => {
            if (src.startsWith('//'))
                src = 'https:' + src;
            try {
                const url = new URL(src);
                if (seenUrls.has(url.href))
                    return;
                seenUrls.add(url.href);
                results.push(quality ? { url, quality, host: url.host } : { url, host: url.host });
            }
            catch { /* invalid URL */ }
        };
        // ── Method 1: VideoObject schema embedUrl ──
        $('[itemtype*="VideoObject"], [itemtype*="videoobject"]').each((_, el) => {
            const embedUrl = $(el).find('[itemprop="embedUrl"]').attr('content') || '';
            if (embedUrl)
                addResult(embedUrl);
        });
        // ── Method 2: Base64-encoded select options (DonghuaStream-style) ──
        $('select option[value]').each((_, el) => {
            const value = $(el).attr('value');
            const label = $(el).text().trim().toLowerCase();
            if (!value || value.startsWith('http'))
                return;
            try {
                const decoded = Buffer.from(value, 'base64').toString('utf-8');
                const iframeMatch = decoded.match(/src=["']([^"']+)["']/);
                if (iframeMatch?.[1]) {
                    let quality;
                    if (label.includes('4k'))
                        quality = '4K';
                    else if (label.includes('1080'))
                        quality = '1080p';
                    else if (label.includes('720'))
                        quality = '720p';
                    addResult(iframeMatch[1], quality);
                }
            }
            catch { /* ignore invalid base64 */ }
        });
        // ── Method 3: Direct plain-URL options (LuciferDonghua-style) ──
        // MisterDonghua also uses a server picker with direct URLs in option values
        $('select option[value]').each((_, el) => {
            const value = $(el).attr('value') || '';
            if (value.startsWith('http')) {
                addResult(value);
            }
        });
        // ── Method 4: Mirror page URLs ──
        // Mirror pages render the full episode page HTML with ad iframes mixed in.
        // Use a WHITELIST of known streaming CDN hosts to avoid returning ad iframes.
        const STREAM_HOSTS = ['dailymotion.com', 'rumble.com', 'ok.ru', 'yurn.online', 'vimeo.com', 'streamtape.com'];
        const isStreamHost = (src) => {
            try {
                return STREAM_HOSTS.some(h => new URL(src).hostname.includes(h));
            }
            catch {
                return false;
            }
        };
        const mirrorUrls = [];
        $('select.mirror option[value], select[name="mirror"] option[value]').each((_, el) => {
            const value = $(el).attr('value') || '';
            if (value.startsWith('http') && (value.includes('/v/') || value.includes('/mirror/'))) {
                mirrorUrls.push(value);
            }
        });
        for (const mirrorUrl of mirrorUrls.slice(0, 5)) {
            try {
                const mirrorHtml = await this.fetcher.text(ctx, new URL(mirrorUrl));
                const $m = cheerio.load(mirrorHtml);
                $m('[itemtype*="VideoObject"] [itemprop="embedUrl"]').each((_, el) => {
                    const embedUrl = $m(el).attr('content') || '';
                    if (embedUrl)
                        addResult(embedUrl);
                });
                $m('iframe[src]').each((_, el) => {
                    const src = $m(el).attr('src') || '';
                    if (src && isStreamHost(src))
                        addResult(src);
                });
            }
            catch { /* mirror page fetch failed */ }
        }
        // ── Method 5: Direct iframes on episode page (whitelist-only, last resort) ──
        if (results.length === 0) {
            $('iframe[src]').each((_, el) => {
                const src = $(el).attr('src') || '';
                if (src && isStreamHost(src))
                    addResult(src);
            });
        }
        // Filter out blacklisted hosts
        const blacklistedHosts = [
            'doods.pro', 'doodstream', 'playmogo.com', 't.co', 'blogspot.com',
            'luciferdonghua.in', 'donghuastream.org', 'misterdonghua.com'
        ];
        const filtered = results.filter(r => !blacklistedHosts.some(host => r.host.includes(host)));
        // De-dupe and sort: prioritize 4K > 1080p > 720p, then Dailymotion/OK.ru/Rumble
        const unique = new Map();
        for (const r of filtered) {
            if (!unique.has(r.url.href) || (!unique.get(r.url.href)?.quality && r.quality)) {
                unique.set(r.url.href, r.quality ? { url: r.url, quality: r.quality } : { url: r.url });
            }
        }
        const qualityScores = { '4K': 3, '1080p': 2, '720p': 1 };
        // Sort: quality desc, then prefer Dailymotion/Rumble/OK.ru (supported by yt-dlp)
        const preferredHosts = ['dailymotion.com', 'rumble.com', 'ok.ru'];
        return Array.from(unique.values()).sort((a, b) => {
            const scoreA = a.quality ? qualityScores[a.quality] || 0 : 0;
            const scoreB = b.quality ? qualityScores[b.quality] || 0 : 0;
            if (scoreB !== scoreA)
                return scoreB - scoreA;
            const aPreferred = preferredHosts.some(h => a.url.host.includes(h)) ? 1 : 0;
            const bPreferred = preferredHosts.some(h => b.url.host.includes(h)) ? 1 : 0;
            return bPreferred - aPreferred;
        });
    };
}
exports.MisterDonghua = MisterDonghua;
