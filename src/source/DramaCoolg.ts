import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

export class DramaCoolg extends Source {
    public override readonly id = 'dramacoolg';
    public override readonly label = 'DramaCoolg';

    public override readonly contentTypes: ContentType[] = ['movie', 'series'];
    public override readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.ko, CountryCode.ja, CountryCode.zh];
    public override readonly baseUrl = 'https://dramacoolg.top';
    public override readonly category = 'asiandrama' as const;

    private readonly fetcher: Fetcher;

    public constructor(fetcher: Fetcher) {
        super();
        this.fetcher = fetcher;
    }

    public override async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
        const tmdbId = await getTmdbId(ctx, this.fetcher, id);
        const [name] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);

        if (!name) return [];

        try {
            // 1. Search for the drama
            const searchUrl = new URL(this.baseUrl);
            searchUrl.searchParams.set('s', name);

            const searchHtml = await this.fetcher.text(ctx, searchUrl, { noProxyHeaders: true });
            const $ = cheerio.load(searchHtml);

            // Find drama-detail links from search results
            const detailLinks: string[] = [];
            $('a[href*="/drama-detail/"]').each((_, el) => {
                const href = $(el).attr('href');
                if (href && !detailLinks.includes(href)) {
                    detailLinks.push(href);
                }
            });

            if (detailLinks.length === 0) return [];

            // Pick the best-matching drama-detail link
            const searchName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            let bestDetail = detailLinks[0]!;
            for (const link of detailLinks) {
                const slug = link.split('/drama-detail/')[1]?.replace(/\/$/, '') ?? '';
                if (slug.includes(searchName) || searchName.includes(slug.replace(/-\d{4}$/, ''))) {
                    bestDetail = link;
                    break;
                }
            }

            // 2. Fetch the drama-detail page to find episode links
            const detailUrl = new URL(bestDetail, this.baseUrl);
            const detailHtml = await this.fetcher.text(ctx, detailUrl, {
                noProxyHeaders: true,
                validateStatus: () => true,
            });
            const $detail = cheerio.load(detailHtml);

            const targetEpNumber = tmdbId.episode || 1;

            // Find episode links matching the target episode number
            const episodeLinks: string[] = [];
            $detail(`a[href*="-episode-${targetEpNumber}/"], a[href*="-episode-${targetEpNumber}"]`).each((_, el) => {
                const href = $detail(el).attr('href');
                if (href && href.includes(`-episode-${targetEpNumber}`)) {
                    // Ensure exact episode match (e.g. episode-1 should not match episode-10)
                    const epMatch = href.match(/-episode-(\d+)/);
                    if (epMatch && parseInt(epMatch[1]!, 10) === targetEpNumber) {
                        episodeLinks.push(href);
                    }
                }
            });

            if (episodeLinks.length === 0) return [];

            // 3. Fetch the episode page and extract embeds
            const episodeUrl = new URL(episodeLinks[0]!, this.baseUrl);
            const episodeHtml = await this.fetcher.text(ctx, episodeUrl, {
                noProxyHeaders: true,
                validateStatus: () => true,
            });
            const $ep = cheerio.load(episodeHtml);

            const iframeSrcs: string[] = [];

            // Collect all iframe sources
            $ep('iframe').each((_, el) => {
                const src = $ep(el).attr('src')?.trim();
                if (src) iframeSrcs.push(src);
            });

            // Also collect data-src attributes
            $ep('[data-src], [data-url], [data-video]').each((_, el) => {
                const d = ($ep(el).attr('data-src') || $ep(el).attr('data-url') || $ep(el).attr('data-video'))?.trim();
                if (d && d.includes('http')) iframeSrcs.push(d);
            });

            // 4. Resolve embedload.cfd wrapper to the inner embed URL
            const results: SourceResult[] = [];

            for (const iframeSrc of iframeSrcs) {
                try {
                    const iframeUrl = iframeSrc.startsWith('//') ? `https:${iframeSrc}` : iframeSrc;

                    if (iframeUrl.includes('embedload.cfd') || iframeUrl.includes('embedload.')) {
                        // Resolve the embedload wrapper to get the inner embed
                        const embedHtml = await this.fetcher.text(ctx, new URL(iframeUrl), {
                            noProxyHeaders: true,
                            headers: { 'Referer': episodeUrl.href },
                            validateStatus: () => true,
                        });
                        const $embed = cheerio.load(embedHtml);

                        $embed('iframe').each((_, el) => {
                            const innerSrc = $embed(el).attr('src')?.trim();
                            if (innerSrc && innerSrc.includes('http')) {
                                results.push({
                                    url: new URL(innerSrc),
                                    meta: {
                                        title: name,
                                        referer: iframeUrl,
                                        countryCodes: this.countryCodes,
                                    },
                                });
                            }
                        });
                    } else {
                        // Direct embed URL (dramacool.men etc.)
                        results.push({
                            url: new URL(iframeUrl),
                            meta: {
                                title: name,
                                referer: episodeUrl.href,
                                countryCodes: this.countryCodes,
                            },
                        });
                    }
                } catch { /* ignore individual iframe failures */ }
            }

            // Deduplicate by URL
            const seen = new Set<string>();
            return results.filter(r => {
                const key = r.url.href;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        } catch {
            return [];
        }
    }
}
