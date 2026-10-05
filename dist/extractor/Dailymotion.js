"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dailymotion = exports.DAILYMOTION_METADATA_HEADERS = void 0;
exports.pickDailymotionMasterHls = pickDailymotionMasterHls;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
exports.DAILYMOTION_METADATA_HEADERS = { 'User-Agent': BROWSER_UA, 'Referer': 'https://www.dailymotion.com/' };
/**
 * Dailymotion streams are served through the MediaFlow Proxy (bundled sidecar) so the result is
 * playable by normal players (libvlc on mobile, mpv, Stremio native) WITHOUT yt-dlp or custom
 * header support.
 *
 * Why the proxy is required: Dailymotion's manifest CDN (`cdndirector.dailymotion.com`) rejects
 * non-browser TLS clients with a 403 `x-error-code: E005`, and the signed `sec=` token in the
 * manifest URL is short-lived. A canonical `.../video/{id}` page URL (the old behaviour) only
 * plays in players with yt-dlp integration, never in libvlc/ExoPlayer.
 *
 * Why resolution happens at PLAY time (not at /stream time): the `sec=` token inside the master
 * manifest URL expires within minutes, and Dailymotion rate-limits repeated fetches per video.
 * A manifest URL baked into the stream response at /stream time is usually already dead by the
 * time the player presses play ("works once, then never again"). Instead the extractor returns a
 * lightweight play-time resolver URL on this add-on (`/dm/<videoId>.m3u8`, served by
 * MediaFlowProxyController). When the player requests it, the add-on fetches a FRESH manifest
 * token from the metadata API and 302-redirects to the MediaFlow HLS proxy with that fresh
 * manifest — every play gets a brand-new token, which also keeps the per-link rate-limit budget
 * to exactly one fetch per actual playback.
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
        // No Dailymotion calls here — the manifest token would be stale by play
        // time (and every /stream poll would burn the per-link rate limit). The
        // play-time resolver route (MediaFlowProxyController /dm/:id) fetches a
        // fresh token when the player actually requests this URL.
        return [{
                url: new URL(`/dm/${encodeURIComponent(videoId)}.m3u8`, ctx.hostUrl),
                format: types_1.Format.hls,
                meta: { ...meta, extractorId: this.id },
            }];
    }
}
exports.Dailymotion = Dailymotion;
/**
 * Fetch the player metadata for `videoId` and return the best master HLS manifest URL.
 * Shared by the play-time resolver route in MediaFlowProxyController.
 *
 * Walks `metadata.qualities` (a map of quality -> [{ type, url }]). The `auto` entry is
 * Dailymotion's adaptive master playlist (it lists every quality tier), so it is preferred.
 * Note that JS objects iterate integer-like keys (e.g. "1080") BEFORE string keys (e.g. "auto"),
 * so we cannot rely on plain `Object.values` ordering to surface the master first — we check
 * `auto` explicitly and only fall back to a single-quality ladder otherwise.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickDailymotionMasterHls(metadata) {
    const qualities = (metadata?.qualities ?? {});
    // 1. Prefer the adaptive `auto` master playlist.
    const fromAuto = firstHls(qualities['auto']);
    if (fromAuto)
        return fromAuto;
    // 2. Otherwise pick the highest single-quality HLS ladder (e.g. "1440" before "720").
    let best;
    let bestRank = -1;
    for (const [quality, entries] of Object.entries(qualities)) {
        const url = firstHls(entries);
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
function firstHls(entries) {
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
