"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dailymotion = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const METADATA_HEADERS = { 'User-Agent': BROWSER_UA, 'Referer': 'https://www.dailymotion.com/' };
/**
 * Dailymotion streams resolve through the MediaFlow Proxy (bundled sidecar) so the result is
 * playable by normal players (libvlc on mobile, mpv, Stremio native) WITHOUT yt-dlp or custom
 * header support.
 *
 * Why the proxy is required: Dailymotion's manifest CDN (`cdndirector.dailymotion.com`) rejects
 * non-browser TLS clients with a 403 `x-error-code: E005`, and the signed `sec=` token in the
 * manifest URL is short-lived. A canonical `.../video/{id}` page URL (the old behaviour) only
 * plays in players with yt-dlp integration, never in libvlc/ExoPlayer. Here the addon resolves
 * the master `.m3u8` server-side (a real client that the CDN accepts) and hands that absolute
 * manifest to MediaFlow's HLS proxy, which re-fetches the manifest + every segment with a browser
 * UA/Referer and rewrites all segment URLs to its own tokenised endpoints. The player then just
 * follows a plain, header-free HLS ladder.
 */
class Dailymotion extends Extractor_1.Extractor {
    id = 'dailymotion';
    label = 'Dailymotion';
    viaMediaFlowProxy = true;
    supports(ctx, url) {
        const hostMatches = url.host === 'dailymotion.com' || url.host.endsWith('.dailymotion.com');
        return hostMatches && (0, utils_1.supportsMediaFlowProxy)(ctx);
    }
    async extractInternal(ctx, url, meta) {
        // Two embed URL formats:
        // 1. https://www.dailymotion.com/video/{id}                 (pathname)
        // 2. https://geo.dailymotion.com/player/x....html?video={id} (query param)
        let videoId = url.pathname.match(/\/video\/([a-zA-Z0-9_-]+)/)?.[1];
        if (!videoId) {
            videoId = url.searchParams.get('video') || undefined;
        }
        if (!videoId) {
            return [];
        }
        try {
            const metadataUrl = new URL(`https://www.dailymotion.com/player/metadata/video/${videoId}`);
            const metadata = await this.fetcher.json(ctx, metadataUrl, { headers: METADATA_HEADERS });
            const master = this.findMasterHls(metadata);
            if (!master) {
                return [];
            }
            const proxyUrl = (0, utils_1.buildMediaFlowProxyHlsUrl)(ctx, master, METADATA_HEADERS);
            return [{
                    url: proxyUrl,
                    format: types_1.Format.hls,
                    meta: { ...meta, extractorId: this.id },
                }];
        }
        catch (e) {
            // Deleted / geo-blocked / transient API failure — surface no stream rather than a
            // broken error card.
            this.logger.warn(`Dailymotion MFP extraction failed for ${videoId}: ${e}`);
            return [];
        }
    }
    // Walks `metadata.qualities` (a map of quality -> [{ type, url }]) and returns the best HLS
    // master manifest (`application/x-mpegURL`).
    //
    // The `auto` entry is Dailymotion's adaptive master playlist (it lists every quality tier), so
    // it is preferred. Note that JS objects iterate integer-like keys (e.g. "1080") BEFORE string
    // keys (e.g. "auto"), so we cannot rely on plain `Object.values` ordering to surface the master
    // first — we check `auto` explicitly and only fall back to a single-quality ladder otherwise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMasterHls(metadata) {
        const qualities = (metadata?.qualities ?? {});
        // 1. Prefer the adaptive `auto` master playlist.
        const fromAuto = this.firstHls(qualities['auto']);
        if (fromAuto)
            return fromAuto;
        // 2. Otherwise pick the highest single-quality HLS ladder (e.g. "1440" before "720").
        let best;
        let bestRank = -1;
        for (const [quality, entries] of Object.entries(qualities)) {
            const url = this.firstHls(entries);
            if (!url)
                continue;
            const rank = Number.parseInt(quality, 10);
            const value = Number.isNaN(rank) ? 0 : rank; // "auto"/labeled tiers sort as 0
            if (value > bestRank) {
                bestRank = value;
                best = url;
            }
        }
        return best;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    firstHls(entries) {
        if (!Array.isArray(entries))
            return undefined;
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object')
                continue;
            const candidate = entry;
            if (candidate.type === 'application/x-mpegURL' && typeof candidate.url === 'string') {
                try {
                    return new URL(candidate.url);
                }
                catch {
                    // not an absolute URL — skip
                }
            }
        }
        return undefined;
    }
}
exports.Dailymotion = Dailymotion;
