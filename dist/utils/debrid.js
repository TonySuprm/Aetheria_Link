"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeDebridMeta = exports.unrestrictRealDebrid = exports.unrestrictAllDebrid = exports.normalizeFilename = exports.pickBestHoster = exports.hosterPriority = exports.isRealDebridHoster = exports.isAllDebridHoster = exports.isDebridHoster = exports.DEBRID_SUPPORTED_HOSTERS = exports.REALDEBRID_SUPPORTED_HOSTERS = exports.ALLDEBRID_SUPPORTED_HOSTERS = void 0;
/**
 * Domains supported by the AllDebrid v4 "link/unlock" endpoint. This is built
 * from AllDebrid's own /v4/hosts list (status=true entries). The extractor uses
 * this list in supports() so AllDebrid never tries to unrestrict a hoster it
 * does not support (e.g. nitroflare.com), which previously produced noisy
 * "LINK_HOST_NOT_SUPPORTED" error streams.
 */
exports.ALLDEBRID_SUPPORTED_HOSTERS = [
    '1fichier.com',
    '4s.io',
    '4shared.com',
    '9xupload.asia',
    '9xupload.info',
    'alterupload.com',
    'cjoint.net',
    'clipwatching.com',
    'dailyuploads.net',
    'desfichiers.com',
    'dfichiers.com',
    'dl4free.com',
    'drive.google.com',
    'exload.com',
    'fastbit.cc',
    'file.al',
    'filerio.in',
    'filespace.com',
    'filezip.cc',
    'gigapeta.com',
    'hexload.com',
    'hexupload.net',
    'highstream.tv',
    'hitf.cc',
    'hitf.to',
    'hitfile.com',
    'hitfile.net',
    'hot4share.com',
    'htfl.cc',
    'htfl.net',
    'htfl.to',
    'isra.cloud',
    'katfile.cloud',
    'katfile.com',
    'katfile.online',
    'katfile.vip',
    'mediafire.com',
    'mega.co.nz',
    'mega.nz',
    'megadl.fr',
    'mesfichiers.org',
    'mixdrop.co',
    'mixdrop.sx',
    'mixdrop.to',
    'piecejointe.net',
    'pjointe.com',
    'playvidto.com',
    'rapidgator.asia',
    'rapidgator.net',
    'rg.to',
    'simfileshare.net',
    'streamtape.com',
    'tenvoi.com',
    'thevideo.me',
    'torbobit.net',
    'tourbobit.net',
    'trbbt.net',
    'trbt.cc',
    'turb.cc',
    'turb.pw',
    'turbo.to',
    'turbobif.cc',
    'turbobif.com',
    'turbobif.net',
    'turbobit.cc',
    'turbobit.cloud',
    'turbobit.net',
    'upl.wf',
    'uploadbank.com',
    'uploadbox.io',
    'uploader.link',
    'uploadhaven.com',
    'uploadrar.com',
    'usersdrive.com',
    'vev.io',
    'vidto-do.com',
    'vidtodo.com',
    'wayupload.com',
    'widtodo.com',
    'world-files.com',
];
/**
 * Domains supported by the RealDebrid /unrestrict/link endpoint, from
 * api.real-debrid.com/rest/1.0/hosts. RealDebrid has a broader set than
 * AllDebrid, including nitroflare.com, rapidrar.com and clicknupload.me.
 */
exports.REALDEBRID_SUPPORTED_HOSTERS = [
    '1fichier.com',
    '2shared.com',
    '4shared.com',
    'alfafile.net',
    'anzfile.net',
    'backin.net',
    'bayfiles.com',
    'bdupload.in',
    'brupload.net',
    'btafile.com',
    'catshare.net',
    'clicknupload.me',
    'clipwatching.com',
    'cosmobox.org',
    'dailymotion.com',
    'dailyuploads.net',
    'daofile.com',
    'ddownload.com',
    'depositfiles.com',
    'dl.free.fr',
    'docs.google.com',
    'douploads.net',
    'down.fast-down.com',
    'down.mdiaload.com',
    'drop.download',
    'dropbox.com',
    'earn4files.com',
    'easybytez.com',
    'ex-load.com',
    'extmatrix.com',
    'fastclick.to',
    'faststore.org',
    'fboom.me',
    'fikper.com',
    'file-up.org',
    'file.al',
    'file4safe.com',
    'filefactory.com',
    'filefox.cc',
    'filenext.com',
    'filer.net',
    'filerio.in',
    'filesabc.com',
    'filespace.com',
    'filestore.me',
    'fileupload.pw',
    'filextras.com',
    'filezip.cc',
    'fireget.com',
    'flashbit.cc',
    'flashx.tv',
    'florenfile.com',
    'fshare.vn',
    'gigapeta.com',
    'goloady.com',
    'gounlimited.to',
    'heroupload.com',
    'hexupload.net',
    'hitfile.net',
    'hotlink.cc',
    'hulkshare.com',
    'icerbox.com',
    'icloud.com',
    'inclouddrive.com',
    'isra.cloud',
    'katfile.com',
    'keep2share.cc',
    'letsupload.cc',
    'load.to',
    'mediafire.com',
    'mega.co.nz',
    'mixdrop.co',
    'mixloads.com',
    'mp4upload.com',
    'nelion.me',
    'ninjastream.to',
    'nitroflare.com',
    'nowvideo.club',
    'oboom.com',
    'prefiles.com',
    'rapidgator.net',
    'rapidrar.com',
    'rapidu.net',
    'rarefile.net',
    'real-debrid.com',
    'redbunker.net',
    'redtube.com',
    'rockfile.eu',
    'rutube.ru',
    'scribd.com',
    'send.cm',
    'sendit.cloud',
    'sendspace.com',
    'simfileshare.net',
    'sky.fm',
    'solidfiles.com',
    'soundcloud.com',
    'speed-down.org',
    'streamon.to',
    'streamtape.com',
    'takefile.link',
    'terabytez.org',
    'tezfiles.com',
    'thevideo.me',
    'turbobit.net',
    'tusfiles.com',
    'ubiqfile.com',
    'uloz.to',
    'unibytes.com',
    'uploadbox.io',
    'uploadboy.com',
    'uploadc.com',
    'uploadev.org',
    'uploadgig.com',
    'uploadrar.com',
    'uploady.io',
    'uppit.com',
    'upstore.net',
    'upstream.to',
    'uptobox.com',
    'userscloud.com',
    'usersdrive.com',
    'vidcloud.ru',
    'videobin.co',
    'vidlox.tv',
    'vidoza.net',
    'vimeo.com',
    'vivo.sx',
    'vk.com',
    'voe.sx',
    'wdupload.com',
    'wipfiles.net',
    'world-files.com',
    'worldbytez.com',
    'wupfile.com',
    'wushare.com',
    'xubster.com',
    'youporn.com',
    'youtube.com',
    'zippyshare.com',
];
/**
 * Union of AllDebrid and RealDebrid supported hosts, plus common mirror
 * domains that DDL sites use ( RapidRAR/ClicknUpload aliases). Used by
 * debrid-source scrapers (DDLValley, RapidMoviez, etc.) to decide whether a
 * hoster URL is worth collecting; the actual extractor uses its service-specific
 * list in supports() to avoid sending unsupported hosts to AllDebrid.
 */
exports.DEBRID_SUPPORTED_HOSTERS = Array.from(new Set([
    ...exports.ALLDEBRID_SUPPORTED_HOSTERS,
    ...exports.REALDEBRID_SUPPORTED_HOSTERS,
    // RapidRAR/ClicknUpload mirror tlds encountered on RapidMoviez, normalised
    // to the canonical RealDebrid domains inside the source before debrid lookup.
    'rapidrar.cr',
    'rapidrar.cloud',
    'rapidrar.online',
    'rapidrar.space',
    'rapidrar.site',
    'clicknupload.click',
    'clicknupload.cc',
    'clicknupload.com',
    'clicknupload.link',
    'clicknupload.org',
]));
const hostMatches = (list, host) => list.some(h => host === h || host.endsWith('.' + h));
/** Returns true if `host` matches any known debrid-supported file hoster. */
const isDebridHoster = (host) => hostMatches(exports.DEBRID_SUPPORTED_HOSTERS, host);
exports.isDebridHoster = isDebridHoster;
/** Returns true if `host` is supported by AllDebrid's link/unlock endpoint. */
const isAllDebridHoster = (host) => hostMatches(exports.ALLDEBRID_SUPPORTED_HOSTERS, host);
exports.isAllDebridHoster = isAllDebridHoster;
/** Returns true if `host` is supported by RealDebrid's unrestrict/link endpoint. */
const isRealDebridHoster = (host) => hostMatches(exports.REALDEBRID_SUPPORTED_HOSTERS, host);
exports.isRealDebridHoster = isRealDebridHoster;
/** Lower number = preferred (faster/more reliable for debrid unrestrict).
 *  NitroFlare resolves fastest via AllDebrid/RealDebrid, then RapidGator,
 *  then RapidRAR, etc. Used to pick ONE hoster per file so the same release
 *  doesn't appear twice (once on NitroFlare, once on RapidGator). */
const hosterPriority = (host) => {
    if (host.includes('nitroflare'))
        return 1;
    if (host.includes('rapidgator') || host === 'rg.to')
        return 2;
    if (host.includes('rapidrar'))
        return 3;
    if (host.includes('ddownload'))
        return 4;
    if (host.includes('clicknupload'))
        return 5;
    if (host.includes('k2s') || host.includes('keep2share'))
        return 6;
    if (host.includes('uploaded') || host === 'ul.to')
        return 7;
    if (host.includes('turbobit'))
        return 8;
    return 99;
};
exports.hosterPriority = hosterPriority;
/** Pick the best (lowest priority number) hoster URL from a list. */
const pickBestHoster = (urls) => [...urls].sort((a, b) => (0, exports.hosterPriority)(a.host) - (0, exports.hosterPriority)(b.host))[0];
exports.pickBestHoster = pickBestHoster;
/** Extract a normalized filename key from a hoster URL for cross-source dedup.
 *  Strips source-specific watermarks (DDLValley prefix, RapidMoviez suffix)
 *  and lowercases so the same file from different DDL sites matches. */
const normalizeFilename = (url) => {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0)
        return '';
    let filename = segments[segments.length - 1] ?? '';
    try {
        filename = decodeURIComponent(filename);
    }
    catch { /* keep raw */ }
    filename = filename
        .replace(/\.html$/i, '')
        .replace(/^ddlvalley\.me_\d+_/i, '')
        .replace(/\.www\.\w+\.com$/i, '')
        .replace(/\.\w{2,4}$/i, '');
    const lowerFilename = filename.toLowerCase();
    const genericNames = ['playlist', 'index', 'master', 'manifest', 'video', 'stream', 'chunklist'];
    if (genericNames.includes(lowerFilename)) {
        return ''; // Do not dedup by generic streaming manifests/filenames
    }
    return lowerFilename;
};
exports.normalizeFilename = normalizeFilename;
/**
 * AllDebrid v4 API — unrestrict a file-hoster link into a premium direct-download URL.
 * GET https://api.alldebrid.com/v4/link/unlock?apikey=<key>&link=<url>&agent=<agent>
 */
const unrestrictAllDebrid = async (ctx, fetcher, apiKey, link) => {
    const apiUrl = new URL('https://api.alldebrid.com/v4/link/unlock');
    apiUrl.searchParams.set('apikey', apiKey);
    apiUrl.searchParams.set('link', link.href);
    apiUrl.searchParams.set('agent', 'aetheria-link');
    const data = await fetcher.json(ctx, apiUrl, { timeout: 15000 });
    if (data.status !== 'success' || !data.data?.link) {
        throw new Error(`AllDebrid error: ${data.error?.code ?? 'unknown'} — ${data.error?.message ?? JSON.stringify(data)}`);
    }
    return {
        url: new URL(data.data.link),
        filename: data.data.filename ?? '',
        filesize: typeof data.data.filesize === 'number' && data.data.filesize > 0 ? data.data.filesize : undefined,
    };
};
exports.unrestrictAllDebrid = unrestrictAllDebrid;
/**
 * RealDebrid API — unrestrict a file-hoster link into a premium direct-download URL.
 * POST https://api.real-debrid.com/rest/1.0/unrestrict/link  body: link=<url>
 * Header: Authorization: Bearer <apiToken>
 */
const unrestrictRealDebrid = async (ctx, fetcher, apiToken, link) => {
    const apiUrl = new URL('https://api.real-debrid.com/rest/1.0/unrestrict/link');
    const body = `link=${encodeURIComponent(link.href)}`;
    const raw = await fetcher.textPost(ctx, apiUrl, body, {
        timeout: 15000,
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    });
    const data = JSON.parse(raw);
    if (!data.download) {
        throw new Error(`RealDebrid error: ${data.error_code ?? 'unknown'} — ${data.error ?? raw}`);
    }
    return {
        url: new URL(data.download),
        filename: data.filename ?? '',
        filesize: typeof data.filesize === 'number' && data.filesize > 0 ? data.filesize : undefined,
    };
};
exports.unrestrictRealDebrid = unrestrictRealDebrid;
/** Merge debrid-resolved metadata into the source-provided meta. */
const mergeDebridMeta = (meta, result) => ({
    ...meta,
    ...(result.filesize && !meta.bytes && { bytes: result.filesize }),
});
exports.mergeDebridMeta = mergeDebridMeta;
