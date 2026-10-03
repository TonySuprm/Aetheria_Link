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
exports.HBLinks = void 0;
const cheerio = __importStar(require("cheerio"));
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
class HBLinks extends Extractor_1.Extractor {
    id = 'hblinks';
    label = 'HUBLinks';
    lazyExtract = true;
    ttl = 120000; // 2 min
    cacheVersion = 2;
    hubExtractor;
    constructor(fetcher, logger, hubExtractor) {
        super(fetcher, logger);
        this.hubExtractor = hubExtractor;
    }
    supports(_ctx, url) {
        return /hblinks/.test(url.host.toLowerCase());
    }
    async extractInternal(ctx, url, meta) {
        const headers = { Referer: meta.referer ?? url.href };
        let html;
        try {
            html = await this.fetcher.text(ctx, url, { headers });
        }
        catch (error) {
            this.logger.warn(`HBLinks page fetch failed for ${url.href}: ${error}`);
            return [];
        }
        const $ = cheerio.load(html);
        const pageTitle = $('title').text().trim();
        const countryCodes = [...new Set([...meta.countryCodes ?? [], ...(0, utils_1.findCountryCodes)(pageTitle)])];
        const height = meta.height ?? (0, utils_1.findHeight)(pageTitle);
        const updatedMeta = { ...meta, countryCodes, height, title: pageTitle || meta.title };
        const hubLinks = this.extractHubLinks($, url);
        // Deduplicate by canonical URL — hubdrive and hubcloud may resolve to the same file
        const canonicalUrls = await Promise.all(hubLinks.map(hubUrl => this.hubExtractor.normalizeAsync(ctx, hubUrl)));
        const seenCanonical = new Set();
        const uniqueLinks = [];
        for (let i = 0; i < hubLinks.length; i++) {
            const canonical = canonicalUrls[i];
            const hubUrl = hubLinks[i];
            /* istanbul ignore if -- index is always valid */
            if (!canonical || !hubUrl)
                continue;
            if (!seenCanonical.has(canonical.href)) {
                seenCanonical.add(canonical.href);
                uniqueLinks.push(hubUrl);
            }
        }
        const results = [];
        for (const hubUrl of uniqueLinks) {
            try {
                results.push(...await this.hubExtractor.extract(ctx, hubUrl, updatedMeta));
            }
            catch (error) {
                this.logger.warn(`HBLinks extraction failed for ${hubUrl.href}: ${error}`);
            }
        }
        return results;
    }
    // Extract all hub links (hubcdn, hubcloud, hubdrive), deduplicated by URL
    extractHubLinks($, pageUrl) {
        const links = [];
        const seen = new Set();
        $('a[href]').each((_i, el) => {
            const href = $(el).attr('href');
            if (href && utils_1.HUB_HOST_PATTERN.test(href.toLowerCase())) {
                try {
                    const parsedUrl = new URL(href, pageUrl);
                    const key = parsedUrl.href;
                    if (!seen.has(key)) {
                        seen.add(key);
                        links.push(parsedUrl);
                    }
                }
                catch {
                    // skip invalid URL
                }
            }
        });
        return links;
    }
}
exports.HBLinks = HBLinks;
