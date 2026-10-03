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
exports.LuciferDonghua = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const id_1 = require("../utils/id");
const Source_1 = require("./Source");
const clean = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
class LuciferDonghua extends Source_1.Source {
    id = 'luciferdonghua';
    label = 'LuciferDonghua';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.ja];
    baseUrl = 'https://luciferdonghua.in';
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
        // Third fallback: for Kitsu-sourced IDs, try the romanised original name
        // (kitsuOriginalName) which is often the title used on donghua streaming sites.
        if (!seriesPageUrl && tmdbId instanceof id_1.KitsuMappedTmdbId) {
            const kitsuOrig = tmdbId.kitsuOriginalName;
            if (kitsuOrig && kitsuOrig !== name && kitsuOrig !== originalName) {
                seriesPageUrl = await this.fetchSeriesPageUrl(ctx, kitsuOrig, type, tmdbId);
            }
        }
        if (!seriesPageUrl) {
            return [];
        }
        let episodePageUrl = seriesPageUrl;
        if (type === 'series' || type === 'movie') {
            const epUrl = await this.fetchEpisodePageUrl(ctx, seriesPageUrl, tmdbId);
            if (!epUrl && type === 'series') {
                return [];
            }
            if (epUrl) {
                episodePageUrl = epUrl;
            }
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
        const wantMovie = type === 'movie';
        const nameClean = clean(name);
        const searchQueries = [];
        const cleanQuery = name.replace(/[:\-\u2014()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
        searchQueries.push(cleanQuery);
        const colonParts = name.split(/[:\-\u2014]/);
        if (colonParts.length > 1) {
            const baseTitle = colonParts[0].trim();
            const subtitle = colonParts.slice(1).join(' ').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
            if (subtitle)
                searchQueries.push(subtitle);
            if (baseTitle)
                searchQueries.push(baseTitle);
        }
        if (/immortal\s*slayer/i.test(name)) {
            searchQueries.push('Battle of Gods');
            searchQueries.push('Battle of Immortal Slayer');
        }
        else if (/battle\s*of\s*gods/i.test(name)) {
            searchQueries.push('Battle of Gods');
        }
        const candidates = [];
        const seenHrefs = new Set();
        for (const query of searchQueries) {
            const params = new URLSearchParams({ s: query });
            const searchUrl = new URL(`/?${params.toString()}`, this.baseUrl);
            let html;
            try {
                html = await this.fetcher.text(ctx, searchUrl);
            }
            catch {
                continue;
            }
            const $ = cheerio.load(html);
            $('.listupd .bsx, .listupd article').each((_, el) => {
                const $el = $(el);
                const headingText = ($el.find('h2, h3').first().text() || '').trim();
                const anchor = $el.find('a').first();
                const href = anchor.attr('href') ?? '';
                if (!href.startsWith('http') || seenHrefs.has(href))
                    return;
                const title = headingText || (anchor.attr('title') || anchor.text()).trim();
                if (!title)
                    return;
                seenHrefs.add(href);
                const typez = $el.find('.typez').first().text().trim().toLowerCase();
                const isEpisode = typez.includes('ep') || typez === 'episode' || title.toLowerCase().includes('episode ');
                if (isEpisode)
                    return;
                const isMovie = typez === 'movie' || title.toLowerCase().includes('movie');
                candidates.push({ href, title, isMovie, exact: clean(title) === nameClean });
            });
            if (candidates.length === 0) {
                $('a.series, .leftseries a').each((_, el) => {
                    const href = $(el).attr('href') ?? '';
                    const title = $(el).text().trim();
                    if (href.startsWith('http') && title && !seenHrefs.has(href)) {
                        seenHrefs.add(href);
                        candidates.push({ href, title, isMovie: false, exact: clean(title) === nameClean });
                    }
                });
            }
        }
        if (candidates.length === 0) {
            return undefined;
        }
        const nameSeasonMatch = name.match(/season\s*(\d+)/i);
        const effectiveSeason = (tmdbId.season && tmdbId.season > 1)
            ? tmdbId.season
            : (nameSeasonMatch ? parseInt(nameSeasonMatch[1] ?? '0', 10) : (tmdbId.season !== undefined ? tmdbId.season : 1));
        const tokenize = (str) => {
            const STOP = new Set(['the', 'of', 'in', 'and', 'a', 'an', 'sub', 'dub', 'movie', 'part', 'pt', '2023', '2024', '2025', '2026']);
            return str.toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 1 && !STOP.has(w));
        };
        const tokenScore = (queryTokens, titleTokens) => {
            if (queryTokens.length === 0 || titleTokens.length === 0)
                return 0;
            let count = 0;
            for (const q of queryTokens) {
                if (titleTokens.includes(q))
                    count++;
            }
            return count / queryTokens.length;
        };
        const qTokens = tokenize(name);
        const aliasTokens = /immortal\s*slayer|battle\s*of\s*gods/i.test(name)
            ? tokenize('Renegade Immortal Battle of Gods Divine Descent')
            : [];
        const scored = candidates.map(c => {
            const cTokens = tokenize(c.title);
            const s1 = tokenScore(qTokens, cTokens);
            const s2 = aliasTokens.length > 0 ? tokenScore(aliasTokens, cTokens) : 0;
            return { ...c, score: Math.max(s1, s2) };
        }).filter(c => c.score >= 0.35 || c.exact);
        scored.sort((a, b) => {
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
            return b.score - a.score;
        });
        // Check if candidates have real episode links
        for (const candidate of scored) {
            try {
                const candidateUrl = new URL(candidate.href);
                const pageHtml = await this.fetcher.text(ctx, candidateUrl);
                const $c = cheerio.load(pageHtml);
                const hasEps = $c('.eplister a, .bixbox.bxcl a, li.ep-item a, ul.ep_list a').toArray()
                    .some(el => {
                    const h = $c(el).attr('href');
                    return h && h !== '#' && !h.endsWith('#') && h !== candidate.href && !h.includes('/anime/');
                });
                if (hasEps) {
                    return candidateUrl;
                }
            }
            catch { /* skip candidate on error */ }
        }
        const best = scored[0] ?? candidates[0];
        return best ? new URL(best.href) : undefined;
    };
    fetchEpisodePageUrl = async (ctx, seriesPageUrl, tmdbId) => {
        const html = await this.fetcher.text(ctx, seriesPageUrl);
        const $ = cheerio.load(html);
        // Collect all episode links upfront, cataloguing those with a real href vs '#'.
        // LuciferDonghua uses href="#" for Episode 1 because its player is dynamically
        // loaded via JavaScript — the static HTML has no embed data for it.
        const EP_SELECTORS = '.eplister a, .bixbox.bxcl a, li.ep-item a, .episodesList a';
        const allRawLinks = $(EP_SELECTORS).toArray();
        // Separate real URLs from '#'-anchor stubs
        const realLinks = [];
        const stubEpisodes = new Set(); // episode numbers that only have '#' hrefs
        for (const el of allRawLinks) {
            const href = $(el).attr('href') ?? '';
            const linkText = $(el).text().trim();
            // Try to determine the episode number this link represents (supports episode, part, pt)
            const hrefNumMatch = href.match(/(?:episode|part|pt)[-_](?:new-|edit-)?0*(\d+)/i) || href.match(/[-_]ep[-_]?0*(\d+)/i);
            const textNumMatch = linkText.match(/^0*(\d+)/) || linkText.match(/(?:episode|part|pt)[^\d]*(\d+)/i);
            const num = hrefNumMatch?.[1] ? parseInt(hrefNumMatch[1], 10)
                : textNumMatch?.[1] ? parseInt(textNumMatch[1], 10)
                    : null;
            if (!href || href === '#' || href.endsWith('#') || href === seriesPageUrl.href || href.includes('/anime/')) {
                // '#' stub — the episode is JS-rendered; record it for fallback URL derivation
                if (num !== null)
                    stubEpisodes.add(num);
            }
            else {
                try {
                    new URL(href, seriesPageUrl.href);
                    realLinks.push({ href, num, text: linkText });
                }
                catch { /* skip */ }
            }
        }
        if (tmdbId.episode) {
            // ── Pass 1: look for an exact match in real links by URL slug ──
            for (const { href, num } of realLinks) {
                if (num !== null && num === tmdbId.episode) {
                    try {
                        return new URL(href, seriesPageUrl.href);
                    }
                    catch { /* skip */ }
                }
            }
            // ── Pass 2: match by visible link text ──
            for (const { href, num, text } of realLinks) {
                if (num !== null)
                    continue; // already tried numeric slug match
                const textNumMatch = text.match(/^0*(\d+)/) || text.match(/(?:episode|part|pt)[^\d]*(\d+)/i);
                if (textNumMatch?.[1] && parseInt(textNumMatch[1], 10) === tmdbId.episode) {
                    try {
                        return new URL(href, seriesPageUrl.href);
                    }
                    catch { /* skip */ }
                }
            }
            // ── Pass 3: target episode has href="#" (JS-rendered) — derive URL from adjacent episode slug ──
            // e.g. if ep 1 is '#' but ep 2 is '.../episode-02-.../', replace '02' with '01'.
            if (stubEpisodes.has(tmdbId.episode) || realLinks.every(l => l.num !== tmdbId.episode)) {
                const targetPad2 = String(tmdbId.episode).padStart(2, '0');
                const targetPad3 = String(tmdbId.episode).padStart(3, '0');
                for (const { href } of realLinks) {
                    // Match the episode number segment in the slug and substitute the target episode
                    const derived = href.replace(/(episode[-_](?:new-|edit-)?)0*(\d+)/i, (_, prefix, num) => {
                        const padLen = Math.max(num.length, 2);
                        const padded = padLen >= 3 ? targetPad3 : targetPad2;
                        return `${prefix}${padded}`;
                    });
                    if (derived !== href) {
                        try {
                            return new URL(derived, seriesPageUrl.href);
                        }
                        catch { /* skip */ }
                    }
                }
            }
        }
        // ── Fallback: return first real link ──
        if (realLinks.length > 0) {
            try {
                return new URL(realLinks[0].href, seriesPageUrl.href);
            }
            catch { /* skip */ }
        }
        // ── Last resort: any <a href*="episode"> that isn't '#' ──
        const link = $('a[href*="episode"]').toArray()
            .map(el => $(el).attr('href') ?? '')
            .find(h => h && h !== '#' && !h.endsWith('#') && h !== seriesPageUrl.href && !h.includes('/anime/'));
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
            if (!src || src.startsWith('about:') || src.startsWith('javascript:'))
                return;
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
        // Both sites use schema.org VideoObject markup with itemprop="embedUrl".
        // This is the most reliable single-source extraction method.
        $('[itemtype*="VideoObject"], [itemtype*="videoobject"]').each((_, el) => {
            const embedUrl = $(el).find('[itemprop="embedUrl"]').attr('content') || '';
            if (embedUrl)
                addResult(embedUrl, '4K');
        });
        // ── Method 2: Base64-encoded select options (DonghuaStream style) ──
        // The <select> server picker has base64-encoded HTML option values containing
        // <iframe src="..."> or VideoObject markup.
        $('select option[value]').each((_, el) => {
            const value = $(el).attr('value');
            const label = $(el).text().trim().toLowerCase();
            if (!value || value.startsWith('http'))
                return; // Skip plain-URL options (LuciferDonghua)
            try {
                const decoded = Buffer.from(value, 'base64').toString('utf-8');
                // Match src="..." in the decoded HTML
                const iframeMatch = decoded.match(/src=["']([^"']+)["']/);
                if (iframeMatch?.[1]) {
                    let quality = '4K';
                    if (label.includes('1080'))
                        quality = '1080p';
                    else if (label.includes('720'))
                        quality = '720p';
                    addResult(iframeMatch[1], quality);
                }
            }
            catch {
                // ignore invalid base64
            }
        });
        // ── Method 3: Mirror page URLs (LuciferDonghua style) ──
        // Some sites use <select class="mirror"> with option values pointing to
        // /v/N/ mirror pages. Follow each to extract the VideoObject embedUrl or iframes.
        // NOTE: These mirror pages render the full episode page again but with a different
        // active server. We use a WHITELIST of known streaming CDN hostnames to avoid
        // picking up ad iframes (e.g. t.co short-links, blogspot interstitials).
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
                const label = $(el).text().trim().toLowerCase();
                let quality = '4K';
                if (label.includes('1080'))
                    quality = '1080p';
                else if (label.includes('720'))
                    quality = '720p';
                mirrorUrls.push({ url: value, quality });
            }
        });
        for (const mirror of mirrorUrls.slice(0, 5)) {
            try {
                const mirrorHtml = await this.fetcher.text(ctx, new URL(mirror.url));
                const $m = cheerio.load(mirrorHtml);
                $m('[itemtype*="VideoObject"] [itemprop="embedUrl"]').each((_, el) => {
                    const embedUrl = $m(el).attr('content') || '';
                    if (embedUrl)
                        addResult(embedUrl, mirror.quality);
                });
                // Whitelist-only iframe extraction — normalize protocol-relative URLs first
                // so that //ok.ru/... and //dailymotion.com/... are correctly identified.
                $m('iframe[src]').each((_, el) => {
                    let src = $m(el).attr('src') || '';
                    if (src.startsWith('//'))
                        src = 'https:' + src;
                    if (src && isStreamHost(src))
                        addResult(src, mirror.quality);
                });
            }
            catch { /* mirror page fetch failed */ }
        }
        // ── Method 4: Direct iframes on the episode page (whitelist-only) ──
        // Only use known streaming hosts to avoid ad iframes being returned as results.
        $('iframe[src]').each((_, el) => {
            let src = $(el).attr('src') || '';
            if (src.startsWith('//'))
                src = 'https:' + src;
            if (src && isStreamHost(src))
                addResult(src, '4K');
        });
        // Filter out blacklisted hosts (ads, broken hosts, internal pages)
        const blacklistedHosts = ['doods.pro', 'doodstream', 'playmogo.com', 't.co', 'blogspot.com', 'luciferdonghua.in', 'donghuastream.org'];
        const filtered = results.filter(r => !blacklistedHosts.some(host => r.host.includes(host)));
        // De-dupe and sort to prioritize 4K/1080p
        const unique = new Map();
        for (const r of filtered) {
            if (!unique.has(r.url.href) || (!unique.get(r.url.href)?.quality && r.quality)) {
                unique.set(r.url.href, r.quality ? { url: r.url, quality: r.quality } : { url: r.url });
            }
        }
        const qualityScores = { '4K': 3, '1080p': 2, '720p': 1 };
        return Array.from(unique.values()).sort((a, b) => {
            const scoreA = a.quality ? qualityScores[a.quality] || 0 : 0;
            const scoreB = b.quality ? qualityScores[b.quality] || 0 : 0;
            return scoreB - scoreA;
        });
    };
}
exports.LuciferDonghua = LuciferDonghua;
