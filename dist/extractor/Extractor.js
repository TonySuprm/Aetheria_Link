"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Extractor = void 0;
const error_1 = require("../error");
const types_1 = require("../types");
class Extractor {
    ttl = 900000; // 15m
    cacheVersion = undefined;
    lazyExtract = false;
    // When true (and lazyExtract is true), the registry fires the real extraction in the background
    // at stream-list time (fire-and-forget) so the urlResultCache is warm by the time the user hits
    // play. Intended for lazy extractors whose chain is slow (e.g. GDFlix's FlareSolverr CF-bypass)
    // — without it, the first play blocks for the full chain duration. The play-time ExtractController
    // either finds the warm cache (instant) or awaits the shared in-flight pre-warm (no duplicate work).
    prewarmLazy = false;
    viaMediaFlowProxy = false;
    fetcher;
    logger;
    constructor(fetcher, logger) {
        this.fetcher = fetcher;
        this.logger = logger;
    }
    normalize(url) {
        return url;
    }
    ;
    // Async normalization for cache key only; original URL still passed to extractInternal()
    async normalizeAsync(_ctx, url) {
        return url;
    }
    async extract(ctx, url, meta) {
        try {
            return (await this.extractInternal(ctx, url, meta)).map(urlResult => ({
                ...urlResult,
                label: this.formatLabel(urlResult.label ?? this.label),
                ttl: urlResult.ttl ?? this.ttl,
            }));
        }
        catch (error) {
            if (error instanceof error_1.NotFoundError) {
                return [];
            }
            return [
                {
                    url,
                    format: types_1.Format.unknown,
                    isExternal: true,
                    error,
                    label: this.formatLabel(this.label),
                    ttl: 0,
                    meta,
                },
            ];
        }
    }
    ;
    formatLabel(label) {
        return this.viaMediaFlowProxy ? `${label} (MFP)` : label;
    }
}
exports.Extractor = Extractor;
