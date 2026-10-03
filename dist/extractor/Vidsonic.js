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
exports.Vidsonic = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
function decodeHexUrl(hexString) {
    const joined = hexString.split('|').join('');
    let decoded = '';
    for (let i = 0; i < joined.length; i += 2) {
        decoded += String.fromCharCode(parseInt(joined.substring(i, i + 2), 16));
    }
    return decoded.split('').reverse().join('');
}
class Vidsonic extends Extractor_1.Extractor {
    id = 'vidsonic';
    label = 'Vidsonic';
    ttl = 43200000; // 12h
    supports(_ctx, url) {
        return null !== url.host.match(/vidsonic/);
    }
    async extractInternal(ctx, url, meta) {
        const html = await this.fetcher.text(ctx, url);
        const $ = cheerio.load(html);
        const title = $('title').text().trim().replace(/^Watch /, '').trim();
        const hexMatch = html.match(/const _0x1\s*=\s*'([^']+)'/);
        if (!hexMatch || !hexMatch[1]) {
            throw new Error('Could not find hex-encoded video URL in Vidsonic page');
        }
        const m3u8Url = new URL(decodeHexUrl(hexMatch[1]));
        const headers = { Origin: url.origin };
        // Compute a dynamic TTL based on the expires parameter in the m3u8 URL.
        const expiresParam = m3u8Url.searchParams.get('expires');
        const tokenTtl = Math.max(900000, Number(expiresParam) * 1000 - Date.now() - 120000); // 2min safety buffer
        return [
            {
                url: m3u8Url,
                format: types_1.Format.hls,
                ttl: Math.min(tokenTtl, this.ttl),
                meta: {
                    ...meta,
                    height: meta.height ?? await (0, utils_1.guessHeightFromPlaylist)(ctx, this.fetcher, m3u8Url, { headers }),
                    title,
                },
                requestHeaders: headers,
            },
        ];
    }
}
exports.Vidsonic = Vidsonic;
