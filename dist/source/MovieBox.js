"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovieBox = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
class MovieBox extends Source_1.Source {
    id = 'moviebox';
    label = 'MovieBox';
    // The web environment of themoviebox.org functions purely as an SSR SEO honeypot, and 
    // TV episodes require token-protected SDK layers that were deprecated without replacement. 
    // Consequently, we strictly restrict this source to movies.
    contentTypes = ['movie'];
    countryCodes = [types_1.CountryCode.multi];
    baseUrl = 'https://themoviebox.org';
    priority = -1;
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    deflattenNuxt(payload) {
        try {
            const rawData = JSON.parse(payload);
            if (!Array.isArray(rawData))
                return [rawData];
            function resolve(index, seen = new Set()) {
                if (index === null || index === undefined || typeof index !== 'number' || index < 0 || index >= rawData.length)
                    return index;
                if (seen.has(index))
                    return `[Circular Ref: ${index}]`;
                const val = rawData[index];
                if (typeof val === 'string' || val === null || typeof val === 'number' || typeof val === 'boolean')
                    return val;
                if (Array.isArray(val)) {
                    seen.add(index);
                    const res = val.map(v => typeof v === 'number' ? resolve(v, new Set(seen)) : v);
                    seen.delete(index);
                    return res;
                }
                if (typeof val === 'object') {
                    seen.add(index);
                    const obj = {};
                    for (const [k, v] of Object.entries(val)) {
                        obj[k] = typeof v === 'number' ? resolve(v, new Set(seen)) : v;
                    }
                    seen.delete(index);
                    return obj;
                }
                return val;
            }
            return rawData.map((_, i) => resolve(i));
        }
        catch {
            return [];
        }
    }
    async handleInternal(ctx, _type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        if (tmdbId.season)
            return []; // TV is explicitly unsupported natively due to missing DOM routing
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        const searchUrl = new URL(`${this.baseUrl}/newWeb/searchResult`);
        searchUrl.searchParams.set('keyword', name);
        const html = await this.fetcher.text(ctx, searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
        if (!html)
            return [];
        const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
        const payloadHtml = scripts.find(s => s[1]?.includes('"detailPath"'));
        if (!payloadHtml || !payloadHtml[1])
            return [];
        const deflattened = this.deflattenNuxt(payloadHtml[1]);
        const items = deflattened.filter(x => typeof x === 'object' && x !== null && typeof x.detailPath === 'string' && typeof x.title === 'string');
        // Attempt exact match
        const yearStr = String(year);
        const exactMatch = items.find(item => {
            const titleMatch = item.title?.toLowerCase() === name.toLowerCase();
            const yearMatch = !item.releaseDate || item.releaseDate.startsWith(yearStr);
            return titleMatch && yearMatch;
        });
        const targetItem = exactMatch ?? items.find(item => item.title?.toLowerCase().includes(name.toLowerCase()));
        if (!targetItem) {
            return [];
        }
        const detailUrl = new URL(`${this.baseUrl}/moviesDetail/${targetItem.detailPath}`);
        return [{
                url: detailUrl,
                meta: {
                    countryCodes: [types_1.CountryCode.multi],
                    referer: `${this.baseUrl}/`,
                    title: `${name} (${year})`,
                },
            }];
    }
}
exports.MovieBox = MovieBox;
