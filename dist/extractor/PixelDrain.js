"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PixelDrain = void 0;
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
// Pixeldrain exposes a direct download endpoint at /api/file/<id>?download= which
// serves the raw file (mkvdrama links here as https://pixeldrain.dev/u/<id>).
class PixelDrain extends Extractor_1.Extractor {
    id = 'pixeldrain';
    label = 'PixelDrain';
    // Eager: the PixelDrain API call is fast and returns a short local /relay URL,
    // so resolve it at stream-list time instead of burdening the user with the
    // long JSON-encoded `/extract/` URL and deferred extraction.
    lazyExtract = false;
    ttl = 3600000; // 1h
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return /pixeldrain/.test(url.host);
    }
    async extractInternal(ctx, url, meta) {
        const segments = url.pathname.split('/').filter(Boolean);
        const id = segments[segments.length - 1];
        if (!id) {
            return [];
        }
        let targetId = id;
        const origin = `${url.protocol}//${url.host}`;
        if (url.pathname.includes('/l/')) {
            const listData = await this.fetcher.json(ctx, new URL(`/api/list/${id}`, origin));
            if (listData?.files && Array.isArray(listData.files) && listData.files.length > 0) {
                let matched = false;
                // Attempt to match by episode title/tag
                if (meta.episode !== undefined) {
                    const EP_REGEX = /[.\s_-][eE]0*(\d+)/i;
                    for (const f of listData.files) {
                        const tagMatch = f.name.match(EP_REGEX);
                        if (tagMatch && tagMatch[1] && parseInt(tagMatch[1], 10) === meta.episode) {
                            targetId = f.id;
                            matched = true;
                            break;
                        }
                    }
                }
                if (!matched) {
                    targetId = listData.files[0].id; // Fallback to first file
                }
            }
            else {
                return [];
            }
        }
        let fileBytes;
        try {
            const info = await this.fetcher.json(ctx, new URL(`/api/file/${targetId}/info`, origin));
            fileBytes = typeof info?.size === 'number' && info.size > 0 ? info.size : undefined;
            if (!meta.title && info?.name) {
                meta.title = info.name;
            }
        }
        catch {
            // Public info endpoint may be disabled for some files; keep the link and fall back
            // to any size the source already provided.
        }
        const apiUrl = new URL(`/api/file/${targetId}?download=`, origin);
        const relayUrl = new URL('/relay', ctx.hostUrl);
        relayUrl.searchParams.set('url', apiUrl.href);
        relayUrl.searchParams.set('referer', origin);
        return [{
                url: relayUrl,
                format: types_1.Format.unknown,
                label: 'PixelDrain',
                meta: {
                    ...meta,
                    extractorId: this.id,
                    referer: origin,
                    ...(fileBytes && !meta.bytes ? { bytes: fileBytes } : {}),
                }
            }];
    }
}
exports.PixelDrain = PixelDrain;
