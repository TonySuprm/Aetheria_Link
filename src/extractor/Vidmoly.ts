import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher, supportsMediaFlowProxy } from '../utils';
import { Extractor } from './Extractor';
import winston from 'winston';

export class Vidmoly extends Extractor {
    public override readonly id = 'vidmoly';
    public override readonly label = 'Vidmoly';

    public constructor(fetcher: Fetcher, logger: winston.Logger) {
        super(fetcher, logger);
    }

    public override supports(_ctx: Context, url: URL): boolean {
        return url.host.includes('vidmoly');
    }

    protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
        const embedHtml = await this.fetcher.text(ctx, url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': meta.referer ?? url.href,
            },
        });

        // Vidmoly embed pages contain file:"https://...m3u8..."
        const playlistMatch = embedHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);

        if (!playlistMatch) {
            this.logger.warn(`[Vidmoly] No playlist URL found on ${url.href}`);
            return [];
        }

        const videoUrl = new URL(playlistMatch[1] as string);

        let targetUrl = videoUrl;

        try {
            // Attempt to dynamically resolve the highest resolution array to force 1080p
            const playlistSrc = await this.fetcher.text(ctx, videoUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': url.href,
                }
            });

            const resolutions = [...playlistSrc.matchAll(/#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+)x(\d+)[\s\S]*?(https?:\/\/[^\s]+)/g)];
            if (resolutions.length > 0) {
                resolutions.sort((a, b) => {
                    const widthA = parseInt(a[1] as string, 10);
                    const widthB = parseInt(b[1] as string, 10);
                    return widthB - widthA;
                });

                // Provide the highest quality directly, prioritizing 1080p
                const topRes = resolutions[0] as RegExpMatchArray;
                targetUrl = new URL(topRes[3] as string);
                this.logger.debug(`[Vidmoly] Resolved Max Quality Variant (${topRes[1]}x${topRes[2]}): ${targetUrl.href}`);
            }
        } catch (e) {
            this.logger.warn(`[Vidmoly] Failed to iterate dynamic variant resolutions: ${e}`);
        }

        // If MediaFlow proxy is available, proxy the direct m3u8 to add headers
        if (supportsMediaFlowProxy(ctx)) {
            const proxyUrl = ctx.config.mediaFlowProxyUrl?.replace(/^https?:\/\//, '') ?? '';
            const protocol = ctx.config.mediaFlowProxyUrl?.startsWith('https://') ? 'https:' : 'http:';
            const proxyStreamUrl = new URL('/proxy/stream', `${protocol}//${proxyUrl}`);
            if (ctx.config.mediaFlowProxyPassword) {
                proxyStreamUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
            }
            proxyStreamUrl.searchParams.append('d', targetUrl.href);
            proxyStreamUrl.searchParams.append('h_referer', url.href);
            proxyStreamUrl.searchParams.append('h_origin', url.origin);

            return [{
                url: proxyStreamUrl,
                format: Format.hls,
                label: 'Vidmoly (Max Qual)',
                meta: meta,
            }];
        }

        // Fallback: return the direct URL
        return [{
            url: targetUrl,
            format: Format.hls,
            label: 'Vidmoly (Max Qual)',
            meta: meta,
        }];
    }
}
