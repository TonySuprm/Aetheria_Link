"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Source = void 0;
const axios_1 = require("axios");
const cacheable_1 = require("cacheable");
const error_1 = require("../error");
const types_1 = require("../types");
const utils_1 = require("../utils");
const sourceResultCache = new cacheable_1.Cacheable({
    nonBlocking: true,
    primary: new cacheable_1.Keyv({ store: new cacheable_1.CacheableMemory({ lruSize: 1024 }) }),
    secondary: (0, utils_1.createKeyvSqlite)('source-cache-v3'),
    stats: true,
});
const DOMAINS_JSON_URL = 'https://raw.githubusercontent.com/Anshu78780/json/main/providers.json';
const DOMAINS_JSON_TTL = 4 * 60 * 60 * 1000; // 4 hours
const isAborted = (ctx, error) => ctx.signal?.aborted === true
    || (error instanceof axios_1.AxiosError && (error.code === 'ERR_CANCELED' || error.name === 'CanceledError'));
class Source {
    ttl = 3600000; // 1h — short enough that scraper/extractor fixes propagate quickly, long enough to avoid re-scraping on rapid navigations
    useOnlyWithMaxUrlsFound = undefined; // fallback sources are only considered if we don't have enough URLs from others already
    priority = 0;
    category = 'hollywood';
    domainKey = '';
    /** Pre-warm connections / Cloudflare clearance at startup. Default no-op; override in subclasses. */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async prewarm(_ctx) { }
    static baseUrlCache = new Map();
    static BASE_URL_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
    static deadDomains = new Map();
    static DEAD_DOMAIN_TTL = 24 * 60 * 60 * 1000; // 24 hours
    static domainsJsonCache = null;
    static domainsJsonTs = 0;
    static firstFailureAt = new Map();
    static FAILURE_EVICTION_WINDOW = 5 * 60 * 1000; // 5 min
    static evictionCallbacks = new Map();
    static recordFailure(domainKey) {
        if (!domainKey)
            return;
        const now = Date.now();
        const first = Source.firstFailureAt.get(domainKey);
        if (!first) {
            Source.firstFailureAt.set(domainKey, now);
            return;
        }
        if (now - first >= Source.FAILURE_EVICTION_WINDOW) {
            Source.baseUrlCache.delete(domainKey);
            Source.firstFailureAt.delete(domainKey);
            const evictedHost = Source.evictionCallbacks.get(domainKey)?.();
            if (evictedHost)
                Source.deadDomains.set(evictedHost, Date.now());
        }
    }
    static isFailing(domainKey) {
        return Source.firstFailureAt.has(domainKey);
    }
    static recordSuccess(domainKey) {
        if (!domainKey)
            return;
        Source.firstFailureAt.delete(domainKey);
    }
    static async resetCache() {
        await sourceResultCache.clear();
        Source.baseUrlCache.clear();
        Source.deadDomains.clear();
        Source.firstFailureAt.clear();
        Source.domainsJsonCache = null;
        Source.domainsJsonTs = 0;
    }
    static stats() {
        return {
            sourceResultCache: sourceResultCache.stats,
            baseUrlCache: Object.fromEntries(Source.baseUrlCache),
            deadDomains: Object.fromEntries(Source.deadDomains),
            domainsJsonAge: Source.domainsJsonTs ? Date.now() - Source.domainsJsonTs : null,
        };
    }
    ;
    async handle(ctx, type, id) {
        const cacheKey = `${this.id}_${id.toString()}`;
        let sourceResults = (await sourceResultCache.get(cacheKey))
            ?.map(sourceResult => ({ ...sourceResult, url: new URL(sourceResult.url) }));
        if (!sourceResults) {
            try {
                sourceResults = await this.handleInternal(ctx, type, id);
                Source.recordSuccess(this.domainKey);
            }
            catch (error) {
                if (isAborted(ctx, error)) {
                    // Stream request already responded (deadline reached) and was aborted to stop
                    // background scraping during playback. Don't cache the partial result and don't
                    // mark the domain as failing — the abort is not a real failure.
                    return [];
                }
                if (error instanceof error_1.NotFoundError) {
                    sourceResults = [];
                }
                else {
                    Source.recordFailure(this.domainKey);
                    throw error;
                }
            }
            // Only persist to cache when we actually found streams.
            // Empty results mean the scrape failed or the episode isn't available yet —
            // caching [] for a full hour would prevent any retry and cause the user to
            // see "no results" even after the site publishes the episode.
            if (sourceResults.length > 0) {
                await sourceResultCache.set(cacheKey, sourceResults, this.ttl);
            }
        }
        if (this.countryCodes.includes(types_1.CountryCode.multi)) {
            return sourceResults;
        }
        return sourceResults.filter(sourceResult => sourceResult.meta.countryCodes?.some(countryCode => countryCode in ctx.config));
    }
    async probeBaseUrl(ctx, fetcher, domainKey, fallbackCandidates) {
        const envOverride = process.env[`${domainKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`];
        if (envOverride) {
            return new URL(envOverride);
        }
        const cached = Source.baseUrlCache.get(domainKey);
        if (cached && Date.now() - cached.ts < Source.BASE_URL_CACHE_TTL) {
            return new URL(cached.url);
        }
        const domainFromJson = await this.fetchDomainFromJson(domainKey, fetcher, ctx);
        if (domainFromJson) {
            const jsonHostname = (() => {
                try {
                    return new URL(domainFromJson).hostname;
                }
                catch {
                    return '';
                }
            })();
            const diedAt = jsonHostname ? Source.deadDomains.get(jsonHostname) : undefined;
            const isKnownDead = diedAt && Date.now() - diedAt < Source.DEAD_DOMAIN_TTL;
            if (!isKnownDead && await this.isDomainAlive(ctx, fetcher, domainFromJson)) {
                Source.baseUrlCache.set(domainKey, { url: domainFromJson, ts: Date.now() });
                /* istanbul ignore next -- jsonHostname can only be empty when domainFromJson is invalid, but isDomainAlive would throw first */
                if (jsonHostname)
                    Source.deadDomains.delete(jsonHostname);
                return new URL(domainFromJson);
            }
            if (!isKnownDead && jsonHostname) {
                Source.deadDomains.set(jsonHostname, Date.now());
            }
        }
        return this.raceCandidates(ctx, fetcher, fallbackCandidates, domainKey);
    }
    async fetchDomainFromJson(domainKey, fetcher, ctx) {
        const extractUrl = (entry) => {
            if (typeof entry === 'string')
                return entry;
            if (entry && typeof entry === 'object' && 'url' in entry)
                return entry.url;
            return null;
        };
        if (Source.domainsJsonCache && Date.now() - Source.domainsJsonTs < DOMAINS_JSON_TTL) {
            return extractUrl(Source.domainsJsonCache[domainKey]);
        }
        try {
            const json = await fetcher.json(ctx, new URL(DOMAINS_JSON_URL));
            Source.domainsJsonCache = json;
            Source.domainsJsonTs = Date.now();
            return extractUrl(json[domainKey]);
        }
        catch {
            if (Source.domainsJsonCache) {
                return extractUrl(Source.domainsJsonCache[domainKey]);
            }
            return null;
        }
    }
    async raceCandidates(ctx, fetcher, candidates, domainKey) {
        const now = Date.now();
        const aliveCandidates = candidates.filter((c) => {
            /* istanbul ignore next -- candidates are valid URLs, URL constructor cannot throw */
            try {
                const hostname = new URL(c).hostname;
                const diedAt = Source.deadDomains.get(hostname);
                if (diedAt && now - diedAt < Source.DEAD_DOMAIN_TTL)
                    return false;
                if (diedAt)
                    Source.deadDomains.delete(hostname); // expired — re-try
                return true;
            }
            catch {
                return false;
            }
        });
        const tryList = aliveCandidates.length > 0 ? aliveCandidates : candidates;
        try {
            const winner = await Promise.any(tryList.map(async (candidate) => {
                if (await this.isDomainAlive(ctx, fetcher, candidate))
                    return candidate;
                throw new Error('domain unreachable');
            }));
            const url = new URL(winner);
            Source.baseUrlCache.set(domainKey, { url: url.href, ts: Date.now() });
            Source.deadDomains.delete(url.hostname);
            return url;
        }
        catch {
            for (const c of tryList) {
                /* istanbul ignore next -- candidates are valid URLs, URL constructor cannot throw */
                try {
                    Source.deadDomains.set(new URL(c).hostname, Date.now());
                    // eslint-disable-next-line no-empty
                }
                catch {
                }
            }
            throw new error_1.NotFoundError();
        }
    }
    async isDomainAlive(ctx, fetcher, candidate) {
        try {
            await fetcher.head(ctx, new URL(candidate), { timeout: 4000 });
            return true; // Got headers — domain is definitely alive
        }
        catch (error) {
            if (error instanceof error_1.BlockedError)
                return true;
            if (error instanceof error_1.NotFoundError)
                return true;
            if (error instanceof error_1.HttpError)
                return true;
            if (error instanceof error_1.TooManyRequestsError)
                return true;
            if (error instanceof error_1.TooManyTimeoutsError)
                return true;
            return false;
        }
    }
}
exports.Source = Source;
