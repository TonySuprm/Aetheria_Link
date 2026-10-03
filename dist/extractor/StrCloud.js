"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrCloud = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
class StrCloud extends Extractor_1.Extractor {
    id = 'strcloud';
    label = 'StrCloud';
    lazyExtract = true;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return url.host.includes('strcloud.in');
    }
    async extractInternal(ctx, url, meta) {
        const embedHtml = await this.fetcher.text(ctx, url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': meta.referer ?? url.href,
            },
        });
        // Search for direct MP4 links packed in the JS or HTML
        const fileMatch = embedHtml.match(/file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i);
        let videoUrlStr = '';
        if (fileMatch) {
            videoUrlStr = fileMatch[1];
        }
        else {
            // Strcloud sometimes hides within simple video tags
            const videoTagMatch = embedHtml.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
            if (videoTagMatch) {
                videoUrlStr = videoTagMatch[1];
            }
            else {
                // StrCloud pages may contain a streamtape.com redirect URL
                const streamtapeMatch = embedHtml.match(/(https?:\/\/(?:[a-z0-9-]+\.)*(?:streamtape|strcloud|sbfull|sbchill)\.[a-z]+\/e\/[^"'\s<>]+)/i);
                if (streamtapeMatch) {
                    videoUrlStr = streamtapeMatch[1];
                }
            }
        }
        if (!videoUrlStr) {
            this.logger.warn(`[StrCloud] No direct mp4 URL found on ${url.href}`);
            return [];
        }
        const videoUrl = new URL(videoUrlStr);
        if ((0, utils_1.supportsMediaFlowProxy)(ctx)) {
            const proxyUrl = ctx.config.mediaFlowProxyUrl?.replace(/^https?:\/\//, '') ?? '';
            const protocol = ctx.config.mediaFlowProxyUrl?.startsWith('https://') ? 'https:' : 'http:';
            const proxyStreamUrl = new URL('/proxy/stream', `${protocol}//${proxyUrl}`);
            if (ctx.config.mediaFlowProxyPassword) {
                proxyStreamUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
            }
            proxyStreamUrl.searchParams.append('d', videoUrl.href);
            proxyStreamUrl.searchParams.append('h_referer', url.href);
            proxyStreamUrl.searchParams.append('h_origin', url.origin);
            return [{
                    url: proxyStreamUrl,
                    format: types_1.Format.mp4,
                    meta: meta,
                }];
        }
        return [{
                url: videoUrl,
                format: types_1.Format.mp4,
                meta: meta,
            }];
    }
}
exports.StrCloud = StrCloud;
