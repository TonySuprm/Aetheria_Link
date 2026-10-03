"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OkRu = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// The ok.ru CDN unlocks its manifests/segments only for requests carrying a browser UA + an
// ok.ru Referer. These headers are injected by the MediaFlow Proxy server-side (not by the
// player), which is what makes the stream playable in libvlc/mpv/Stremio-native.
const OKRU_PROXY_HEADERS = { 'User-Agent': BROWSER_UA, 'Referer': 'https://ok.ru/' };
/**
 * OK.ru streams resolve through the MediaFlow Proxy (bundled sidecar) so the result is playable
 * by normal players (libvlc on mobile, mpv, Stremio native) that cannot send the custom
 * UA/Referer headers the ok.ru CDN requires.
 *
 * The addon still resolves the actual manifest/video URL on the server (parsing the player page
 * `data-options`); instead of returning that raw CDN URL plus `requestHeaders` (which a normal
 * player ignores), we hand the resolved URL to MediaFlow's HLS / stream proxy. The proxy re-fetches
 * the manifest + segments with the ok.ru-expected headers and rewrites all URLs, so the player
 * only ever sees plain, header-free URLs.
 */
class OkRu extends Extractor_1.Extractor {
    id = 'okru';
    label = 'OK.ru';
    viaMediaFlowProxy = true;
    supports(ctx, url) {
        const hostMatches = url.host === 'ok.ru' || url.host === 'www.ok.ru';
        return hostMatches && (0, utils_1.supportsMediaFlowProxy)(ctx);
    }
    async extractInternal(ctx, url, meta) {
        try {
            const html = await this.fetcher.text(ctx, url);
            const dataOptsMatch = html.match(/data-options="([^"]+)"/);
            if (dataOptsMatch) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const opts = JSON.parse((dataOptsMatch[1] || '')
                    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
                    .replace(/&#39;/g, '\'').replace(/&amp;/g, '&'));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let videoMeta = opts?.flashvars?.metadata || opts?.metadata;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const flashvars = opts?.flashvars || opts;
                if (typeof videoMeta === 'string') {
                    try {
                        videoMeta = JSON.parse(videoMeta);
                    }
                    catch {
                        /* keep raw */
                    }
                }
                // Prefer the adaptive HLS ladder (master playlist first); the MFP HLS proxy
                // carries the headers ok.ru needs and rewrites the segment URLs.
                const hlsUrl = flashvars?.hlsMasterPlaylistUrl || flashvars?.hlsManifestUrl
                    || videoMeta?.hlsMasterPlaylistUrl || videoMeta?.hlsManifestUrl
                    || videoMeta?.ondemandHls;
                if (typeof hlsUrl === 'string' && hlsUrl) {
                    return [{
                            url: (0, utils_1.buildMediaFlowProxyHlsUrl)(ctx, new URL(hlsUrl), OKRU_PROXY_HEADERS),
                            format: types_1.Format.hls,
                            meta: { ...meta, extractorId: this.id },
                        }];
                }
                // Fall back to the best direct file via the MFP stream proxy (headers injected).
                const OKRU_QUALITY_RANK = { ultra: 8, quad: 7, full: 6, hd: 5, sd: 4, low: 3, lowest: 2, mobile: 1 };
                const videos = videoMeta?.videos || flashvars?.videos || [];
                if (videos.length > 0) {
                    const best = videos.sort((a, b) => (OKRU_QUALITY_RANK[b.name] || 0) - (OKRU_QUALITY_RANK[a.name] || 0))[0];
                    if (best?.url) {
                        return [{
                                url: (0, utils_1.buildMediaFlowProxyStreamUrl)(ctx, new URL(best.url), OKRU_PROXY_HEADERS),
                                format: types_1.Format.mp4,
                                meta: { ...meta, extractorId: this.id },
                            }];
                    }
                }
            }
        }
        catch (e) {
            this.logger.warn(`OkRu MFP extraction failed: ${e}`);
        }
        return [];
    }
}
exports.OkRu = OkRu;
