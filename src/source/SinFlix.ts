import { Mutex } from 'async-mutex';
import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, findHeight, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

import * as levenshtein from 'fast-levenshtein';

// Strip punctuation but keep spaces for robust matching
export function normalize(str: string): string {
    return str.toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const RENTRY_URL = 'https://rentry.co/sin-flix';
const RENTRY_TTL = 6 * 60 * 60 * 1000; // 6h cache

let cachedCatalog: { entries: SinFlixEntry[]; ts: number } | undefined;
const catalogMutex = new Mutex();

interface SinFlixEntry {
    title: string;
    year?: number;
    quality: string;
    linkSegment: string; // The raw ID or url (e.g. 12 char ID or paste URL)
    isShortId: boolean;
}

/** Matches typical SinFlix entry: "Title [Quality] (ep info) - ID_OR_URL" */
const ENTRY_RE = /^(.*?)\s*(?:\((\d{4})\))?\s*\[(.*?)\]\s*(?:\([^)]+\))?\s*-\s*(.+)$/;
/** Episode tag inside a filename, e.g. "[E05]", ".E05.", or "E005" */
const EPISODE_TAG_RE = /(?:^|[\[\s.\_-])[eE]0*(\d+)/i;

export class SinFlix extends Source {
    public override readonly id = 'sinflix';
    public override readonly label = 'SinFlix';
    public override readonly contentTypes: ContentType[] = ['movie', 'series'];
    // SinFlix features mostly Asian dramas
    public override readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.ko, CountryCode.zh, CountryCode.ja, CountryCode.th, CountryCode.id];
    public override readonly baseUrl = RENTRY_URL;

    private readonly fetcher: Fetcher;

    public constructor(fetcher: Fetcher) {
        super();
        this.fetcher = fetcher;
    }

    public override async prewarm(ctx: Context): Promise<void> {
        try {
            await this.fetcher.text(ctx, new URL(this.baseUrl));
            this.fetcher.getLogger().info('SinFlix: pre-warm complete', ctx);
        } catch (error) {
            this.fetcher.getLogger().warn(`SinFlix: pre-warm failed: ${error}`, ctx);
        }
    }

    public override async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
        const tmdbId = await getTmdbId(ctx, this.fetcher, id);
        const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);

        if (!name) return [];

        const entries = await this.getCatalog(ctx);
        if (entries.length === 0) return [];

        const nameSlug = normalize(name);
        const results: SourceResult[] = [];

        // Find all entries that match the title
        for (const entry of entries) {
            if (!this.isTitleMatch(normalize(entry.title), nameSlug)) {
                continue;
            }

            if (entry.year && year && entry.year !== year && Math.abs(entry.year - year) > 1) {
                continue; // Loose year match
            }

            const quality = entry.quality;

            // Detect buzzheavier: either a bare 12-char ID or a full buzzheavier/fuckingfast URL
            const isBuzzheavier = entry.isShortId
                || entry.linkSegment.includes('buzzheavier.com')
                || entry.linkSegment.includes('fuckingfast.');

            if (isBuzzheavier) {
                // Build the URL: either from the shortId or use the full URL directly
                const buzzheavierUrl = entry.isShortId
                    ? `https://buzzheavier.com/${entry.linkSegment}`
                    : entry.linkSegment.trim();
                try {
                    results.push({
                        url: new URL(buzzheavierUrl),
                        meta: {
                            title: `${entry.title} [${quality}]`,
                            bytes: 0,
                            height: findHeight(quality),
                            countryCodes: this.countryCodes,
                            season: tmdbId.season,
                            episode: tmdbId.episode,
                        }
                    });
                } catch (err) {
                    this.fetcher.getLogger().info(`URL Parse Error for Buzzheavier: ${buzzheavierUrl}`, ctx);
                }
            } else if (entry.linkSegment.includes('pst.moe') || entry.linkSegment.includes('rentry.co')) {
                const rawParts = entry.linkSegment.split('|');
                for (const urlStr of rawParts) {
                    const cleanUrl = urlStr.trim();
                    if (!cleanUrl) continue;
                    try {
                        const pasteText = await this.fetcher.text(ctx, new URL(cleanUrl));
                        const pasteLines = pasteText.split('\n');
                        for (const pline of pasteLines) {
                            if (!pline.includes(' - http')) continue;
                            const pMatch = pline.match(/^(.*?)\s*(?:\[[^\]]+\])?\s*-\s*(https?:\/\/.+?)(?:\s|$)/);
                            if (pMatch) {
                                const fname = pMatch[1]!.trim();
                                const link = pMatch[2]!.trim();
                                this.processFileResult(results, fname, link, quality, tmdbId);
                            }
                        }
                    } catch (error) {
                        this.fetcher.getLogger().warn(`SinFlix: Failed to scrape paste ${cleanUrl}: ${error}`, ctx);
                    }
                }
            } else if (entry.linkSegment.includes('pixeldrain.com')) {
                this.processFileResult(results, entry.title, entry.linkSegment.split('|')[0]!.trim(), quality, tmdbId, true);
            } else if (entry.linkSegment.startsWith('http')) {
                // Catch-all: any other full URL (mega.nz, krakenfiles, etc.)
                try {
                    results.push({
                        url: new URL(entry.linkSegment.trim()),
                        meta: {
                            title: `${entry.title} [${quality}]`,
                            bytes: 0,
                            height: findHeight(quality),
                            countryCodes: this.countryCodes,
                            season: tmdbId.season,
                            episode: tmdbId.episode,
                        }
                    });
                } catch { }
            }
        }

        this.fetcher.getLogger().info(`SinFlix: returning ${results.length} result(s) for "${name}"`, ctx);
        return results;
    }

    private processFileResult(results: SourceResult[], fname: string, url: string, quality: string, tmdbId: any, isDirect: boolean = false) {
        let fileMatches = false;
        if (tmdbId.season !== undefined) {
            const tag = fname.match(EPISODE_TAG_RE);
            if (tag && tag[1] && parseInt(tag[1], 10) === tmdbId.episode) {
                fileMatches = true;
            } else if (isDirect && !tag) {
                // If rentry lists a direct Pixeldrain link but doesn't specify filename, we blindly include it
                // This can cause problems for entire series folders, but for now we fallback.
                fileMatches = true;
            }
        } else {
            fileMatches = true; // Movie -> include everything
        }

        if (fileMatches) {
            results.push({
                url: new URL(url),
                meta: {
                    title: `${fname} [${quality}]`,
                    bytes: 0,
                    height: findHeight(fname) ?? findHeight(quality),
                    countryCodes: this.countryCodes,
                    season: tmdbId.season,
                    episode: tmdbId.episode,
                }
            });
        }
    }

    private isTitleMatch(a: string, b: string): boolean {
        if (a === b) return true;

        // Strict word-boundary prefix: e.g. Entry is "The Boy Season 1", query is "The Boy"
        if (a.startsWith(b + ' ')) {
            const remainder = a.slice(b.length + 1).trim();
            if (/^(season|s\d|part|vol|complete|uncut|theatrical|extended|director|ep|episode|\d|movie)/.test(remainder)) {
                return true;
            }
        }

        // Distance check for minor typos or single character differences (e.g. spelling errors on Rentry)
        if (a.length > 5 && b.length > 5) {
            const distance = levenshtein.get(a, b);
            if (distance <= 2) return true;
        }

        return false;
    }

    private async getCatalog(ctx: Context): Promise<SinFlixEntry[]> {
        if (cachedCatalog && Date.now() - cachedCatalog.ts < RENTRY_TTL) {
            return cachedCatalog.entries;
        }

        return catalogMutex.runExclusive(async () => {
            /* istanbul ignore next */
            if (cachedCatalog && Date.now() - cachedCatalog.ts < RENTRY_TTL) {
                return cachedCatalog.entries;
            }

            let text = '';
            try {
                text = await this.fetcher.text(ctx, new URL(RENTRY_URL), { timeout: 30000 });
            } catch (error) {
                this.fetcher.getLogger().warn(`SinFlix: failed to fetch catalog: ${error}`, ctx);
                return cachedCatalog?.entries ?? [];
            }

            const entries: SinFlixEntry[] = [];
            const $ = cheerio.load(text);
            const articleHtml = $('article').html() || '';
            const lines = articleHtml.split(/<br\s*\/?>|\n|<\/?p>/i).map(l => cheerio.load(l).text().trim()).filter(Boolean);

            for (const line of lines) {
                if (!line.includes(' - ')) continue;
                const match = line.trim().match(ENTRY_RE);
                if (match) {
                    let [, titleStr, yearStr, quality, linkPart] = match;
                    if (titleStr && linkPart) {
                        // Remove (reup) prefixes
                        titleStr = titleStr.replace(/^\(reup\)\s*/i, '');
                        const isShortId = /^[a-z0-9]{12}$/.test(linkPart.trim());
                        entries.push({
                            title: titleStr.trim(),
                            ...(yearStr ? { year: parseInt(yearStr, 10) } : {}),
                            quality: quality?.trim() ?? '',
                            linkSegment: linkPart.trim(),
                            isShortId
                        });
                    }
                }
            }

            this.fetcher.getLogger().info(`SinFlix: parsed ${entries.length} items from catalog`, ctx);
            cachedCatalog = { entries, ts: Date.now() };
            return entries;
        });
    }
}
