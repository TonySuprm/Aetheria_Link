import winston from 'winston';
import * as cheerio from 'cheerio';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher } from '../utils';
import { Extractor } from './Extractor';

export class Buzzheavier extends Extractor {
    public override readonly id = 'buzzheavier';
    public override readonly label = 'Buzzheavier';
    public override readonly lazyExtract = true;

    public constructor(fetcher: Fetcher, logger: winston.Logger) {
        super(fetcher, logger);
    }

    public override supports(_ctx: Context, url: URL): boolean {
        return /buzzheavier\.com|fuckingfast\.net|bzzhr\.co|buzzheavier\.co/.test(url.host);
    }

    protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
        // 1. Fetch the page (cloudflare handled by Fetcher)
        const html = await this.fetcher.text(ctx, url);

        const $ = cheerio.load(html);
        let targetDownloadPath: string | null = null;
        let fileTitle = meta.title ?? this.label;

        // Determine episode tag matcher if this is a series
        const EPISODE_TAG_RE = /[.\s_-][eE]0*(\d+)/i;

        let foundFiles = 0;
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            const fname = $(el).text().trim();
            if (href && /^\/[a-z0-9]{12}$/.test(href) && fname.length > 5 && !href.includes('pricing')) {
                foundFiles++;
                if (meta.season !== undefined && meta.episode !== undefined) {
                    const tag = fname.match(EPISODE_TAG_RE);
                    if (tag && tag[1] && parseInt(tag[1], 10) === meta.episode) {
                        targetDownloadPath = href;
                        fileTitle = fname;
                    }
                } else {
                    // Movie fallback or single file directory
                    if (!targetDownloadPath) {
                        targetDownloadPath = href;
                        fileTitle = fname;
                    }
                }
            }
        });

        // 2. Locate the download endpoint hx-get attribute
        let downloadPath: string | null = null;

        if (targetDownloadPath && foundFiles > 0) {
            // We are looking at a directory page and we found a matching file link
            // We need to fetch THAT specific file page to get its hx-get download endpoint!
            const fileHtml = await this.fetcher.text(ctx, new URL(`https://buzzheavier.com${targetDownloadPath}`));
            const fileMatch = fileHtml.match(/hx-get=["'](\/[^/]+\/download\?t=[^"']+)["']/i);
            downloadPath = fileMatch?.[1] ?? null;
            if (!downloadPath) {
                const copyMatch = fileHtml.match(/copyDownloadLink\(['"](\/[^/]+\/download\?t=[^"']+)['"]\)/i);
                downloadPath = (copyMatch?.[1] ?? '').replace(/\\/g, '') || null;
            }
        } else {
            // We are likely ALREADY on a specific file page OR it's a legacy single file format
            const downloadMatch = html.match(/hx-get=["'](\/[^/]+\/download\?t=[^"']+)["']/i);
            downloadPath = downloadMatch?.[1] ?? null;

            if (!downloadPath) {
                const copyMatch = html.match(/copyDownloadLink\(['"](\/[^/]+\/download\?t=[^"']+)['"]\)/i);
                downloadPath = (copyMatch?.[1] ?? '').replace(/\\/g, '') || null;
            }
        }

        if (!downloadPath) {
            return [];
        }

        // 3. Resolve the redirect url
        const downloadUrl = new URL(downloadPath, url.origin);
        const finalUrl = await this.fetcher.getFinalRedirectUrl(ctx, downloadUrl);

        return [{
            url: finalUrl,
            format: Format.unknown,
            label: this.label,
            meta: {
                ...meta,
                title: fileTitle,
                extractorId: this.id,
                referer: url.origin + '/',
            },
            requestHeaders: { Referer: url.origin + '/' },
        }];
    }
}
