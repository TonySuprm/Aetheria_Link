"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VixSrc = void 0;
const error_1 = require("../error");
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
class VixSrc extends Extractor_1.Extractor {
    id = 'vixsrc';
    label = 'VixSrc';
    ttl = 21600000; // 6h
    supports(_ctx, url) {
        return null !== url.host.match(/vixsrc/);
    }
    async extractInternal(ctx, url, meta) {
        const headers = {
            'Referer': 'https://vixsrc.to/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        };
        // When MediaFlow is configured, delegate ALL fetching to MediaFlow using the VixCloud
        // extractor (identical site structure: /api/movie/{id} -> embed -> token).
        // This locks the VixSrc token to MediaFlow's IP so it can proxy successfully.
        if ((0, utils_1.supportsMediaFlowProxy)(ctx)) {
            const countryCodes = meta.countryCodes ?? [types_1.CountryCode.multi];
            /* istanbul ignore next */
            if (!(0, utils_1.hasMultiEnabled)(ctx.config) && !countryCodes.some(countryCode => countryCode in ctx.config)) {
                /* istanbul ignore next */
                return [];
            }
            const streamUrl = (0, utils_1.buildMediaFlowProxyExtractorRedirectUrl)(ctx, 'VixCloud', url, headers);
            return [
                {
                    url: streamUrl,
                    format: types_1.Format.hls,
                    notWebReady: false,
                    meta: {
                        ...meta,
                        countryCodes,
                        height: meta.height ?? 1080,
                    },
                },
            ];
        }
        // Non-MediaFlow path: local extraction for Stremio desktop
        const apiUrl = new URL(`/api${url.pathname}`, 'https://vixsrc.to');
        const apiJson = await this.fetcher.json(ctx, apiUrl, { headers });
        const embedUrl = new URL(apiJson.src, 'https://vixsrc.to');
        const html = await this.fetcher.text(ctx, embedUrl, { headers });
        const tokenMatch = html.match(/['"]token['"]:\s?['"]([^'"]*)['"]/);
        const expiresMatch = html.match(/['"]expires['"]:\s?['"]([^'"]*)['"]/);
        const urlMatch = html.match(/url:\s?['"]([^'"]*)['"]/);
        if (!tokenMatch || !expiresMatch || !urlMatch)
            throw new error_1.NotFoundError();
        const token = tokenMatch[1];
        const expires = expiresMatch[1];
        const urlValue = urlMatch[1];
        const baseUrl = new URL(urlValue);
        const playlistUrl = new URL(`${baseUrl.origin}${baseUrl.pathname}.m3u8?${baseUrl.searchParams}`);
        playlistUrl.searchParams.append('token', token);
        playlistUrl.searchParams.append('expires', expires);
        playlistUrl.searchParams.append('h', '1');
        const countryCodes = meta.countryCodes ?? [types_1.CountryCode.multi, ...(await this.determineCountryCodesFromPlaylist(ctx, playlistUrl, { headers }))];
        if (!(0, utils_1.hasMultiEnabled)(ctx.config) && !countryCodes.some(countryCode => countryCode in ctx.config)) {
            return [];
        }
        // Compute a dynamic TTL based on the expires timestamp
        const tokenTtl = Math.max(900000, Number(expires) * 1000 - Date.now() - 120000); // 2min safety buffer
        return [
            {
                url: playlistUrl,
                format: types_1.Format.hls,
                ttl: Math.min(tokenTtl, this.ttl),
                meta: {
                    ...meta,
                    countryCodes,
                    height: meta.height ?? await (0, utils_1.guessHeightFromPlaylist)(ctx, this.fetcher, playlistUrl, { headers }),
                },
            },
        ];
    }
    async determineCountryCodesFromPlaylist(ctx, playlistUrl, init) {
        const playlist = await this.fetcher.text(ctx, playlistUrl, init);
        const countryCodes = [];
        Object.keys(types_1.CountryCode).forEach((countryCode) => {
            const iso639 = (0, utils_1.iso639FromCountryCode)(countryCode);
            if (!countryCodes.includes(countryCode) && (new RegExp(`#EXT-X-MEDIA:TYPE=AUDIO.*LANGUAGE="${iso639}"`)).test(playlist)) {
                countryCodes.push(countryCode);
            }
        });
        return countryCodes;
    }
}
exports.VixSrc = VixSrc;
