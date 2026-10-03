"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JustPlay = void 0;
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
class JustPlay extends Extractor_1.Extractor {
    id = 'justplay';
    label = 'JustPlay';
    lazyExtract = true;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return url.host === 'justplay.cam' || url.host.includes('justplay');
    }
    async extractInternal(ctx, url, meta) {
        // Extract video ID from embed URL: /e/${id} or /e/${id}/${slug}
        const pathParts = url.pathname.split('/').filter(Boolean);
        const eIndex = pathParts.indexOf('e');
        if (eIndex < 0 || eIndex + 1 >= pathParts.length) {
            this.logger.warn(`JustPlay: could not extract video ID from ${url.href}`);
            return [];
        }
        const videoId = pathParts[eIndex + 1];
        if (!videoId) {
            this.logger.warn(`JustPlay: could not extract video ID from ${url.href}`);
            return [];
        }
        // Call the JustPlay API to get video sources
        const apiUrl = new URL(`https://justplay.cam/api/videos/${encodeURIComponent(videoId)}/`);
        let apiData;
        try {
            apiData = await this.fetcher.json(ctx, apiUrl, {
                headers: {
                    'Referer': url.href,
                    'X-Embed-Parent': meta.referer ?? url.origin,
                    'Accept': 'application/json',
                },
            });
        }
        catch {
            this.logger.warn(`JustPlay: API request failed for video ${videoId}`);
            return [];
        }
        if (apiData.error) {
            this.logger.warn(`JustPlay: API error for video ${videoId}: ${apiData.error}`);
            return [];
        }
        const results = [];
        // Extract from sources array (primary format)
        if (Array.isArray(apiData.sources)) {
            for (const source of apiData.sources) {
                if (source.url) {
                    results.push({
                        url: new URL(source.url),
                        format: source.mimeType?.includes('mpegurl')
                            ? types_1.Format.hls
                            : source.mimeType?.includes('mp4')
                                ? types_1.Format.mp4
                                : source.url.includes('.m3u8')
                                    ? types_1.Format.hls
                                    : source.url.includes('.mp4')
                                        ? types_1.Format.mp4
                                        : types_1.Format.unknown,
                        meta: {
                            ...meta,
                            title: meta.title ?? this.label,
                            ...(source.height && { height: source.height }),
                        },
                    });
                }
            }
        }
        // Fallback: single stream URL fields
        if (results.length === 0) {
            const directUrl = apiData.streamUrl ?? apiData.hls ?? apiData.dash ?? apiData.file ?? apiData.source;
            if (directUrl) {
                results.push({
                    url: new URL(directUrl),
                    format: directUrl.includes('.m3u8')
                        ? types_1.Format.hls
                        : directUrl.includes('.mp4')
                            ? types_1.Format.mp4
                            : types_1.Format.unknown,
                    meta: { ...meta, title: meta.title ?? this.label },
                });
            }
        }
        if (results.length === 0) {
            this.logger.warn(`JustPlay: no video sources found for video ${videoId}`);
            return [];
        }
        // Route through internal relay to spoof Referer and avoid 403s
        return results.map((result) => {
            const relayUrl = new URL('/relay', ctx.hostUrl);
            relayUrl.searchParams.set('url', result.url.href);
            relayUrl.searchParams.set('referer', url.origin);
            return {
                url: relayUrl,
                format: result.format,
                meta: { ...result.meta, referer: url.origin },
            };
        });
    }
}
exports.JustPlay = JustPlay;
