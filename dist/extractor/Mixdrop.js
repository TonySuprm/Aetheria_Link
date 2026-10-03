"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mixdrop = void 0;
const unpacker_1 = require("unpacker");
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
class Mixdrop extends Extractor_1.Extractor {
    id = 'mixdrop';
    label = 'Mixdrop';
    lazyExtract = true;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return null !== url.host.match(/mixdrop|mixdrp|mixdroop|m1xdrop/);
    }
    async extractInternal(ctx, url, meta) {
        const html = await this.fetcher.text(ctx, url, { headers: { Referer: url.href } });
        const packedRegex = /(eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\).+?<\/script>)/is;
        const packedMatch = html.match(packedRegex);
        if (!packedMatch) {
            this.logger.warn(`[Mixdrop] Could not locate p.a.c.k.e.d script on ${url.href}`);
            return [];
        }
        const scriptText = packedMatch[1];
        let unpacked;
        try {
            unpacked = (0, unpacker_1.unpack)(scriptText);
        }
        catch (e) {
            this.logger.warn(`[Mixdrop] Failed to unpack script on ${url.href}`);
            return [];
        }
        // e.g. MDCore.wurl="//s-delivery40.mxdcontent.net/v/..."
        const wurlMatch = unpacked.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/i);
        if (!wurlMatch || !wurlMatch[1]) {
            return [];
        }
        const videoUrlStr = wurlMatch[1].startsWith('//') ? `https:${wurlMatch[1]}` : wurlMatch[1];
        const videoUrl = new URL(videoUrlStr);
        const relayUrl = new URL('/relay', ctx.hostUrl);
        relayUrl.searchParams.set('url', videoUrl.href);
        relayUrl.searchParams.set('referer', url.origin + '/');
        return [{
                url: relayUrl,
                format: types_1.Format.mp4,
                meta: { ...meta, title: meta.title ?? this.label, referer: url.origin + '/' }
            }];
    }
}
exports.Mixdrop = Mixdrop;
