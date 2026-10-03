"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vidara = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
class Vidara extends Extractor_1.Extractor {
    id = 'vidara';
    label = 'Vidara';
    ttl = 21600000; // 6h
    supports(_ctx, url) {
        return null !== url.host.match(/vidara/);
    }
    async extractInternal(ctx, url, meta) {
        const filecode = url.pathname.split('/').filter(Boolean).pop();
        if (!filecode) {
            throw new Error('Could not extract filecode from Vidara URL');
        }
        const apiUrl = new URL('/api/stream', url.origin);
        const responseBody = await this.fetcher.textPost(ctx, apiUrl, JSON.stringify({ filecode, device: 'web' }), { headers: { 'Content-Type': 'application/json' } });
        const data = JSON.parse(responseBody);
        if (!data.streaming_url) {
            throw new Error('No streaming_url in Vidara API response');
        }
        const m3u8Url = new URL(data.streaming_url);
        const headers = { Origin: url.origin };
        return [
            {
                url: m3u8Url,
                format: types_1.Format.hls,
                meta: {
                    ...meta,
                    height: meta.height ?? await (0, utils_1.guessHeightFromPlaylist)(ctx, this.fetcher, m3u8Url, { headers }),
                    title: data.title,
                },
                requestHeaders: headers,
            },
        ];
    }
}
exports.Vidara = Vidara;
