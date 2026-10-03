"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovieBox = void 0;
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
class MovieBox extends Extractor_1.Extractor {
    id = 'moviebox';
    label = 'MovieBox';
    ttl = 10800000; // 3h
    supports(_ctx, url) {
        return url.host === 'themoviebox.org' && url.href.includes('/moviesDetail/');
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
                if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null)
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
    async extractInternal(ctx, url, meta) {
        const html = await this.fetcher.text(ctx, url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!html)
            return [];
        const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
        const payloadHtml = scripts.find(s => s[1]?.includes('videoAddress'));
        if (!payloadHtml || !payloadHtml[1])
            return [];
        const deflattened = this.deflattenNuxt(payloadHtml[1]);
        // Locate the videoAddress root node (usually one object representing the stream container)
        const videoRefs = deflattened.filter(x => typeof x === 'object' && x !== null && x.videoAddress);
        if (videoRefs.length === 0)
            return [];
        const results = [];
        const countryCodeArray = meta.countryCodes ?? [types_1.CountryCode.multi];
        // Iterate over everything that was matched
        for (const ref of videoRefs) {
            if (!ref.videoAddress)
                continue;
            const v = ref.videoAddress;
            if (!v.url)
                continue;
            const streamUrl = new URL(v.url);
            const isHls = streamUrl.href.includes('.m3u8');
            const isMp4 = streamUrl.href.includes('.mp4');
            const format = isHls ? types_1.Format.hls : isMp4 ? types_1.Format.mp4 : types_1.Format.unknown;
            const resolution = v.width || 0;
            const sizeBytes = v.size ? parseInt(v.size, 10) : undefined;
            const height = v.height || 0; // standard 1080/720 marker
            results.push({
                url: streamUrl,
                format,
                label: height ? `${height}p` : `${resolution}w`,
                requestHeaders: { Referer: 'https://themoviebox.org/' },
                meta: {
                    ...meta,
                    countryCodes: countryCodeArray,
                    height: height || undefined,
                    bytes: sizeBytes || undefined,
                },
            });
        }
        return results;
    }
}
exports.MovieBox = MovieBox;
