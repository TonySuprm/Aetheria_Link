"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DramaDay = void 0;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- the Puppeteer page.evaluate callbacks execute in a browser context (document/window) which is not part of the Node tsconfig lib
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const PUPPETEER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FILE_HOSTER_RE = /pixeldrain|send\.cm|send\.now|gofile|mega\.nz|buzzheavy|filecrypt|akirabox|fileq/i;
/**
 * dramaday.me source — handles two distinct link layouts found on the site:
 *
 *  1. **Direct exe.io** (e.g. reborn-rookie): each host link is an exe.io shortener whose `url=`
 *     base64 param decodes straight to the file-hoster URL:
 *       exe.io/full/?api=...&url=aHR0cHM6Ly9waXhlbGRyYWluLmNvbS91L0ZQM1JDbzFS&type=2
 *       → base64decode → https://pixeldrain.com/u/FP3RCo1R
 *
 *  2. **filecrypt container** (e.g. perfect-crown): the exe.io link decodes to a filecrypt.cc
 *     container page (`filecrypt.cc/Container/<ID>.html`) whose download buttons open a popup that
 *     redirects to the real file-hoster URL. The button label / row host tells us which hoster,
 *     and the file row carries the real filename + size. We render the container with Puppeteer,
 *     click the matching host's download button, and capture the resulting file-hoster request.
 *
 * dramaday is Cloudflare-protected, so page fetches go through FlareSolverr directly (the Fetcher's
 * built-in 15s FlareSolverr timeout is too short for dramaday's challenge). Only "large" video
 * files (full episodes) are returned — small ad/sample rows are filtered out by size.
 */
class DramaDay extends Source_1.Source {
    id = 'dramaday';
    label = 'DramaDay';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.ko, types_1.CountryCode.ja, types_1.CountryCode.zh];
    baseUrl = 'https://dramaday.me';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, _type, id) {
        const chromePath = (0, utils_1.envGet)('PUPPETEER_EXECUTABLE_PATH');
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name) {
            return [];
        }
        this.fetcher.getLogger().info(`DramaDay: resolving "${name}" S${tmdbId.season ?? '?'}E${tmdbId.episode ?? '?'}`, ctx);
        const title = tmdbId.season ? `${name} ${tmdbId.formatSeasonAndEpisode()}` : `${name} (${year})`;
        // 1. Find the drama page slug via search.
        const dramaPageUrl = await this.findDramaPage(ctx, name);
        this.fetcher.getLogger().info(`DramaDay: search → page ${dramaPageUrl?.href ?? '(none)'}`, ctx);
        if (!dramaPageUrl) {
            return [];
        }
        // 2. Fetch the drama page (Cloudflare-protected) and parse its download data table.
        const html = await this.fetchFlareSolverr(ctx, dramaPageUrl.href);
        this.fetcher.getLogger().info(`DramaDay: page html len ${html?.length ?? 0}`, ctx);
        if (!html) {
            return [];
        }
        const episodes = this.parseDownloadTable(html);
        this.fetcher.getLogger().info(`DramaDay: parsed ${episodes.length} episode rows`, ctx);
        if (episodes.length === 0) {
            return [];
        }
        // 3. Filter to the requested episode + keep only "large" video rows (skip ad/sample rows).
        let selected = episodes;
        if (tmdbId.episode) {
            const matching = episodes.filter(ep => ep.episode === tmdbId.episode);
            if (matching.length > 0) {
                selected = matching;
            }
        }
        const large = selected.filter(ep => this.isLargeVideoFile(ep.bytes, ep.fileName));
        const rows = large.length > 0 ? large : selected;
        // 4. Resolve every host link to a real file-hoster URL. Direct links (exe.io → hoster) are
        //    instant; filecrypt containers each need a Puppeteer render. Run them all in parallel so
        //    N filecrypt containers resolve in ~one container's time rather than N×. Dedupe identical
        //    filecrypt container URLs (different quality rows often share a container).
        const filecryptCache = new Map();
        const resolveFilecryptCached = (url) => {
            let p = filecryptCache.get(url);
            if (!p) {
                p = this.resolveFilecrypt(ctx, url).catch(() => undefined);
                filecryptCache.set(url, p);
            }
            return p;
        };
        const tasks = [];
        for (const ep of rows) {
            for (const host of ep.hosts) {
                const quality = ep.quality;
                const bytes = ep.bytes || undefined;
                const decoded = host.decoded;
                if (/filecrypt/i.test(decoded)) {
                    if (!chromePath) {
                        continue;
                    }
                    tasks.push(resolveFilecryptCached(decoded).then(url => (url ? { url, quality, bytes } : null)));
                }
                else if (FILE_HOSTER_RE.test(decoded)) {
                    tasks.push(Promise.resolve({ url: decoded, quality, bytes }));
                }
            }
        }
        const settled = await Promise.all(tasks);
        const results = [];
        for (const item of settled) {
            if (!item) {
                continue;
            }
            try {
                results.push({
                    url: new URL(item.url),
                    meta: {
                        title: `${title}${item.quality ? ' ' + item.quality : ''}`,
                        bytes: item.bytes,
                        countryCodes: this.countryCodes,
                    },
                });
            }
            catch {
                // ignore malformed URLs
            }
        }
        this.fetcher.getLogger().info(`DramaDay: resolved ${results.length} hoster links (of ${tasks.length} tasks, ${rows.reduce((n, r) => n + r.hosts.length, 0)} hosts in ${rows.length} rows)`, ctx);
        return results;
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // filecrypt container resolution (Puppeteer)
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Render a filecrypt container, click the download button for a preferred host, and capture the
     * resulting file-hoster URL (e.g. pixeldrain.com/api/file/<id>). filecrypt's buttons call
     * `openLink(...)` which `window.open`s a popup that redirects to the hoster.
     *
     * The dramaday host label is unreliable ("Link 1"), so we read each row's actual `external_link`
     * host from the rendered DOM and click the row for a preferred host (pixeldrain > send > others).
     * We also handle filecrypt's anti-scrape by capturing hoster requests from the page AND any
     * spawned popups, and by trying a few rows if the first click doesn't yield a hoster hit.
     */
    resolveFilecrypt = async (ctx, containerUrl) => {
        const browser = await (0, utils_1.getBrowser)(this.fetcher.getLogger());
        const page = await browser.newPage();
        const hosterRequests = [];
        const captureHoster = (u) => {
            if (FILE_HOSTER_RE.test(u) && !/filecrypt|background|font|icon|logo|pattern|css|js|woff/i.test(u)) {
                hosterRequests.push(u);
            }
        };
        try {
            await (0, utils_1.stealthPage)(page);
            await page.setUserAgent(PUPPETEER_UA);
            page.on('request', r => captureHoster(r.url()));
            browser.on('targetcreated', async (target) => {
                const popup = await target.page().catch(() => null);
                if (popup) {
                    popup.on('request', r => captureHoster(r.url()));
                }
            });
            await page.goto(containerUrl, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => undefined);
            await new Promise(r => setTimeout(r, 1500));
            // Preferred hosts in priority order — pick the best row available in the rendered DOM.
            const PREFERRED = ['pixeldrain', 'send.now', 'send.cm', 'gofile', 'mega.nz', 'buzzheavier', 'akirabox'];
            const rowIndex = await page.evaluate((preferred) => {
                const rows = [...document.querySelectorAll('tr')];
                // Map each row to its host, then return the index of the first row matching the
                // highest-priority preferred host.
                const rowHosts = rows.map(tr => (tr.querySelector('a.external_link')?.textContent || '').trim().toLowerCase());
                for (const want of preferred) {
                    const idx = rowHosts.findIndex(h => h.includes(want));
                    if (idx >= 0 && rows[idx]?.querySelector('button.download')) {
                        return idx;
                    }
                }
                // Fallback: first row with a download button.
                return rows.findIndex(tr => tr.querySelector('button.download'));
            }, PREFERRED);
            if (rowIndex < 0) {
                return undefined;
            }
            // Click that row's button, then wait for a hoster request. If nothing arrives, try the next
            // few rows (filecrypt sometimes serves a stale/dead mirror first).
            for (let attempt = 0; attempt < 3; attempt++) {
                hosterRequests.length = 0;
                const ok = await page.evaluate((idx) => {
                    const btn = document.querySelectorAll('tr')[idx]?.querySelector('button.download');
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                }, rowIndex + attempt).catch(() => false);
                if (!ok) {
                    break;
                }
                const deadline = Date.now() + 9000;
                while (Date.now() < deadline && hosterRequests.length === 0) {
                    await new Promise(r => setTimeout(r, 800));
                }
                if (hosterRequests.length > 0) {
                    break;
                }
            }
            // Prefer a preferred-hoster URL, else the first captured.
            const best = hosterRequests.find(u => PREFERRED.some(p => new RegExp(p, 'i').test(u))) ?? hosterRequests[0];
            if (best) {
                this.fetcher.getLogger().info(`DramaDay: filecrypt ${containerUrl} → ${best}`, ctx);
            }
            return best;
        }
        finally {
            await page.close().catch(() => undefined);
        }
    };
    // ─────────────────────────────────────────────────────────────────────────────
    // Page parsing
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Parse the download data table (Episode | Quality | host links). Works for both link layouts:
     * the host link is always an exe.io shortener; its `url=` base64 decodes either to a direct
     * file-hoster URL or to a filecrypt container URL.
     */
    parseDownloadTable(html) {
        const $ = cheerio.load(html);
        const table = $('table').filter((_, t) => /Episode.*Quality|Quality.*Download|Link\s*\d/i.test($(t).text())).first();
        if (table.length === 0) {
            return [];
        }
        const episodes = [];
        table.find('tr').each((_, tr) => {
            const $tr = $(tr);
            const cells = $tr.find('td');
            if (cells.length < 2) {
                return;
            }
            const epRaw = $(cells[0]).text().trim();
            const episodeMatch = epRaw.match(/\d+/);
            const episode = episodeMatch ? parseInt(episodeMatch[0], 10) : undefined;
            const quality = $(cells[1]).text().trim().replace(/\s+/g, ' ').substring(0, 40);
            // File name + size are in later cells; dramaday rows include the real filename (title attr)
            // and a human-readable size cell (e.g. "2.68 GB").
            const fileName = ($tr.find('td[title]').first().attr('title')
                || $tr.find('td').eq(2).text().trim()).substring(0, 120);
            const bytes = this.parseSizeBytes($tr.text());
            const hosts = [];
            const seen = new Set();
            $tr.find('a').each((_, a) => {
                const href = $(a).attr('href') ?? '';
                const hostLabel = $(a).text().trim();
                if (!hostLabel || !href || !href.includes('exe.io')) {
                    return;
                }
                const exeMatch = href.match(/[?&]url=([A-Za-z0-9+/=]+)(?:&|$)/);
                if (!exeMatch?.[1]) {
                    return;
                }
                let decoded;
                try {
                    decoded = Buffer.from(exeMatch[1], 'base64').toString('utf8');
                }
                catch {
                    return;
                }
                if (!decoded.startsWith('http') || seen.has(decoded)) {
                    return;
                }
                seen.add(decoded);
                hosts.push({ host: hostLabel, source: href, decoded });
            });
            if (hosts.length > 0) {
                episodes.push({ episode, quality, fileName, bytes, hosts });
            }
        });
        return episodes;
    }
    /** Parse the first "2.68 GB"/"850 MB"-style size in a row's text to bytes. */
    parseSizeBytes(text) {
        const m = text.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB|KB|TB)/i);
        if (!m) {
            return 0;
        }
        const value = m[1];
        const unitRaw = m[2];
        if (!value || !unitRaw) {
            return 0;
        }
        const n = parseFloat(value.replace(',', '.'));
        const unit = unitRaw.toUpperCase();
        const mult = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
        return n * (mult[unit] ?? 0);
    }
    /** Only full-episode video files: ≥ ~200 MB and a video filename (mp4/mkv/...). */
    isLargeVideoFile(bytes, fileName) {
        const isVideo = /\.(mp4|mkv|webm|avi|mov|m4v)/i.test(fileName);
        return isVideo && bytes >= 200 * 1024 * 1024;
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // Search + Cloudflare fetch
    // ─────────────────────────────────────────────────────────────────────────────
    findDramaPage = async (ctx, name) => {
        const searchUrl = new URL(this.baseUrl);
        searchUrl.searchParams.set('s', name);
        const html = await this.fetchFlareSolverr(ctx, searchUrl.href);
        if (!html) {
            return undefined;
        }
        const $ = cheerio.load(html);
        const want = name.toLowerCase();
        const wantSlug = want.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let best;
        // Score each candidate. We strongly prefer exact-title / exact-slug matches (so "Perfect Crown"
        // beats "Perfect Crown OST Special"): the score is the Levenshtein distance between the
        // candidate's normalized title and the query, with a bonus when the URL slug equals the query
        // slug. Pure substring matches (the old behaviour) wrongly favoured OST/special albums.
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (!href || !href.includes('dramaday.me/') || href.includes('?s=') || href.includes('/category/') || href.includes('/tag/')) {
                return;
            }
            const text = ($(el).attr('title') || $(el).find('h1,h2,h3,h4,.title').first().text() || $(el).text()).trim();
            if (!text || /^(home|drama|about|contact|schedule|genre|movies|request|various artists|ost)/i.test(text)) {
                return;
            }
            const t = text.toLowerCase();
            // Levenshtein distance between the candidate title and the query.
            let distance = levenshtein(t, want);
            // Prefer pages whose slug exactly matches the query slug (e.g. /perfect-crown/).
            let slug = '';
            try {
                slug = new URL(href).pathname.replace(/^\/|\/$/g, '');
            }
            catch {
                /* ignore */
            }
            if (slug === wantSlug || slug.endsWith('/' + wantSlug)) {
                distance -= 5;
            }
            if (!best || distance < best.distance) {
                best = { href, distance };
            }
        });
        if (best) {
            try {
                return new URL(best.href);
            }
            catch {
                return undefined;
            }
        }
        // Fallback: derive the slug from the name (dramaday uses kebab-case slugs).
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        try {
            return new URL(`/${slug}/`, this.baseUrl);
        }
        catch {
            return undefined;
        }
    };
    // Fetch a Cloudflare-protected page via FlareSolverr with a generous timeout (dramaday's
    // challenge takes ~30-40s, longer than the Fetcher's built-in 15s FlareSolverr path). Falls back
    // to a plain Fetcher.text() when FlareSolverr is unavailable.
    fetchFlareSolverr = async (ctx, url) => {
        const endpoint = (0, utils_1.envGet)('FLARESOLVERR_ENDPOINT');
        if (!endpoint) {
            try {
                return await this.fetcher.text(ctx, new URL(url), { validateStatus: () => true });
            }
            catch {
                return undefined;
            }
        }
        const base = endpoint.replace(/\/v1\/?$/, '');
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await fetch(`${base}/v1`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 55000 }),
                    signal: AbortSignal.timeout(60000),
                });
                const data = (await res.json());
                if (data.status === 'ok' && data.solution?.response) {
                    return data.solution.response;
                }
            }
            catch (error) {
                this.fetcher.getLogger().warn(`DramaDay FlareSolverr attempt ${attempt + 1} failed for ${url}: ${error}`, ctx);
            }
        }
        return undefined;
    };
}
exports.DramaDay = DramaDay;
// Case-insensitive edit distance, used to rank dramaday search results so an exact title match
// ("Perfect Crown") outranks a longer album/special name that merely contains it.
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
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) {
        prev[j] = j;
    }
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }
    return prev[n];
}
