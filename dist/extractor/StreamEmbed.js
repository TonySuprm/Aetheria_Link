"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamEmbed = void 0;
const error_1 = require("../error");
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
class StreamEmbed extends Extractor_1.Extractor {
    id = 'streamembed';
    label = 'StreamEmbed';
    ttl = 21600000; // 6h
    supports(_ctx, url) {
        return null !== url.host.match(/bullstream|mp4player|watch\.gxplayer/);
    }
    async extractInternal(ctx, url, meta) {
        const headers = { Referer: meta.referer ?? url.href };
        const html = await this.fetcher.text(ctx, url, { headers });
        if (/Video is not ready/.test(html)) {
            throw new error_1.NotFoundError();
        }
        const videoMatch = html.match(/video ?= ?(.*);/);
        if (!videoMatch)
            throw new error_1.NotFoundError();
        const videoJson = videoMatch[1];
        const video = JSON.parse(videoJson);
        const m3u8Url = new URL(`/m3u8/${video.uid}/${video.md5}/master.txt?s=1&id=${video.id}&cache=${video.status}`, url.origin);
        const streamUrl = (0, utils_1.supportsMediaFlowProxy)(ctx)
            ? (0, utils_1.buildMediaFlowProxyHlsUrl)(ctx, m3u8Url, { Referer: url.origin }, true)
            : m3u8Url;
        return [
            {
                url: streamUrl,
                format: types_1.Format.hls,
                meta: {
                    ...meta,
                    height: (() => {
                        try {
                            if (!video.quality)
                                return undefined;
                            const qualities = JSON.parse(video.quality);
                            const firstQuality = qualities[0];
                            const height = parseInt(firstQuality);
                            return height || undefined;
                        }
                        catch {
                            return undefined;
                        }
                    })(),
                    title: decodeURIComponent(video.title),
                },
            },
        ];
    }
    ;
}
exports.StreamEmbed = StreamEmbed;
