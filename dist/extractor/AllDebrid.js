"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllDebrid = void 0;
const error_1 = require("../error");
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
/**
 * AllDebrid extractor — resolves NitroFlare / Rapidgator / RapidRAR / ClicknUpload
 * (and any other debrid-supported hoster) URLs into premium direct-download links
 * via the AllDebrid v4 API. Only matches when an AllDebrid API key is configured
 * in the user's add-on config (`alldebridApiKey`).
 *
 * Eager: the debrid API is called at stream-list time so Stremio receives direct,
 * short CDN URLs (e.g. `https://alldebrid.com/dl/.../<filename>.mkv`) instead of
 * long `/extract/` proxy URLs. The resolved CDN URL is cached (10m TTL) so repeated
 * requests don't re-hit the API.
 */
class AllDebrid extends Extractor_1.Extractor {
    id = 'alldebrid';
    label = 'AllDebrid';
    ttl = 600000; // 10m — debrid links stay valid but refresh reasonably
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(ctx, url) {
        if (!ctx.config.alldebridApiKey)
            return false;
        return (0, utils_1.isAllDebridHoster)(url.host);
    }
    normalize(url) {
        // Some DDL sites append `.html` to the file ID (e.g. usersdrive.com/abc123.html).
        // AllDebrid's host regex and the hoster's own canonical page expect the bare ID,
        // so strip the extension before unrestricting.
        if (/\.html?$/i.test(url.pathname)) {
            const normalized = new URL(url.href);
            normalized.pathname = url.pathname.replace(/\.html?$/i, '');
            return normalized;
        }
        return url;
    }
    async extractInternal(ctx, url, meta) {
        const apiKey = ctx.config.alldebridApiKey;
        if (!apiKey)
            return [];
        this.logger.info(`AllDebrid: unrestricting ${url.host} link`, ctx);
        let result;
        try {
            result = await (0, utils_1.unrestrictAllDebrid)(ctx, this.fetcher, apiKey, url);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Dead hoster links or unsupported hosts should silently drop the result instead
            // of emitting a broken error stream.
            if (/LINK_DOWN|LINK_HOST_NOT_SUPPORTED|LINK_PASSWORD_REQUIRED|LINK_NEED_WAIT/i.test(message)) {
                throw new error_1.NotFoundError(message);
            }
            throw error;
        }
        const mergedMeta = (0, utils_1.mergeDebridMeta)(meta, result);
        return [
            {
                url: result.url,
                format: types_1.Format.unknown,
                isExternal: false,
                notWebReady: true,
                label: this.label,
                meta: mergedMeta,
            },
        ];
    }
}
exports.AllDebrid = AllDebrid;
