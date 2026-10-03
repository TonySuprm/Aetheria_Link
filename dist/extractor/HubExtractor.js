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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HubExtractor = exports.cdnHash = void 0;
const bytes_1 = __importDefault(require("bytes"));
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
const HubCloud_1 = require("./HubCloud");
/** True CDN (GDrive) vs HubCloud host that would duplicate. */
const isCdnDirectUrl = (url) => /googleusercontent\.com/.test(url.hostname);
/** FNV-1a hash of URL pathname — unique bingeGroup per CDN link */
const cdnHash = (url) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < url.pathname.length; i++) {
        hash ^= url.pathname.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 4);
};
exports.cdnHash = cdnHash;
const DEFAULT_EVICTION_THRESHOLD = 256;
class HubExtractor extends Extractor_1.Extractor {
    id = 'hub';
    label = 'HubCloud';
    lazyExtract = true;
    // Background-warm at stream-list time so the HubCloud file page (which carries the real file
    // size + title) is fetched once, fire-and-forget. Without this the lazy cache only fills on the
    // first PLAY, so stream cards never show a file size (and episode cards show none at all — the
    // HDHub4u listing page lists no per-episode size). The prewarm is detached from the request's
    // AbortController so it can't stall the 18s stream deadline; it warms the 7-day lazy cache, so
    // every subsequent list request shows size + title on the cards.
    prewarmLazy = true;
    cacheVersion = 3;
    ttl = utils_1.HUBCLOUD_CACHE_TTL;
    hubCloud;
    evictionThreshold;
    resolutionCache = new Map();
    hubCdnCache = new Map();
    constructor(fetcher, logger, hubCloud, evictionThreshold) {
        super(fetcher, logger);
        this.hubCloud = hubCloud ?? new HubCloud_1.HubCloud(fetcher, logger);
        this.evictionThreshold = evictionThreshold ?? DEFAULT_EVICTION_THRESHOLD;
    }
    supports(_ctx, url) {
        return utils_1.HUB_HOST_PATTERN.test(url.hostname);
    }
    // Resolve to canonical form for cache key. Network fetches are deferred to extractInternal
    // (play time) — performing them here during stream-list resolution blocks the per-source
    // Promise.all past the 18s deadline, dropping ALL of a source's UrlResults (e.g. HDHub4u's
    // 18 hubdrive/hubcdn links vanish entirely). Use cached resolution if available (populated by
    // a prior play); otherwise return the original URL so the instant /extract/ proxy is returned
    // immediately and the real resolution runs lazily at play time.
    async normalizeAsync(_ctx, url) {
        // HubCDN: use cached resolution if available, otherwise return as-is (no fetch)
        if (/hubcdn/.test(url.hostname)) {
            const cached = this.hubCdnCache.get(url.href);
            if (cached && Date.now() - cached.ts < utils_1.HUBCLOUD_CACHE_TTL && cached.result.delegateToHubCloud) {
                return this.stripQueryParams(cached.result.url);
            }
            return url;
        }
        // HubCloud: strip ephemeral ?token= for canonical cache key only — BUT preserve from_ac + q
        // on search-recover URLs. Those params identify the file (different episodes/qualities carry
        // different from_ac/q) and are required to resolve it at play time. Stripping them collapsed
        // every search-recover URL into one cache key (so only one quality's extraction was ever
        // cached, the rest deduped to the same /extract/ link) and broke play-time extraction (the
        // /extract/ URL would lack the params needed to fetch the file).
        if (/hubcloud/.test(url.hostname)) {
            if (url.pathname.includes('search-recover')) {
                const u = new URL(url);
                const fromAc = u.searchParams.get('from_ac');
                const q = u.searchParams.get('q');
                u.search = '';
                if (fromAc)
                    u.searchParams.set('from_ac', fromAc);
                if (q)
                    u.searchParams.set('q', q);
                return u;
            }
            return this.stripQueryParams(url);
        }
        // HubDrive: use cached resolution if available, otherwise return as-is (no fetch)
        const cached = this.resolutionCache.get(url.href);
        if (cached && Date.now() - cached.ts < utils_1.HUBCLOUD_CACHE_TTL) {
            return this.stripQueryParams(cached.url);
        }
        return url;
    }
    async extractInternal(ctx, url, meta) {
        if (utils_1.DEAD_HUBCLOUD_HOSTS.has(url.hostname)) {
            return [];
        }
        // HubCDN → may redirect to HubCloud (needs further extraction) or direct video URL
        if (/hubcdn/.test(url.hostname)) {
            try {
                const result = await this.resolveHubCdnUrl(ctx, url);
                if (!result)
                    return [];
                if (result.delegateToHubCloud) {
                    try {
                        return await this.hubCloud.extractInternal(ctx, result.url, meta);
                    }
                    catch {
                        return [];
                    }
                }
                // True CDN direct URL (googleusercontent.com)
                return [{
                        url: result.url,
                        format: types_1.Format.unknown,
                        meta: { ...meta, extractorId: `hub_cdn_${(0, exports.cdnHash)(url)}` },
                        label: 'HubCloud (CDN)',
                    }];
            }
            catch {
                return [];
            }
        }
        // HubDrive → try resolution cache first, then fallback
        if (/hubdrive/.test(url.hostname)) {
            const cached = this.resolutionCache.get(url.href);
            if (cached && Date.now() - cached.ts < utils_1.HUBCLOUD_CACHE_TTL) {
                try {
                    const enrichedMeta = { ...cached.meta, ...meta, countryCodes: [...new Set([...cached.meta.countryCodes ?? [], ...meta.countryCodes ?? []])] };
                    return await this.hubCloud.extractInternal(ctx, cached.url, enrichedMeta);
                }
                catch {
                    return [];
                }
            }
            // Fallback: re-resolve from scratch
            return this.extractViaHubCloud(ctx, url, meta);
        }
        // HubCloud → delegate directly
        return await this.hubCloud.extractInternal(ctx, url, meta);
    }
    // Extract metadata from HubDrive page (title, countryCodes, height, bytes)
    extractHubDriveMeta($) {
        const pageTitle = $('title').text().replace(/^HubDrive\s*\|\s*/, '').trim();
        const fileSizeText = $('td').filter((_i, el) => $(el).text().trim() === 'File Size').next().text().trim();
        const countryCodes = (0, utils_1.findCountryCodes)(pageTitle);
        const height = (0, utils_1.findHeight)(pageTitle);
        return {
            ...(pageTitle && { title: pageTitle }),
            ...(countryCodes.length > 0 && { countryCodes }),
            ...(height !== undefined && { height }),
            ...(fileSizeText && { bytes: bytes_1.default.parse(fileSizeText) }),
        };
    }
    // Find HubCloud link on HubDrive page
    findHubCloudUrl($) {
        const hubCloudUrl = $('a:contains("HubCloud")')
            .map((_i, el) => {
            const href = $(el).attr('href');
            if (!href)
                return null;
            try {
                const parsed = new URL(href);
                if (utils_1.DEAD_HUBCLOUD_HOSTS.has(parsed.hostname))
                    return null;
                return parsed;
            }
            catch {
                return null;
            }
        })
            .get(0);
        return hubCloudUrl ?? null;
    }
    // Fallback extraction when normalizeAsync resolution failed
    async extractViaHubCloud(ctx, url, meta) {
        const headers = { Referer: meta.referer ?? url.href };
        let html;
        try {
            html = await this.fetcher.text(ctx, url, { headers });
        }
        catch {
            return [];
        }
        const $ = cheerio.load(html);
        const hubCloudUrl = this.findHubCloudUrl($);
        if (!hubCloudUrl) {
            return [];
        }
        const hubDriveMeta = this.extractHubDriveMeta($);
        const enrichedMeta = { ...hubDriveMeta, ...meta, countryCodes: [...new Set([...hubDriveMeta.countryCodes ?? [], ...meta.countryCodes ?? []])] };
        // Cache the resolution so subsequent stream-list normalizeAsync calls can use it
        // (for dedup against direct hubcloud URLs and for cache-key consistency).
        this.resolutionCache.set(url.href, { url: hubCloudUrl, meta: hubDriveMeta, ts: Date.now() });
        if (this.resolutionCache.size > this.evictionThreshold) {
            this.evictExpired(this.resolutionCache);
        }
        try {
            return await this.hubCloud.extractInternal(ctx, hubCloudUrl, enrichedMeta);
        }
        catch {
            return [];
        }
    }
    evictExpired(cache) {
        const now = Date.now();
        for (const [key, entry] of cache) {
            if (now - entry.ts >= utils_1.HUBCLOUD_CACHE_TTL) {
                cache.delete(key);
            }
        }
    }
    // Resolve HubCDN URL with in-memory cache to avoid double-fetch between normalizeAsync and extractInternal
    async resolveHubCdnUrl(ctx, url) {
        const cached = this.hubCdnCache.get(url.href);
        if (cached && Date.now() - cached.ts < utils_1.HUBCLOUD_CACHE_TTL) {
            return cached.result;
        }
        const headers = { Referer: url.href };
        const html = await this.fetcher.text(ctx, url, { headers });
        const result = this.extractHubCdnUrl(html);
        if (result) {
            this.hubCdnCache.set(url.href, { result, ts: Date.now() });
            if (this.hubCdnCache.size > this.evictionThreshold) {
                this.evictExpired(this.hubCdnCache);
            }
        }
        return result;
    }
    // Unified HubCDN extraction — handles /dl/?link=, ?r=BASE64, <a id="vd">, googleusercontent
    extractHubCdnUrl(html) {
        // Pattern 1: var reurl = "..."
        const reurlMatch = html.match(/var\s+reurl\s*=\s*["']([^"']+)["']/);
        if (reurlMatch?.[1]) {
            const reurlValue = reurlMatch[1];
            // 1a: /dl/?link=URL → extract link param
            if (reurlValue.includes('hubcdn') && reurlValue.includes('/dl/?link=')) {
                try {
                    const linkParam = new URL(reurlValue).searchParams.get('link');
                    if (linkParam) {
                        const targetUrl = new URL(linkParam);
                        return { url: targetUrl, delegateToHubCloud: !isCdnDirectUrl(targetUrl) };
                    }
                }
                catch { /* fallthrough */ }
            }
            // 1b: ?r=BASE64 → decode (alternative mirror format)
            const rMatch = reurlValue.match(/[?&]r=([A-Za-z0-9+/=]+)/);
            if (rMatch?.[1]) {
                try {
                    const decoded = atob(rMatch[1]);
                    const linkMatch = decoded.match(/[?&]link=(.+)$/);
                    const finalUrl = linkMatch?.[1] ? new URL(decodeURIComponent(linkMatch[1])) : new URL(decoded);
                    return { url: finalUrl, delegateToHubCloud: !isCdnDirectUrl(finalUrl) };
                }
                catch { /* fallthrough */ }
            }
            // 1c: Plain URL (direct video URL — skip self-referential hubcdn/dl/ URLs)
            if (!reurlValue.includes('/dl/?link=')) {
                try {
                    const directUrl = new URL(reurlValue);
                    return { url: directUrl, delegateToHubCloud: !isCdnDirectUrl(directUrl) };
                }
                catch { /* fallthrough */ }
            }
        }
        // Pattern 2: <a id="vd" href='URL'>
        const vdMatch = html.match(/<a\s+id=["']vd["']\s+href=["']([^"']+)["']/i);
        if (vdMatch?.[1]) {
            try {
                const vdUrl = new URL(vdMatch[1]);
                return { url: vdUrl, delegateToHubCloud: !isCdnDirectUrl(vdUrl) };
            }
            catch { /* next */ }
        }
        // Pattern 3: any googleusercontent.com URL (fallback) — always CDN direct
        const gdriveMatch = html.match(/(https?:\/\/[^\s"'<>]*googleusercontent\.com[^\s"'<>]*)/);
        if (gdriveMatch?.[1]) {
            try {
                return { url: new URL(gdriveMatch[1]), delegateToHubCloud: false };
            }
            catch { /* next */ }
        }
        return null;
    }
    // Strip query params for canonical cache key
    stripQueryParams(url) {
        const canonical = new URL(url);
        canonical.search = '';
        return canonical;
    }
}
exports.HubExtractor = HubExtractor;
