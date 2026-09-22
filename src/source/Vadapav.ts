import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import winston from 'winston';
import { Context, CountryCode } from '../types';
import { Fetcher, findHeight, getTmdbId, getTmdbNameAndYear, getClosestResolution, Id } from '../utils';
import { Source, SourceResult } from './Source';

export class Vadapav extends Source {
    public readonly id = 'vadapav';
    public readonly label = 'Vadapav.mov';
    public readonly contentTypes: ContentType[] = ['movie', 'series'];
    public readonly countryCodes: CountryCode[] = [CountryCode.multi];
    public readonly isAdult = false;

    public readonly baseUrl = 'https://vadapav.mov';
    private fetcher: Fetcher;

    private static fetchQueue: Promise<void> = Promise.resolve();
    private static readonly INTER_REQUEST_DELAY_MS = 600;

    private static pageCache = new Map<string, { html: string; ts: number }>();
    private readonly PAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes – reduced so restarting picks up fresh results

    private get logger(): winston.Logger {
        return this.fetcher.getLogger();
    }

    public constructor(fetcher: Fetcher) {
        super();
        this.fetcher = fetcher;
    }

    /**
     * Strip everything except lowercase letters and digits for comparison.
     */
    private clean(str: string): string {
        return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    /**
     * Tokenize a title into individual words (lowercase, letters/digits only).
     * e.g. "The Bear (2022)" -> ["the", "bear", "2022"]
     */
    private tokens(str: string): string[] {
        // Strip apostrophes first so "Bob's" → "Bobs" rather than ["bob","s"].
        // Also catch fake apostrophes like "Bob.s" or "Bob s" common in torrent names.
        return str.toLowerCase()
            .replace(/['`’´]/g, '')
            .replace(/(?<=[a-z])[.\s_-]s\b/g, 's')
            .match(/[a-z0-9]+/g) ?? [];
    }

    /**
     * Score how well a directory title matches the TMDB title.
     * Returns a value in [0,1]. We require AT LEAST 0.8 to accept the directory.
     *
     * Strategy:
     *  - Tokenize both sides.
     *  - Count how many query tokens appear in the directory tokens.
     *  - Penalise heavily if the directory has many extra tokens (avoids "The Bear" matching
     *    "The Bear Grylls Wild Weekend" etc.)
     */

    /**
     * Strip release metadata from a directory/file title so only the show title + year remain.
     * Strategy:
     *  1. Remove entire parenthetical blocks that contain typical release info (but keep bare 4-digit years).
     *  2. Remove square-bracket blocks (e.g. [BluRay], [t3nzin]).
     *  3. Strip individual well-known release tokens.
     */
    private stripReleaseTags(title: string): string {
        return title
            // 1. Remove (…) blocks that contain at least one non-year release keyword
            .replace(/\((?!\d{4}\))([^)]*(?:p\b|bit|web|blu|hevc|avc|x26[45]|eac|atmos|atvp|amzn|dsnp|nflx|hulu|hbo|pcok|sho|crkl|ddp|hd|remux|dl)[^)]*)\)/gi, '')
            // 2. Remove all [bracket] blocks (release group tags)
            .replace(/\[[^\]]*\]/g, '')
            // 3. Remove trailing release-group tag after final hyphen: e.g. " - iVy" or "-NTb"
            .replace(/-[a-z0-9]{2,12}\s*$/i, '')
            // 4. Strip individual known tokens
            .replace(/\b(?:1080p|720p|2160p|480p|4k|8k|uhd|x264|x265|hevc|10-?bit|8-?bit|sdr|hdr|hdr10|dv|bluray|blu-ray|web-?dl|webrip|hdtv|eac3|ac3|dts(?:-hd)?|ma|aac|mp4|mkv|avc|remux|repack|proper|av1|opus|multi\d*|5\.1|7\.1|2\.0|atmos|truehd|ddp|dd|atvp|amzn|dsnp|nflx|hulu|hbo|pcok|sho|s\d{1,2}(?:e\d{1,3})?|seasons?\s*\d{1,2}|complete|collection|series|movie|extended|uncut|director|theatrical)\b/gi, '')

            // 5. Strip loose audio channel notation like "5 1", "7 1", "2 0" (dot replaced by space in some titles)
            .replace(/\b[257]\s[01]\b/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    private matchScore(dirTitle: string, tmdbName: string, tmdbYear: number): number {
        const cleanDir = this.stripReleaseTags(dirTitle);

        const dirToks = this.tokens(cleanDir);
        const nameToks = this.tokens(tmdbName);

        if (nameToks.length === 0) return 0;

        const hit = nameToks.filter(t => dirToks.includes(t)).length;
        const nameCoverage = hit / nameToks.length; // how much of TMDB name is covered

        // Extra tokens in the directory name (beyond name tokens + optional year)
        const allowedTokens = new Set([...nameToks, tmdbYear?.toString()]);
        const extraToks = dirToks.filter(t => !allowedTokens.has(t)).length;
        // Penalise: heavily penalise extra tokens to avoid short titles like "From" matching "From Now On"
        const extraPenalty = extraToks * 0.35;

        return Math.max(0, nameCoverage - extraPenalty);
    }

    private async throttledFetch(ctx: Context, url: string): Promise<string> {
        const now = Date.now();
        const cached = Vadapav.pageCache.get(url);
        if (cached && (now - cached.ts) < this.PAGE_CACHE_TTL_MS) {
            return cached.html;
        }

        const result = new Promise<string>((resolve, reject) => {
            Vadapav.fetchQueue = Vadapav.fetchQueue.then(async () => {
                try {
                    const rechecked = Vadapav.pageCache.get(url);
                    if (rechecked && (Date.now() - rechecked.ts) < this.PAGE_CACHE_TTL_MS) {
                        resolve(rechecked.html);
                        return;
                    }
                    this.logger.info(`Vadapav: Throttled fetch ${url}`, ctx);
                    const html = await this.fetcher.text(ctx, new URL(url));
                    Vadapav.pageCache.set(url, { html, ts: Date.now() });
                    resolve(html);
                } catch (e) {
                    reject(e);
                } finally {
                    await new Promise((r) => setTimeout(r, Vadapav.INTER_REQUEST_DELAY_MS));
                }
            });
        });

        return result;
    }

    protected async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
        let tmdbId;
        try {
            tmdbId = await getTmdbId(ctx, this.fetcher, id);
        } catch {
            return [];
        }
        if (!tmdbId) return [];

        let resolvedTmdbInfo;
        try {
            resolvedTmdbInfo = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
        } catch {
            return [];
        }
        if (!resolvedTmdbInfo) return [];

        // [name, year, titleType, customName]
        const tmdbName = resolvedTmdbInfo[0];
        const tmdbYear = resolvedTmdbInfo[1];

        // Search only on title name — adding the year can help narrow, but if the year is
        // wrong or absent on vadapav the search returns nothing. Search on name only.
        // Vadapav's internal search breaks if given apostrophes (%27), so strip them out.
        const cleanSearchName = tmdbName.replace(/'/g, '');

        // Vadapav uses exact substring matching. Many directories use dot-separated names
        // (e.g. "Star.Trek.Lower.Decks.S02...") which won't be found by a space-separated query.
        // We therefore try BOTH forms and merge unique results.
        const spaceQuery = encodeURIComponent(cleanSearchName);
        const dotQuery = encodeURIComponent(cleanSearchName.replace(/\s+/g, '.'));

        const fetchHtml = async (url: string) => {
            try {
                return await this.throttledFetch(ctx, url);
            } catch (e) {
                this.logger.error(`Vadapav: Failed to fetch search index: ${e}`, ctx);
                return '';
            }
        };

        const searchHtmlSpace = await fetchHtml(`${this.baseUrl}/s/?q=${spaceQuery}`);
        const spaceResults = searchHtmlSpace
            ? await this.crawlDirectory(ctx, searchHtmlSpace, tmdbName, tmdbYear, type, id, 0, true)
            : [];

        // Only hit the dot-query endpoint if the space query returned nothing, to avoid doubling requests
        if (spaceResults.length > 0) return spaceResults;

        const searchHtmlDot = await fetchHtml(`${this.baseUrl}/s/?q=${dotQuery}`);
        return searchHtmlDot
            ? this.crawlDirectory(ctx, searchHtmlDot, tmdbName, tmdbYear, type, id, 0, true)
            : [];
    }


    private async crawlDirectory(
        ctx: Context,
        html: string,
        tmdbName: string,
        tmdbYear: number,
        type: ContentType,
        id: Id,
        depth: number,
        isSearchResults: boolean = false
    ): Promise<SourceResult[]> {
        if (depth > 4) return [];

        const $ = cheerio.load(html);
        const results: SourceResult[] = [];
        const directories: { title: string; url: string }[] = [];

        $('#directory-list li').each((_, el) => {
            const dirEntry = $(el).find('a.directory-entry');
            const fileEntry = $(el).find('a.file-entry');

            if (dirEntry.length > 0) {
                const title = dirEntry.text().trim();
                const href = dirEntry.attr('href');
                if (title && href && title !== 'Parent Directory') {
                    directories.push({ title, url: href });
                }
            } else if (fileEntry.length > 0) {
                const title = fileEntry.text().trim();
                const href = fileEntry.attr('href');
                const sizeDom = $(el).find('.size-div').text().trim();
                if (title && href) {
                    const mapped = this.evaluateFile(title, href, sizeDom, tmdbName, tmdbYear, type, id);
                    if (mapped) results.push(mapped);
                }
            }
        });

        if (results.length === 0 && directories.length > 0) {
            for (const dir of directories) {
                let shouldRecurse = false;

                if (isSearchResults) {
                    // ── First level: search results page ──────────────────────────────
                    // We need a strong match against the TMDB name here to avoid
                    // recursing into wrong shows.
                    const score = this.matchScore(dir.title, tmdbName, tmdbYear);
                    this.logger.debug(`Vadapav: search result "${dir.title}" score=${score.toFixed(2)} for "${tmdbName}"`, ctx);
                    if (score >= 0.8) {
                        shouldRecurse = true;
                    }
                } else {
                    // ── Deeper levels: inside a matched show folder ────────────────────
                    // At this point we're already inside the right show folder.
                    // We need to pick the right Season subfolder.

                    if (type === 'movie') {
                        // Movies usually don't have sub-folders, but just in case
                        shouldRecurse = true;
                    } else {
                        const seasonNum = id.season ?? 0;
                        // Match "S01", "Season 1", "The.Bear.S01.1080p", etc.
                        // The \b before (s|season) works when preceded by a dot or space (non-word char).
                        const sMatch = new RegExp(`(?:^|[^a-z0-9])(?:s|season)\\s*0*${seasonNum}(?![0-9])`, 'i');
                        const isSeasonDir = sMatch.test(dir.title);
                        this.logger.info(`Vadapav: season dir check "${dir.title}" season=${seasonNum} -> ${isSeasonDir}`, ctx);
                        shouldRecurse = isSeasonDir;
                    }
                }

                if (shouldRecurse) {
                    const dirUrl = new URL(dir.url, this.baseUrl).href;
                    try {
                        const dirHtml = await this.throttledFetch(ctx, dirUrl);
                        const nested = await this.crawlDirectory(ctx, dirHtml, tmdbName, tmdbYear, type, id, depth + 1, false);
                        results.push(...nested);
                    } catch (e) {
                        this.logger.warn(`Vadapav: Failed recursion into ${dirUrl}: ${e}`, ctx);
                    }
                }
            }
        }

        return results;
    }

    private evaluateFile(
        fileTitle: string,
        fileHref: string,
        sizeDom: string,
        tmdbName: string,
        tmdbYear: number,
        type: ContentType,
        id: Id
    ): SourceResult | null {
        const lower = fileTitle.toLowerCase();
        const isMkv = lower.endsWith('.mkv');
        const isMp4 = lower.endsWith('.mp4');
        if (!isMkv && !isMp4) return null;

        const cTitle = this.clean(fileTitle);

        if (type === 'movie') {
            const cName = this.clean(tmdbName);
            if (!cTitle.includes(cName)) return null;
            if (tmdbYear && !cTitle.includes(tmdbYear.toString())) return null;
        } else if (type === 'series') {
            const sNum = parseInt(id.season?.toString() || '0', 10);
            const eNum = parseInt(id.episode?.toString() || '0', 10);

            const seRegex = new RegExp(`s0*${sNum}e0*${eNum}(?![0-9])`, 'i');
            const sxRegex = new RegExp(`(?<![0-9])0*${sNum}x0*${eNum}(?![0-9])`, 'i');
            const hasExplicitEpCode = seRegex.test(fileTitle) || sxRegex.test(fileTitle);

            if (hasExplicitEpCode) {
                // Explicit S01E01 code matched. To avoid penalizing the episode title (which comes after)
                // but still strictly reject wrong shows (e.g. "Star Trek Voyager" instead of "Lower Decks"),
                // we chop the filename at the episode tag and strictly score the prefix.
                const epTagRegex = new RegExp(`(?:^|[^a-z0-9])(?:s0*${sNum}e0*${eNum}|0*${sNum}x0*${eNum})(?![0-9])`, 'i');
                const tagMatch = fileTitle.match(epTagRegex);
                const showPrefix = tagMatch ? fileTitle.substring(0, tagMatch.index) : fileTitle;

                const cleanedPrefix = this.stripReleaseTags(showPrefix);
                const nameToks = this.tokens(tmdbName);
                const fileToks = this.tokens(cleanedPrefix);

                const nameHits = nameToks.filter(t => fileToks.includes(t)).length;
                const nameCoverage = nameHits / (nameToks.length || 1);

                // Allow year in prefix just in case it wasn't fully stripped
                const allowedFileToks = new Set([...nameToks, tmdbYear?.toString()]);
                const extraFileToks = fileToks.filter(t => !allowedFileToks.has(t)).length;
                const fileMatchScore = Math.max(0, nameCoverage - extraFileToks * 0.35);

                if (fileMatchScore < 0.8) return null;
            } else {
                // No explicit episode code — need strict name match + bare episode fallback.
                // Block if a DIFFERENT explicit SxxExx is present.
                if (/s\d+e\d+/i.test(fileTitle) || /(?<![0-9])\d+x\d+(?![0-9])/i.test(fileTitle)) {
                    return null;
                }
                // Strict name matching with token penalty (prevents false-title leakage)
                const cleanedFileTitle = this.stripReleaseTags(fileTitle);
                const nameToks = this.tokens(tmdbName);
                const fileToks = this.tokens(cleanedFileTitle);
                const nameHits = nameToks.filter(t => fileToks.includes(t)).length;
                const nameCoverage = nameHits / (nameToks.length || 1);
                const allowedFileToks = new Set([...nameToks, id.season?.toString(), id.episode?.toString(), 'season', 'ep', 'episode']);
                const extraFileToks = fileToks.filter(t => !allowedFileToks.has(t)).length;
                const fileMatchScore = Math.max(0, nameCoverage - extraFileToks * 0.35);
                if (fileMatchScore < 0.8) return null;
                // Bare episode fallback: require explicit ep/episode prefix
                const bareEpRegex = new RegExp(`(?:ep|episode)[.\\s-]*0*${eNum}(?![0-9])`, 'i');
                if (!bareEpRegex.test(fileTitle)) return null;
            }
        }

        return this.buildSourceResult(fileTitle, fileHref, sizeDom);
    }

    private buildSourceResult(fileTitle: string, fileHref: string, sizeDom: string): SourceResult {
        const finalUrl = new URL(fileHref, this.baseUrl).href;
        const height = findHeight(fileTitle);

        const formatRegex = /(remux|x265|hevc|hdr|10-bit|10bit|sdr|avc|h264|h265|dts-hd|dts|hd-ma|dd\+?5\.1|bluray|web-dl|webrip)/ig;
        const metadataMatches = fileTitle.match(formatRegex);
        const tagStr = metadataMatches ? ` - ${Array.from(new Set(metadataMatches.map(t => t.toUpperCase()))).join(' | ')}` : '';

        const resBadge = height ? getClosestResolution(height) : 'Unknown';
        const sizeBadge = sizeDom && sizeDom !== '0 bytes' ? `⬇️ ${sizeDom}` : '';

        const relayHost = 'http://127.0.0.1:51546';
        const relay = new URL(`/relay/${encodeURIComponent(fileTitle)}`, relayHost);
        relay.searchParams.set('url', finalUrl);
        relay.searchParams.set('referer', this.baseUrl);

        return {
            url: relay,
            notWebReady: false,
            meta: {
                title: `[Vadapav] ${resBadge}${tagStr} ${sizeBadge}\n${fileTitle}`.trim(),
                ...(height && { height }),
                sourceLabel: 'vadapav',
                countryCodes: this.countryCodes,
            },
        } as SourceResult;
    }
}
