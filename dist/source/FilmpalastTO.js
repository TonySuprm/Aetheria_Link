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
exports.FilmpalastTO = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const STREAMING_HOSTS = [
    'voe', 'dood', 'streamtape', 'veev', 'vinovo', 'vidhide', 'dhtpre',
    'mixdrop', 'supervideo', 'uqload', 'filelion', 'lulustream', 'fastream',
    'dropload', 'savefiles', 'streamembed', 'vidara', 'vidsonic',
];
const isStreamingHost = (hostname) => STREAMING_HOSTS.some(host => hostname.includes(host));
const resolveHref = (href, baseUrl) => {
    const fullHref = href.startsWith('//') ? `https:${href}` : href;
    return new URL(fullHref.startsWith('http') ? fullHref : `${baseUrl}${fullHref}`);
};
class FilmpalastTO extends Source_1.Source {
    id = 'filmpalast';
    label = 'Filmpalast';
    baseUrl = 'https://filmpalast.to';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.de];
    priority = 1;
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, _type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId, 'de');
        let streamPageUrl;
        try {
            streamPageUrl = await this.fetchStreamPageUrl(ctx, name, year, tmdbId.season, tmdbId.episode);
        }
        catch {
            return [];
        }
        if (!streamPageUrl) {
            return [];
        }
        const title = tmdbId.season
            ? `${name} ${tmdbId.formatSeasonAndEpisode()}`
            : `${name} (${year})`;
        const html = await this.fetcher.text(ctx, streamPageUrl);
        const $ = cheerio.load(html);
        const results = [];
        $('ul.currentStreamLinks').each((_i, streamBlock) => {
            const hostName = $(streamBlock).find('.hostName').text().trim();
            $(streamBlock).find('a[data-player-url]').each((_j, el) => {
                const playerUrl = $(el).attr('data-player-url');
                if (playerUrl?.startsWith('http')) {
                    results.push({
                        url: new URL(playerUrl),
                        meta: {
                            countryCodes: [types_1.CountryCode.de],
                            referer: streamPageUrl.href,
                            title: `${hostName} - ${title}`,
                            sourceLabel: this.label,
                        },
                    });
                }
            });
            $(streamBlock).find('a[href]').each((_j, el) => {
                const href = $(el).attr('href');
                if (!href || href === '#' || href.startsWith('javascript') || href.includes('filmpalast.to') || $(el).attr('data-player-url')) {
                    return;
                }
                try {
                    const url = resolveHref(href, this.baseUrl);
                    if (isStreamingHost(url.hostname)) {
                        results.push({
                            url,
                            meta: {
                                countryCodes: [types_1.CountryCode.de],
                                referer: streamPageUrl.href,
                                title: `${hostName} - ${title}`,
                                sourceLabel: this.label,
                            },
                        });
                    }
                }
                catch {
                    // Invalid URL, skip
                }
            });
        });
        return results;
    }
    fetchStreamPageUrl = async (ctx, name, year, season, episode) => {
        const searchQuery = season
            ? `${name} S${String(season).padStart(2, '0')}E${String(episode ?? 1).padStart(2, '0')}`
            : name;
        const searchUrl = new URL(`/search/title/${encodeURIComponent(searchQuery)}`, this.baseUrl);
        const html = await this.fetcher.text(ctx, searchUrl);
        const $ = cheerio.load(html);
        const streamLinks = $('a[href*="/stream/"]')
            .map((_i, el) => ({
            href: $(el).attr('href'),
            title: ($(el).attr('title') ?? $(el).text().trim()),
        }))
            .get();
        if (streamLinks.length === 0) {
            return undefined;
        }
        // For movies: try to match by year first
        if (!season) {
            const yearMatch = streamLinks.find(link => link.title.includes(String(year)));
            if (yearMatch) {
                return resolveHref(yearMatch.href, this.baseUrl);
            }
        }
        // Fallback: use the first result
        const firstLink = streamLinks[0];
        /* istanbul ignore if */
        if (!firstLink) {
            return undefined;
        }
        return resolveHref(firstLink.href, this.baseUrl);
    };
}
exports.FilmpalastTO = FilmpalastTO;
