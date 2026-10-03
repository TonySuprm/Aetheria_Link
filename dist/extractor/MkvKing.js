"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MkvKing = void 0;
const error_1 = require("../error");
const types_1 = require("../types");
const Extractor_1 = require("./Extractor");
const REFERER = 'https://pro.iqsmartgames.com/';
const FILEURL_RE = /const\s+fileurl\s*=\s*"([^"]+)";/;
class MkvKing extends Extractor_1.Extractor {
    id = 'mkvking';
    label = 'MkvKing';
    lazyExtract = true;
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return url.hostname === 'ddn.iqsmartgames.com' && url.pathname.startsWith('/file/');
    }
    async extractInternal(ctx, url, meta) {
        const response = await this.fetcher.fetch(ctx, url, {
            headers: { Referer: REFERER },
            timeout: 12000,
        });
        const html = typeof response.data === 'string' ? response.data : '';
        const match = html.match(FILEURL_RE);
        if (!match?.[1]) {
            throw new error_1.NotFoundError();
        }
        const rawFileUrl = match[1].replace(/\\\//g, '/');
        const directUrl = new URL(rawFileUrl);
        const cookie = this.extractCookie(response.headers['set-cookie']);
        const result = {
            url: directUrl,
            format: types_1.Format.mp4,
            meta,
        };
        if (cookie) {
            result.requestHeaders = { Cookie: cookie };
        }
        return [result];
    }
    extractCookie(setCookies) {
        if (!setCookies)
            return undefined;
        const cookies = setCookies
            .map(c => c.split(';')[0])
            .filter(Boolean);
        return cookies.length > 0 ? cookies.join('; ') : undefined;
    }
}
exports.MkvKing = MkvKing;
