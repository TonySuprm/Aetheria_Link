"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DramaSuki = void 0;
exports.parseSnapDirs = parseSnapDirs;
exports.findTitleSegment = findTitleSegment;
exports.buildDownloadUrl = buildDownloadUrl;
exports.guessHeightFromName = guessHeightFromName;
exports.isTitleMatch = isTitleMatch;
exports.isYearMatch = isYearMatch;
exports.levenshtein = levenshtein;
const async_mutex_1 = require("async-mutex");
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
/**
 * dramasuki.xyz source.
 *
 * The site is a single ~8 MB Snap2HTML static page that embeds the entire archive (8,000+ Asian
 * drama/movie folders) as a `dirs[]` JavaScript array. There is no search API — the page IS the
 * index, so we fetch it once (cached 6h) and search it in-memory.
 *
 *   Entry format (each element of `dirs`):
 *     [ "dirPath*0*modifiedUnixDate",
 *       "<file>.mkv*<bytes>*<date>", ... (one per file in the folder),
 *       <totalBytes>,            // number — total size of the folder content
 *       "<subDirIds>*..." ]      // string of '*'-joined indexes into dirs[] (sub-folders)
 *
 * Files live on a separate goindex (Google Drive) host. The download URL strips the root folder
 * name ("DramaSuki") from the directory path and serves the file directly with HTTP range support:
 *
 *   https://dl.dramasuki.xyz/0:/<path-after-DramaSuki/>/<file>.mkv  → 200, video/x-matroska, 206 on Range
 *
 * Verified working for movies and multi-season series. The only failure mode is Google Drive's
 * per-file download quota (403 "quota exceeded"), which is transient and per-file — surfacing every
 * available release for the title gives the user alternates.
 */
const INDEX_URL = 'https://dramasuki.xyz/';
const DOWNLOAD_BASE = 'https://dl.dramasuki.xyz/0:/';
const SOURCE_ROOT = 'DramaSuki'; // root folder name, stripped from download paths
const INDEX_TTL = 6 * 60 * 60 * 1000; // 6h — the page changes rarely and is 8 MB, so cache aggressively
/**
 * Always treat the index response as valid so a non-2xx status (e.g. a transient 5xx from the
 * host) lands in the `catch` below instead of throwing as an HttpError before we can fall back to
 * the cached copy. Only invoked on a real network fetch — FetcherMock bypasses axios in tests.
 */
const acceptAnyStatus = /* istanbul ignore next */ () => true;
/** A title-segment match candidate: "Name (YYYY)". */
const TITLE_SEGMENT_RE = /^(.*?)\s*\((\d{4})\)\s*$/;
/** Episode tag inside a filename, e.g. "... - 1x05 (...)" → season 1, episode 5. */
const EPISODE_TAG_RE = /(\d+)x(\d+)/i;
let cachedFolders;
const indexMutex = new async_mutex_1.Mutex();
class DramaSuki extends Source_1.Source {
    id = 'dramasuki';
    label = 'DramaSuki';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.ko, types_1.CountryCode.zh, types_1.CountryCode.ja, types_1.CountryCode.th, types_1.CountryCode.id];
    baseUrl = INDEX_URL;
    category = 'asiandrama';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, _type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        /* istanbul ignore next -- TMDB always returns a non-empty name when it resolves */
        if (!name) {
            return [];
        }
        const folders = await this.getIndex(ctx);
        if (folders.length === 0) {
            this.fetcher.getLogger().info('DramaSuki: index empty', ctx);
            return [];
        }
        const nameSlug = normalize(name);
        const labelBase = tmdbId.season ? `${name} ${tmdbId.formatSeasonAndEpisode()}` : `${name} (${year})`;
        // Find every release/season leaf folder whose title segment matches the requested title.
        // Matching is forgiving: an exact normalized match wins, but we also accept a close Levenshtein
        // match (transliterations / alternate romanizations) and tolerate a ±1 year discrepancy (TMDB's
        // year vs the release year). Year-less folders match on title alone. A single missed folder =
        // zero results for the user, so this errs on the side of inclusion and is narrowed by the
        // episode filter below.
        const results = [];
        for (const folder of folders) {
            const titleSegment = findTitleSegment(folder.path);
            if (!titleSegment) {
                continue;
            }
            if (!isTitleMatch(normalize(titleSegment.name), nameSlug)) {
                continue;
            }
            if (!isYearMatch(titleSegment.year, year)) {
                continue;
            }
            for (const file of folder.files) {
                if (tmdbId.season !== undefined) {
                    const tag = file.name.match(EPISODE_TAG_RE);
                    // Keep only the requested season/episode. Files without an SxxExx tag (e.g. subtitles,
                    // samples) are skipped for series so we don't surface a non-episode as an episode.
                    const tagSeason = tag?.[1];
                    const tagEpisode = tag?.[2];
                    if (tagSeason === undefined || parseInt(tagSeason, 10) !== tmdbId.season) {
                        continue;
                    }
                    if (tmdbId.episode !== undefined && (tagEpisode === undefined || parseInt(tagEpisode, 10) !== tmdbId.episode)) {
                        continue;
                    }
                }
                const url = buildDownloadUrl(folder.path, file.name);
                /* istanbul ignore if -- folder paths + filenames are always well-formed, URL() cannot throw */
                if (!url) {
                    continue;
                }
                results.push({
                    url,
                    meta: {
                        title: `${labelBase} ${file.name}`,
                        bytes: file.bytes,
                        height: (0, utils_1.findHeight)(file.name) ?? guessHeightFromName(file.name),
                        countryCodes: this.countryCodes,
                    },
                });
            }
        }
        this.fetcher.getLogger().info(`DramaSuki: returning ${results.length} file(s) for "${name}" S${tmdbId.season ?? '?'}E${tmdbId.episode ?? '?'}`, ctx);
        return results;
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // Index fetch + parse
    // ─────────────────────────────────────────────────────────────────────────────
    /** Fetch the Snap2HTML index page and parse it into folders. Cached process-wide for INDEX_TTL. */
    async getIndex(ctx) {
        if (cachedFolders && Date.now() - cachedFolders.ts < INDEX_TTL) {
            return cachedFolders.folders;
        }
        // Dedupe concurrent index fetches across parallel /stream requests.
        return indexMutex.runExclusive(async () => {
            /* istanbul ignore next -- only hit under true concurrent contention, which unit tests can't deterministically trigger */
            if (cachedFolders && Date.now() - cachedFolders.ts < INDEX_TTL) {
                return cachedFolders.folders;
            }
            let html;
            try {
                html = await this.fetcher.text(ctx, new URL(INDEX_URL), { timeout: 30000, validateStatus: acceptAnyStatus });
            }
            catch (error) {
                this.fetcher.getLogger().warn(`DramaSuki: failed to fetch index: ${error}`, ctx);
                return cachedFolders?.folders ?? [];
            }
            const folders = parseSnapDirs(html);
            this.fetcher.getLogger().info(`DramaSuki: parsed ${folders.length} folders from index`, ctx);
            cachedFolders = { folders, ts: Date.now() };
            return folders;
        });
    }
}
exports.DramaSuki = DramaSuki;
// ─────────────────────────────────────────────────────────────────────────────
// Pure parsing helpers (module-level, unit-testable without a Source instance)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Parse a Snap2HTML page's embedded `dirs[]` array into folders with their files.
 *
 * The page sets up `Array.prototype.p = Array.prototype.push` and then emits thousands of
 * `D.p(["path*0*date", "file*bytes*date", ..., totalSize, "subdirIds"])` statements. We extract just
 * those statements with a regex and parse each array literal. Only folders that directly contain
 * files are returned (parent/category nodes carry only subdir IDs and are dropped).
 */
function parseSnapDirs(html) {
    const folders = [];
    const seenPaths = new Set();
    const entryRe = /D\.p\(\s*(\[(?:[^\[\]]*)\])\s*\)/g;
    let match;
    while ((match = entryRe.exec(html)) !== null) {
        // The capture group is mandatory in `entryRe`, so match[1] is always present here.
        const arr = parseArrayLiteral(match[1]);
        if (!arr || arr.length === 0) {
            continue;
        }
        const header = arr[0];
        if (typeof header !== 'string') {
            continue;
        }
        const path = header.split('*')[0];
        if (!path || !path.startsWith(`${SOURCE_ROOT}/`) || seenPaths.has(path)) {
            continue;
        }
        seenPaths.add(path);
        // File entries are the string elements after the header: "filename*bytes*date".
        const files = [];
        for (let i = 1; i < arr.length; i++) {
            const entry = arr[i];
            if (typeof entry !== 'string') {
                continue; // skip the totalSize number and the trailing subdir-id string
            }
            const parts = entry.split('*');
            const name = parts[0];
            const bytes = parseInt(parts[1] ?? '', 10);
            if (!name || !Number.isFinite(bytes) || bytes <= 0) {
                continue;
            }
            files.push({ name, bytes });
        }
        // Parent/category folders have no direct files — skip them; they only organize sub-folders.
        if (files.length > 0) {
            folders.push({ path, files });
        }
    }
    return folders;
}
/** Find the title segment — the first path part matching "Name (YYYY)" — in a folder path. */
function findTitleSegment(folderPath) {
    const segments = folderPath.split('/');
    for (const segment of segments) {
        const m = segment.match(TITLE_SEGMENT_RE);
        if (m && m[1]) {
            /* istanbul ignore next -- the (YYYY) capture is mandatory when the regex matches, so m[2] is always defined */
            return { name: m[1].trim(), year: parseInt(m[2] ?? '', 10) };
        }
    }
    return undefined;
}
/** Build the dl.dramasuki.xyz URL for a file, stripping the "DramaSuki/" root from the path. */
function buildDownloadUrl(folderPath, fileName) {
    const rel = folderPath.startsWith(`${SOURCE_ROOT}/`) ? folderPath.slice(SOURCE_ROOT.length + 1) : folderPath;
    try {
        // encodeURIComponent per segment so "#", spaces, "(", etc. are URL-safe but "/" stays a separator.
        return new URL(DOWNLOAD_BASE + encodePath(`${rel}/${fileName}`));
    }
    catch {
        /* istanbul ignore next -- encodePath percent-encodes everything, new URL() cannot throw */
        return undefined;
    }
}
/** Fallback height guess from the filename's "2160p"/"1080p"/"4K" tokens when findHeight misses. */
function guessHeightFromName(name) {
    // Match a height number optionally followed by "p" (e.g. "1080p", "720"), or a "4k"/"4K" token.
    const m = name.match(/\b(2160|1080|720|480)p?\b|\b4k\b/i);
    if (!m) {
        return undefined;
    }
    // The 4k alternative is the only non-numeric capture across the alternation.
    return /4k/i.test(m[0]) ? 2160 : parseInt(m[0], 10);
}
/** Lowercase, strip accents/diacritics and non-alphanumerics for forgiving title comparison. */
function normalize(s) {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}
/**
 * Decide whether a normalized folder-title slug matches the normalized query slug. Accepts an exact
 * match OR a close Levenshtein match (≤ 15% of the longer string's length, min 2 chars) so that
 * transliterations / alternate romanizations (e.g. "Weightlifting Fairy" vs "Weight Lifting Fairy")
 * still match. A substring match alone is deliberately NOT accepted — it caused false positives
 * (OST/special albums containing the title) in earlier iterations.
 */
function isTitleMatch(folderSlug, querySlug) {
    if (folderSlug === querySlug) {
        return true;
    }
    const longest = Math.max(folderSlug.length, querySlug.length);
    if (longest < 4) {
        return false; // too short for a meaningful fuzzy match
    }
    const tolerance = Math.max(2, Math.floor(longest * 0.15));
    return levenshtein(folderSlug, querySlug) <= tolerance;
}
/** Match the folder's year against TMDB's year, tolerating a ±1 discrepancy and missing years. */
function isYearMatch(folderYear, tmdbYear) {
    if (folderYear === undefined || tmdbYear === undefined) {
        return true; // no year on either side → match on title alone
    }
    return Math.abs(folderYear - tmdbYear) <= 1;
}
/** Case-insensitive edit distance between two equal-normalization strings. */
function levenshtein(a, b) {
    if (a === b) {
        return 0;
    }
    const m = a.length;
    const n = b.length;
    if (m === 0) {
        return n;
    }
    if (n === 0) {
        return m;
    }
    // Two rolling rows of distances. Filled explicitly so every index is guaranteed defined under
    // noUncheckedIndexedAccess.
    let prev = [];
    let curr = [];
    for (let j = 0; j <= n; j++) {
        prev[j] = j;
    }
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            /* istanbul ignore next -- prev/curr are fully populated, so the ?? 0 fallbacks never trigger */
            curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
        }
        prev = [...curr];
        curr = [];
    }
    /* istanbul ignore next -- prev[n] is always defined since the array is fully populated */
    return prev[n] ?? 0;
}
/** Path-segment encoder: encodes each segment so "#", spaces, "(", etc. are URL-safe but "/" stays. */
function encodePath(path) {
    return path
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
}
/**
 * Parse a Snap2HTML array literal like `["a*b*c", 123, "x*y*z"]` into its elements. The values are
 * quoted strings or bare numbers; we tokenize instead of `eval` so the parser is safe regardless of
 * the (arbitrary) characters inside filenames.
 */
function parseArrayLiteral(literal) {
    const inner = literal.trim();
    /* istanbul ignore next -- the calling regex only ever passes bracket-wrapped matches */
    if (!inner.startsWith('[') || !inner.endsWith(']')) {
        return undefined;
    }
    const body = inner.slice(1, -1);
    const out = [];
    let i = 0;
    while (i < body.length) {
        while (i < body.length && /[\s,]/.test(body.charAt(i))) {
            i++;
        }
        if (i >= body.length) {
            break;
        }
        if (body.charAt(i) === '"') {
            i++;
            let s = '';
            while (i < body.length) {
                const c = body.charAt(i);
                if (c === '\\' && i + 1 < body.length) {
                    s += body.charAt(i + 1);
                    i += 2;
                    continue;
                }
                if (c === '"') {
                    i++;
                    break;
                }
                s += c;
                i++;
            }
            out.push(s);
        }
        else {
            let tok = '';
            while (i < body.length && body.charAt(i) !== ',') {
                tok += body.charAt(i);
                i++;
            }
            const trimmed = tok.trim();
            /* istanbul ignore if -- the leading skip loop absorbs commas, so a bare empty token never reaches here */
            if (trimmed === '') {
                continue;
            }
            const n = Number(trimmed);
            /* istanbul ignore next -- bare tokens in Snap2HTML arrays are always numeric (sizes/dates) */
            out.push(Number.isFinite(n) ? n : trimmed);
        }
    }
    return out;
}
