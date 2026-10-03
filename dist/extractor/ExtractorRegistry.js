"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtractorRegistry = void 0;
const cacheable_1 = require("cacheable");
const types_1 = require("../types");
const utils_1 = require("../utils");
/** How long to wait for an in-flight prewarm to complete before falling back to the instant
 *  proxy. Long enough for fast extractors (HubCloud's search API ~3-5s) but short enough that
 *  slow extractors (GDFlix's FlareSolverr chain ~10-15s) don't stall the stream list. This is a
 *  CAP — the actual wait is also bounded by the remaining time to the stream deadline. */
const PREWARM_AWAIT_MS = 8000;
/** Minimum remaining time before the stream deadline required to bother awaiting a prewarm at all.
 *  Below this the source returns its instant /extract/ proxy immediately so it isn't dropped from
 *  the response. */
const PREWARM_MIN_AWAIT_MS = 500;
class ExtractorRegistry {
    logger;
    extractors;
    urlResultCache;
    lazyUrlResultCache;
    // In-flight dedup: concurrent requests for same canonical URL share one extraction Promise
    inFlight = new Map();
    constructor(logger, extractors) {
        this.logger = logger;
        this.extractors = extractors;
        this.urlResultCache = new cacheable_1.Cacheable({
            nonBlocking: true,
            primary: new cacheable_1.Keyv({ store: new cacheable_1.CacheableMemory({ lruSize: 1024 }) }),
            secondary: (0, utils_1.createKeyvSqlite)('extractor-cache-v2'),
            stats: true,
        });
        this.lazyUrlResultCache = new cacheable_1.Cacheable({
            nonBlocking: true,
            primary: new cacheable_1.Keyv({ store: new cacheable_1.CacheableMemory({ lruSize: 1024 }) }),
            secondary: (0, utils_1.createKeyvSqlite)('extractor-lazy-cache-v2'),
            stats: true,
        });
    }
    stats() {
        return {
            urlResultCache: this.urlResultCache.stats,
            lazyUrlResultCache: this.lazyUrlResultCache.stats,
        };
    }
    ;
    async handle(ctx, url, meta, allowLazy) {
        const extractor = this.extractors.find(extractor => !(0, utils_1.isExtractorDisabled)(ctx.config, extractor) && extractor.supports(ctx, url));
        if (!extractor) {
            return [];
        }
        const normalizedUrl = extractor.normalize(url);
        const canonicalUrl = await extractor.normalizeAsync(ctx, normalizedUrl);
        const cacheKey = this.determineCacheKey(ctx, extractor, canonicalUrl);
        // Lazy-extract path: always return /extract/ URLs from cached metadata, never direct URLs.
        // viaMediaFlowProxy extractors are excluded — they must return direct MediaFlow-wrapped URLs
        // (the /extract/ endpoint doesn't apply the MediaFlow proxy), so they go through the eager path.
        if (extractor.lazyExtract && allowLazy && !extractor.viaMediaFlowProxy) {
            const lazyUrlResults = await this.lazyUrlResultCache.get(canonicalUrl.href) ?? [];
            // Pre-warm: for slow lazy extractors (e.g. GDFlix's FlareSolverr chain, ~5-15s), kick off the
            // real extraction in the background so the short-lived urlResultCache is warm by play-time.
            // CRITICAL: this must fire whenever that short-lived cache is cold — NOT only when the
            // long-lived lazy cache is empty. The lazy cache (7d) outlives the result cache
            // (extractor.ttl, e.g. GDFlix's 5m google-token TTL) by far; once the lazy cache is populated
            // the `if (lazyUrlResults.length) return` below would short-circuit every subsequent list
            // request and never re-pre-warm, so play-time (ExtractController) re-ran the full FlareSolverr
            // chain on every play after the first 5 minutes — the "takes forever to start" regression.
            if (extractor.prewarmLazy && !this.inFlight.has(cacheKey)) {
                const shortLivedRaw = await this.urlResultCache.getRaw(cacheKey);
                const shortLivedWarm = !!shortLivedRaw?.expires && shortLivedRaw.expires > Date.now();
                if (!shortLivedWarm) {
                    // Detach the prewarm from the stream request's AbortController so it survives
                    // res.send() / client disconnect. The stream controller aborts ctx.signal once the
                    // response is sent (to kill leftover source scrapes during playback); without this
                    // detach, the prewarm's fetches would be cancelled mid-chain and the cache would never
                    // warm — defeating the purpose. Per-request timeouts still bound the work.
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { signal: _drop, ...prewarmCtx } = ctx;
                    const prewarm = this.executeExtraction(prewarmCtx, extractor, normalizedUrl, canonicalUrl, cacheKey, meta, lazyUrlResults, url)
                        .finally(() => { this.inFlight.delete(cacheKey); });
                    this.inFlight.set(cacheKey, prewarm);
                    prewarm.catch(() => { });
                }
            }
            if (lazyUrlResults.length) {
                return this.buildExtractUrls(ctx, lazyUrlResults, canonicalUrl, meta);
            }
            // Cold cache — if a prewarm is in flight, wait briefly for it to complete so the stream
            // list shows real results (file sizes, server labels) instead of the bare instant proxy.
            // The wait is bounded by the REMAINING time to the stream deadline (ctx.streamDeadline): a
            // source whose scrape finished near the deadline must still return its /extract/ proxy in
            // time, otherwise it would be blocked past the deadline and dropped from the response
            // entirely (e.g. UHDMovies finishing handle() at 16s + 8s await = 24s > 18s deadline → never
            // shown). If little/no time remains, skip the wait and return the instant proxy immediately.
            const inFlightPrewarm = this.inFlight.get(cacheKey);
            if (inFlightPrewarm) {
                const remaining = ctx.streamDeadline ? ctx.streamDeadline - Date.now() : PREWARM_AWAIT_MS;
                if (remaining > PREWARM_MIN_AWAIT_MS) {
                    try {
                        const prewarmResults = await Promise.race([
                            inFlightPrewarm,
                            new Promise(resolve => setTimeout(() => resolve([]), Math.min(PREWARM_AWAIT_MS, remaining))),
                        ]);
                        const successResults = prewarmResults.filter(r => !r.error);
                        if (successResults.length > 0) {
                            return this.buildExtractUrls(ctx, successResults, canonicalUrl, meta);
                        }
                    }
                    catch { /* prewarm failure — fall through to instant proxy */ }
                }
            }
            // TRULY LAZY BOMB: Instantly return a proxy without waiting!
            // This will defer extraction entirely to the VLC/ExtractController phase.
            const instantProxy = this.buildExtractUrls(ctx, [{
                    url: canonicalUrl,
                    format: types_1.Format.unknown,
                    label: extractor.label,
                    ttl: extractor.ttl,
                    meta: meta || {},
                }], canonicalUrl, meta);
            return instantProxy;
        }
        const storedDataRaw = await this.urlResultCache.getRaw(cacheKey);
        if (storedDataRaw?.expires) {
            const remainingCacheTtl = storedDataRaw.expires - Date.now();
            // Use the minimum of the per-result TTL and the remaining cache TTL.
            return storedDataRaw.value.map(urlResult => ({
                ...urlResult,
                ttl: Math.min(urlResult.ttl, remainingCacheTtl),
                url: new URL(urlResult.url),
            }));
        }
        const lazyUrlResults = await this.lazyUrlResultCache.get(canonicalUrl.href) ?? [];
        // Only use the lazy cache for lazy extractors. Non-lazy (eager) extractors
        // resolve directly — returning stale /extract/ URLs from a previous lazy run
        // would break playback (the eager extractor's direct CDN URL is expected).
        if (lazyUrlResults.length && allowLazy && extractor.lazyExtract
            && lazyUrlResults.every(urlResult => urlResult.format !== types_1.Format.hls) // related to Android issues, e.g. https://github.com/Stremio/stremio-bugs/issues/1574 or https://github.com/Stremio/stremio-bugs/issues/1579
        ) {
            return this.buildExtractUrls(ctx, lazyUrlResults, canonicalUrl, meta);
        }
        // Reuse in-flight extraction if already running for this canonical URL
        const existing = this.inFlight.get(cacheKey);
        if (existing) {
            return existing;
        }
        const extractionPromise = this.executeExtraction(ctx, extractor, normalizedUrl, canonicalUrl, cacheKey, meta, lazyUrlResults, url);
        this.inFlight.set(cacheKey, extractionPromise);
        try {
            const urlResults = await extractionPromise;
            // Lazy-extract: transform direct URLs to /extract/ URLs even on first extraction
            if (extractor.lazyExtract && allowLazy && !extractor.viaMediaFlowProxy) {
                return this.buildExtractUrls(ctx, urlResults, canonicalUrl, meta);
            }
            return urlResults;
        }
        finally {
            this.inFlight.delete(cacheKey);
        }
    }
    ;
    async executeExtraction(ctx, extractor, normalizedUrl, canonicalUrl, cacheKey, meta, lazyUrlResults, originalUrl) {
        this.logger.info(`Extract ${originalUrl} using ${extractor.id} extractor`, ctx);
        const mergedMeta = { ...meta, ...lazyUrlResults[0]?.meta };
        const urlResults = await extractor.extract(ctx, normalizedUrl, { extractorId: extractor.id, ...mergedMeta });
        if (!Object.keys(mergedMeta).length) {
            await this.urlResultCache.delete(cacheKey);
            await this.lazyUrlResultCache.delete(canonicalUrl.href);
            return urlResults;
        }
        // Separate successful results from error results — cache only successes
        const successResults = urlResults.filter(r => !r.error);
        if (successResults.length > 0) {
            // The server-side cache TTL must respect the shortest per-result TTL
            const perResultTtl = Math.min(...successResults.map(r => r.ttl));
            const ttl = Math.min(extractor.ttl, perResultTtl);
            await this.urlResultCache.set(cacheKey, successResults, ttl);
            if (extractor.id !== 'external') {
                const lazyTtl = extractor.lazyExtract ? 604800000 : 86400000; // 7 days for lazy extractors, 24h otherwise
                await this.lazyUrlResultCache.set(canonicalUrl.href, successResults, lazyTtl);
            }
        }
        else {
            // All results are errors — don't cache, clear any stale cache
            await this.urlResultCache.delete(cacheKey);
            await this.lazyUrlResultCache.delete(canonicalUrl.href);
        }
        return urlResults;
    }
    ;
    // Build /extract/ URLs using canonical URL so hubcloud+hubdrive produce identical /extract/ links.
    // Source-provided meta (title/bytes/height/episode info) is merged ON TOP of each cached
    // extractor result so the stream card always shows file size + episode metadata — without this
    // the warm lazy-cache path returned extractor-only meta, dropping the source's episode title and
    // (for results the extractor didn't re-parse) its size. Source meta wins for display fields
    // (title/height) since it carries the episode/quality label from the listing page; the extractor's
    // bytes/extractorId/referer/requestHeaders survive for results whose source meta lacks them.
    buildExtractUrls(ctx, urlResults, canonicalUrl, initialMeta) {
        return urlResults.map((urlResult, index) => {
            const extractUrl = new URL(`/${encodeURIComponent(JSON.stringify(ctx.config))}/extract/`, ctx.hostUrl);
            extractUrl.searchParams.set('index', `${index}`);
            extractUrl.searchParams.set('url', canonicalUrl.href);
            const mergedMeta = { ...urlResult.meta, ...initialMeta };
            if (mergedMeta?.season !== undefined)
                extractUrl.searchParams.set('season', String(mergedMeta.season));
            if (mergedMeta?.episode !== undefined)
                extractUrl.searchParams.set('episode', String(mergedMeta.episode));
            return { ...urlResult, url: extractUrl, meta: mergedMeta };
        });
    }
    determineCacheKey(ctx, extractor, url) {
        let suffix = '';
        if (extractor.viaMediaFlowProxy) {
            suffix += `_${ctx.config.mediaFlowProxyUrl}`;
        }
        if (extractor.cacheVersion) {
            suffix += `_${extractor.cacheVersion}`;
        }
        return `${extractor.id}_${url}${suffix}`;
    }
}
exports.ExtractorRegistry = ExtractorRegistry;
