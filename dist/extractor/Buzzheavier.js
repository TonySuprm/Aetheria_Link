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
exports.Buzzheavier = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
class Buzzheavier extends Extractor_1.Extractor {
    id = 'buzzheavier';
    label = 'Buzzheavier';
    lazyExtract = true;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return /buzzheavier\.com|fuckingfast\.net|bzzhr\.co|buzzheavier\.co/.test(url.host);
    }
    async extractInternal(ctx, url, meta) {
        // 1. Fetch the page (cloudflare handled by Fetcher)
        const html = await this.fetcher.text(ctx, url);
        const $ = cheerio.load(html);
        let targetDownloadPath = null;
        let fileTitle = meta.title ?? this.label;
        // Determine episode tag matcher if this is a series
        const EPISODE_TAG_RE = /[.\s_-][eE]0*(\d+)/i;
        let foundFiles = 0;
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            const fname = $(el).text().trim();
            if (href && /^\/[a-z0-9]{12}$/.test(href) && fname.length > 5 && !href.includes('pricing')) {
                foundFiles++;
                if (meta.season !== undefined && meta.episode !== undefined) {
                    const tag = fname.match(EPISODE_TAG_RE);
                    if (tag && tag[1] && parseInt(tag[1], 10) === meta.episode) {
                        targetDownloadPath = href;
                        fileTitle = fname;
                    }
                }
                else {
                    // Movie fallback or single file directory
                    if (!targetDownloadPath) {
                        targetDownloadPath = href;
                        fileTitle = fname;
                    }
                }
            }
        });
        // 2. Locate the download endpoint hx-get attribute
        let downloadPath = null;
        if (targetDownloadPath && foundFiles > 0) {
            // We are looking at a directory page and we found a matching file link
            // We need to fetch THAT specific file page to get its hx-get download endpoint!
            const fileHtml = await this.fetcher.text(ctx, new URL(`https://buzzheavier.com${targetDownloadPath}`));
            const fileMatch = fileHtml.match(/hx-get=["'](\/[^/]+\/download\?t=[^"']+)["']/i);
            downloadPath = fileMatch?.[1] ?? null;
            if (!downloadPath) {
                const copyMatch = fileHtml.match(/copyDownloadLink\(['"](\/[^/]+\/download\?t=[^"']+)['"]\)/i);
                downloadPath = (copyMatch?.[1] ?? '').replace(/\\/g, '') || null;
            }
        }
        else {
            // We are likely ALREADY on a specific file page OR it's a legacy single file format
            const downloadMatch = html.match(/hx-get=["'](\/[^/]+\/download\?t=[^"']+)["']/i);
            downloadPath = downloadMatch?.[1] ?? null;
            if (!downloadPath) {
                const copyMatch = html.match(/copyDownloadLink\(['"](\/[^/]+\/download\?t=[^"']+)['"]\)/i);
                downloadPath = (copyMatch?.[1] ?? '').replace(/\\/g, '') || null;
            }
        }
        if (!downloadPath) {
            return [];
        }
        // 3. Resolve the redirect url
        const downloadUrl = new URL(downloadPath, url.origin);
        const finalUrl = await this.fetcher.getFinalRedirectUrl(ctx, downloadUrl);
        return [{
                url: finalUrl,
                format: types_1.Format.unknown,
                label: this.label,
                meta: {
                    ...meta,
                    title: fileTitle,
                    extractorId: this.id,
                    referer: url.origin + '/',
                },
                requestHeaders: { Referer: url.origin + '/' },
            }];
    }
}
exports.Buzzheavier = Buzzheavier;
