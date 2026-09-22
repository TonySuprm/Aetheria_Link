import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Extractor } from './Extractor';

export class Dailymotion extends Extractor {
    public readonly id = 'dailymotion';
    public readonly label = 'Dailymotion';
    public readonly priority = 100;

    public override supports(_ctx: Context, url: URL): boolean {
        return url.host === 'dailymotion.com' || url.host.endsWith('.dailymotion.com');
    }

    protected async extractInternal(_ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
        // Supports two embed URL formats:
        // 1. https://www.dailymotion.com/embed/video/k7133hvHZxDpfYzvB2Y  (pathname)
        // 2. https://geo.dailymotion.com/player/xcj74.html?video=k40MI8zCxufuLTCiYSQ  (query param)
        let videoId = url.pathname.match(/\/video\/([a-zA-Z0-9_-]+)/)?.[1];
        if (!videoId) {
            videoId = url.searchParams.get('video') || undefined;
        }
        if (!videoId) {
            return [];
        }

        // Return the canonical Dailymotion video page URL for yt-dlp.
        //
        // The Dailymotion metadata API (https://www.dailymotion.com/player/metadata/...)
        // returns HLS manifest URLs from cdndirector.dailymotion.com. However, these
        // are served behind Cloudflare and return HTTP 403 for non-browser HTTP clients
        // including mpv/ffmpeg. yt-dlp has its own Cloudflare-aware HTTP client and
        // Dailymotion authentication logic that generates fresh, valid CDN tokens.
        //
        // Since mpv has ytdl=yes, it delegates to yt-dlp for dailymotion.com/video/
        // URLs automatically — this is the same pattern that makes Animexin's
        // Dailymotion links work.
        return [{
            url: new URL(`https://www.dailymotion.com/video/${videoId}`),
            format: Format.hls,
            meta: { ...meta },
        }];
    }
}
