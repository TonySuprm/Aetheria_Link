import { Page } from 'puppeteer';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id, puppeteerFetch } from '../utils';
import { Source, SourceResult } from './Source';
import winston from 'winston';

export class KissKh extends Source {
    public override readonly id = 'kisskh';
    public override readonly label = 'KissKH';
    public override readonly baseUrl = 'https://kisskh.do';
    public override readonly contentTypes: ContentType[] = ['movie', 'series'];
    public override readonly countryCodes: CountryCode[] = [CountryCode.multi];

    private readonly fetcher: Fetcher;
    private readonly logger = winston.createLogger({ transports: [new winston.transports.Console()] });

    public constructor(fetcher: Fetcher) {
        super();
        this.fetcher = fetcher;
    }

    public override async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
        const tmdbId = await getTmdbId(ctx, this.fetcher, id) as any;
        const [name] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
        if (!name) {
            return [];
        }

        let foundDramaId: number | null = null;
        let foundDramaTitle: string | null = null;

        try {
            const searchUrl = new URL(`/api/DramaList/Search?q=${encodeURIComponent(name)}`, this.baseUrl);
            const searchJson = await this.fetcher.json(ctx, searchUrl) as { id: number, title: string }[];

            if (searchJson) {
                const firstMatch = searchJson[0];
                if (firstMatch) {
                    foundDramaId = firstMatch.id;
                    foundDramaTitle = firstMatch.title;
                }
            }
        } catch (e) {
            this.logger.warn(`[KissKh] Search failed: ${e}`);
        }

        if (!foundDramaId) {
            return [];
        }

        try {
            const s = tmdbId.season;
            const e = tmdbId.episode;

            const infoUrl = new URL(`/api/DramaList/Drama/${foundDramaId}?isq=false`, this.baseUrl);
            const infoJson = await this.fetcher.json(ctx, infoUrl) as { episodes?: { id: number, number: number }[] };

            let epId: number | null = null;
            if (type === 'movie') {
                epId = infoJson.episodes?.[0]?.id ?? null;
            } else if (s && e) {
                const targetEp = typeof e === 'string' ? parseInt(e, 10) : e;
                const epMatch = infoJson.episodes?.find((ep: { id: number, number: number }) => ep.number === targetEp);
                epId = epMatch?.id ?? null;
            }

            if (!epId) {
                return [];
            }

            let m3u8Url: string | null = null;
            const parsedTitle = foundDramaTitle?.replace(/([^a-zA-Z0-9]+)/g, '-') || 'Show';
            const episodePageUrl = new URL(`/Drama/${parsedTitle}/Episode-${e || 1}?id=${foundDramaId}&ep=${epId}&pn=1`, this.baseUrl);

            this.logger.info(`[KissKh] Extracting Stream tokens securely via Puppeteer context: ${episodePageUrl.href}`, ctx);

            await puppeteerFetch(this.logger, episodePageUrl.href, {
                waitUntil: 'networkidle2',
                timeout: 25000,
                evaluate: async (page: Page) => {
                    page.on('response', async res => {
                        if (res.url().includes('/api/DramaList/Episode/') && res.url().includes('.png') && res.url().includes('kkey=')) {
                            try {
                                const text = await res.text();
                                const json = JSON.parse(text);
                                if (json.Video) {
                                    m3u8Url = json.Video;
                                }
                            } catch (err) { }
                        }
                    });
                    await new Promise(r => setTimeout(r, 6000));
                    return m3u8Url || '';
                }
            });

            if (!m3u8Url) {
                this.logger.warn(`[KissKh] Failed to capture embedded m3u8 mapping from XHR buffers natively.`);
                return [];
            }

            return [{
                url: new URL(m3u8Url),
                meta: { title: `${name}`, countryCodes: this.countryCodes }
            }];
        } catch (err) {
            this.logger.warn(`[KissKh] Error fetching episodes: ${err}`);
            return [];
        }
    }
}
