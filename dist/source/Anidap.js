"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Anidap = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const CHAD_BASE = 'https://chad.anidap.lol/rest/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const clean = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
// Substring match either direction + length ratio > 0.7 (kills radical fuzzy hits), like Miruro.
const titleMatches = (candidate, wanted) => {
    const a = clean(candidate);
    const b = clean(wanted);
    if (a.length < 3 || b.length < 3)
        return false;
    if (!a.includes(b) && !b.includes(a))
        return false;
    return Math.min(a.length, b.length) / Math.max(a.length, b.length) > 0.7;
};
class Anidap extends Source_1.Source {
    id = 'anidap';
    label = 'Anidap';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi, types_1.CountryCode.en, types_1.CountryCode.ja];
    baseUrl = 'https://anidap.lol';
    category = 'anime';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    get logger() {
        return this.fetcher.getLogger();
    }
    async handleInternal(ctx, type, id) {
        if (type !== 'movie' && type !== 'series')
            return [];
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const [name, year] = await (0, utils_1.getTmdbNameAndYear)(ctx, this.fetcher, tmdbId);
        if (!name)
            return [];
        const anilistId = await this.searchAnilist(ctx, name, year, type);
        if (!anilistId) {
            this.logger.info(`Anidap: no AniList match for TMDB "${name}" ${year ?? ''}`, ctx);
            return [];
        }
        const slug = await this.findSlug(ctx, anilistId, name);
        if (!slug) {
            this.logger.info(`Anidap: no slug for anilist ${anilistId}`, ctx);
            return [];
        }
        const ep = type === 'series' ? (tmdbId.episode || 1) : 1;
        const resolved = await this.resolveSources(ctx, slug, ep);
        if (resolved.length === 0) {
            this.logger.info(`Anidap: no sources for slug ${slug} ep ${ep}`, ctx);
            return [];
        }
        const season = type === 'series' ? tmdbId.season : undefined;
        const episode = type === 'series' ? tmdbId.episode : undefined;
        const results = [];
        for (const s of resolved) {
            const label = type === 'series'
                ? `[Anidap] ${name} S${season ?? 1}E${episode ?? ep} ${s.type.toUpperCase()} 1080p`
                : `[Anidap] ${name} ${s.type.toUpperCase()} 1080p`;
            const meta = {
                countryCodes: this.countryCodes,
                height: 1080,
                title: label,
                sourceLabel: this.label,
                ...(s.referer && { referer: s.referer }),
                ...(season && { season }),
                ...(episode && { episode }),
            };
            results.push({ url: this.buildStreamUrl(ctx, s), meta, notWebReady: false });
        }
        return results;
    }
    /** Query AniList GraphQL to map the TMDB title (+ year) into an AniList numeric id. */
    async searchAnilist(ctx, name, year, type) {
        const query = `
      query ($search: String) {
        Page(page: 1, perPage: 10) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english native }
            startDate { year }
            format
          }
        }
      }
    `;
        let payload;
        try {
            payload = await this.fetcher.json(ctx, new URL('https://graphql.anilist.co'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                data: JSON.stringify({ query, variables: { search: name } }),
            });
        }
        catch {
            return undefined;
        }
        const mediaList = payload?.data?.Page?.media ?? [];
        for (const media of mediaList) {
            const titles = [media.title?.english, media.title?.romaji, media.title?.native].filter((t) => !!t);
            if (!titles.some(t => titleMatches(t, name)))
                continue;
            if (year) {
                const yr = media.startDate?.year;
                if (yr && Math.abs(yr - year) > 1)
                    continue;
            }
            const format = media.format;
            if (type === 'movie' && format && format !== 'MOVIE')
                continue;
            if (type === 'series' && format && !['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL'].includes(format))
                continue;
            return media.id;
        }
        return undefined;
    }
    /** Fetch the anidap detail page to translate the AniList id into the chad slug. */
    async findSlug(ctx, anilistId, name) {
        try {
            const payload = await this.fetcher.text(ctx, new URL(`${this.baseUrl}/watch.data?id=${anilistId}&ep=1`), {
                headers: { Accept: '*/*', Referer: this.baseUrl, 'User-Agent': UA },
            });
            const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const explicitRegex = new RegExp(`(${safeName}-[a-z0-9]{5})(?=["',])`, 'i');
            const explicitMatch = payload.match(explicitRegex);
            if (explicitMatch && explicitMatch[1]) {
                return explicitMatch[1].toLowerCase();
            }
            // Fallback matching generic hashes just in case title translation didn't exactly match the frontend slug mapping
            const genericRegex = /"([a-z0-9\-]+-[a-z0-9]{5})"/i;
            const genericMatch = payload.match(genericRegex);
            return genericMatch ? genericMatch[1] : undefined;
        }
        catch {
            return undefined;
        }
    }
    /**
     * GET a chad endpoint as JSON. The first request to chad returns 204 (empty) and sets the
     * `_amx_id` warmup cookie; the retry (cookie now in the jar) returns 200. Returns null on failure.
     */
    async chadGet(ctx, url) {
        const headers = { Accept: 'application/json', Referer: this.baseUrl };
        const tryFetch = async () => {
            const txt = await this.fetcher.text(ctx, url, { headers });
            if (!txt || txt.trim() === '')
                return null; // 204 warmup
            try {
                return JSON.parse(txt);
            }
            catch {
                return null;
            }
        };
        try {
            const first = await tryFetch();
            if (first === null) {
                return await tryFetch(); // warmup done — cookie set, retry
            }
            return first;
        }
        catch {
            return null;
        }
    }
    /**
     * Resolve one sub + one dub source. For each type, fetch ALL providers' sources in parallel,
     * then probe the master+variant playlists to detect obfuscated providers whose segments are
     * hosted on image/ad CDNs (ibyteimg.com, ad-site-i18n, vivibebe.site, kotocdn.site). The first
     * playable candidate wins (default provider first). Protected/timeout providers are kept.
     */
    async resolveSources(ctx, slug, ep) {
        const servers = await this.chadGet(ctx, new URL(`${CHAD_BASE}/servers?id=${encodeURIComponent(slug)}&epNum=${ep}`));
        if (!servers)
            return [];
        const resolveType = async (type, providers) => {
            if (!providers?.length)
                return null;
            const fetched = await Promise.all(providers.map(async (provider) => {
                const res = await this.chadGet(ctx, new URL(`${CHAD_BASE}/sources?id=${encodeURIComponent(slug)}&epNum=${ep}&type=${type}&providerId=${encodeURIComponent(provider.id)}`));
                const src = res?.sources?.[0];
                if (!src?.url)
                    return null;
                try {
                    return { provider, url: new URL(src.url), referer: res?.headers?.Referer ?? null, playable: null };
                }
                catch {
                    return null;
                }
            }));
            let candidates = fetched.filter((c) => c !== null);
            if (candidates.length === 0)
                return null;
            // Instant host/extension pass; skip DASH.
            candidates = candidates.filter((c) => {
                if (/\.mpd(\?|$)/i.test(c.url.pathname))
                    return false;
                const verdict = this.classifySegment(c.url);
                if (verdict === false)
                    return false;
                return true;
            });
            // Probe remaining unknown candidates in parallel and keep only confirmed-good or
            // unverifiable (null) candidates. Confirmed-bad (false) are dropped.
            candidates = (await Promise.all(candidates.map(async (c) => {
                const verdict = await this.probePlayable(ctx, c.url, c.referer);
                if (verdict === false)
                    return null;
                return { ...c, playable: verdict };
            }))).filter((c) => c !== null);
            const ordered = [...candidates].sort((a, b) => Number(b.provider.default) - Number(a.provider.default));
            const winner = ordered[0];
            if (!winner) {
                this.logger.info(`Anidap: all ${type} providers filtered for slug ${slug} ep ${ep}`, ctx);
                return null;
            }
            return { url: winner.url, type, referer: winner.referer };
        };
        const [sub, dub] = await Promise.all([
            resolveType('sub', servers.subProviders),
            resolveType('dub', servers.dubProviders),
        ]);
        const out = [];
        if (sub)
            out.push(sub);
        if (dub)
            out.push(dub);
        return out;
    }
    /** Classify a source URL by extension + host heuristics (no HTTP needed). */
    classifySegment(segUrl) {
        const path = segUrl.pathname.toLowerCase();
        const host = segUrl.hostname.toLowerCase();
        if (/\.(ts)(\?|$)/.test(path))
            return true;
        // Known obfuscation CDNs that serve actual image data (stall at 0:00 in Stremio/MediaFlow)
        if (host.includes('ibyteimg') ||
            host.includes('ad-site-i18n') ||
            host.includes('vivibebe') ||
            host.includes('kotocdn')) {
            return false;
        }
        // Don't reject .jpg/.png on unknown hosts — some CDNs disguise MPEG-TS segments with fake
        // image extensions and they play fine. We probe those below.
        return null;
    }
    /**
     * Probe an HLS master playlist: fetch the first variant, inspect the first few segment URLs,
     * and return false if every segment is on a known bad/ad host. Returns true if at least one
     * segment looks like a real video segment, null if we couldn't tell (timeout/4xx on probe).
     */
    async probePlayable(ctx, masterUrl, referer) {
        const headers = {};
        if (referer)
            headers['Referer'] = referer;
        try {
            const masterText = await this.fetcher.text(ctx, masterUrl, { headers, timeout: 2500 });
            if (!masterText)
                return null;
            const lines = masterText.split('\n').map((l) => l.trim()).filter(Boolean);
            const variantPath = lines.find((l) => !l.startsWith('#'));
            if (!variantPath)
                return null;
            const variantUrl = new URL(variantPath, masterUrl.href);
            const variantText = await this.fetcher.text(ctx, variantUrl, { headers, timeout: 2500 });
            if (!variantText)
                return null;
            const segmentUrls = variantText
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l && !l.startsWith('#'))
                .slice(0, 30)
                .map((path) => new URL(path, variantUrl.href))
                .filter((url) => !/\.(vtt|srt|m3u8|mpd)(\?|$)/i.test(url.pathname));
            if (segmentUrls.length === 0)
                return null;
            const badCount = segmentUrls.filter((url) => this.isBadSegmentHost(url.hostname)).length;
            if (badCount > 0 && badCount === segmentUrls.length)
                return false;
            return true;
        }
        catch {
            return null;
        }
    }
    isBadSegmentHost(hostname) {
        const h = hostname.toLowerCase();
        return h.includes('ibyteimg') || h.includes('ad-site-i18n') || h.includes('vivibebe') || h.includes('kotocdn');
    }
    /**
     * Build the playable URL: HLS via MediaFlow proxy (if configured), else the raw m3u8 (Stremio
     * proxies it with the Referer via proxyHeaders, set by StreamResolver from meta.referer). Direct
     * mp4 files with a referer go through /relay; without a referer they play directly.
     */
    buildStreamUrl(ctx, s) {
        const isHls = /\.m3u8(\?|$)/i.test(s.url.pathname) || /\.mpd(\?|$)/i.test(s.url.pathname);
        const referer = s.referer;
        if (isHls && (0, utils_1.supportsMediaFlowProxy)(ctx)) {
            return (0, utils_1.buildMediaFlowProxyHlsUrl)(ctx, s.url, {
                Referer: referer ?? this.baseUrl,
                'User-Agent': UA,
            }, true);
        }
        if (!isHls && referer) {
            const relay = new URL('/relay', ctx.hostUrl);
            relay.searchParams.set('url', s.url.href);
            relay.searchParams.set('referer', referer);
            return relay;
        }
        // HLS without MediaFlow, or any file without a referer: return raw. For HLS+referer the
        // StreamResolver attaches proxyHeaders (Referer) from meta.referer so Stremio proxies it.
        return s.url;
    }
}
exports.Anidap = Anidap;
