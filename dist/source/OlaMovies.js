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
exports.OlaMovies = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
class OlaMovies extends Source_1.Source {
    id = 'olamovies';
    label = 'OlaMovies';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.en, types_1.CountryCode.hi];
    baseUrl = 'https://v2.olamovies.mov';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, _type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        let title = name;
        if (tmdbId.season) {
            title += ` ${tmdbId.formatSeasonAndEpisode()}`;
        }
        else {
            title += ` (${year})`;
        }
        const searchUrl = new URL(`/?s=${encodeURIComponent(name)}`, this.baseUrl);
        const searchHtml = await this.fetcher.text(ctx, searchUrl);
        const $search = cheerio.load(searchHtml);
        const resultUrl = $search('h2.entry-title a, h3.entry-title a, .entry-title a')
            .filter((_, el) => {
            const text = $search(el).text().trim().toLowerCase();
            return text.includes(name.toLowerCase());
        })
            .first()
            .attr('href');
        if (!resultUrl) {
            return [];
        }
        const postHtml = await this.fetcher.text(ctx, new URL(resultUrl));
        const $post = cheerio.load(postHtml);
        const urls = [];
        $post('.entry-content a[href*="drive.ol-am.top"], .entry-content a[href*="links.ol-am.top"], .entry-content a[href*="drive.google.com"], .wp-block-button a[href*="links.ol-am.top"], .wp-block-button a[href*="drive.ol-am.top"]').each((_, el) => {
            const href = $post(el).attr('href');
            if (href) {
                try {
                    urls.push(new URL(href));
                }
                catch {
                    // ignore invalid URLs
                }
            }
        });
        if (urls.length === 0) {
            return [];
        }
        return urls.map(url => ({ url, meta: { title, countryCodes: [types_1.CountryCode.multi, types_1.CountryCode.en, types_1.CountryCode.hi] } }));
    }
}
exports.OlaMovies = OlaMovies;
