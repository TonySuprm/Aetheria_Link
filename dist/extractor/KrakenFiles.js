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
exports.KrakenFiles = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
class KrakenFiles extends Extractor_1.Extractor {
    id = 'krakenfiles';
    label = 'KrakenFiles';
    lazyExtract = true;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return url.host.includes('krakenfiles.com');
    }
    async extractInternal(ctx, url, meta) {
        const embedHtml = await this.fetcher.text(ctx, url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': meta.referer ?? url.href,
            },
        });
        const $ = cheerio.load(embedHtml);
        // KrakenFiles embed pages contain <source src="https://phs*.krakencloud.net/play/video/...">
        const sourceUrl = $('source').attr('src') || $('video source').attr('src') || $('video').attr('src');
        if (!sourceUrl) {
            // Fallback: search for krakencloud.net video URL directly in HTML
            const cloudMatch = embedHtml.match(/(https?:\/\/phs\d+\.krakencloud\.net\/play\/video\/[^\s"'<>]+)/);
            if (!cloudMatch?.[1]) {
                this.logger.warn(`[KrakenFiles] No <source> tag found on ${url.href}`);
                return [];
            }
            const videoUrl = new URL(cloudMatch[1]);
            const relayUrl = new URL('/relay', ctx.hostUrl);
            relayUrl.searchParams.set('url', videoUrl.href);
            relayUrl.searchParams.set('referer', 'https://krakenfiles.com/');
            return [{
                    url: relayUrl,
                    format: types_1.Format.mp4,
                    meta: { ...meta, title: meta.title ?? this.label, referer: 'https://krakenfiles.com/' },
                }];
        }
        const videoUrl = new URL(sourceUrl.startsWith('//') ? `https:${sourceUrl}` : sourceUrl);
        // We must route through our internal relay so LibVLC doesn't drop the spoofed referer!
        const relayUrl = new URL('/relay', ctx.hostUrl);
        relayUrl.searchParams.set('url', videoUrl.href);
        relayUrl.searchParams.set('referer', 'https://krakenfiles.com/');
        return [{
                url: relayUrl,
                format: types_1.Format.mp4,
                meta: { ...meta, title: meta.title ?? this.label, referer: 'https://krakenfiles.com/' },
            }];
    }
}
exports.KrakenFiles = KrakenFiles;
