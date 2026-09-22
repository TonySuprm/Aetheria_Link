import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Extractor } from './Extractor';

export class OkRu extends Extractor {
  public readonly id = 'okru';
  public readonly label = 'OK.ru';

  public override supports(_ctx: Context, url: URL): boolean {
    return url.host === 'ok.ru' || url.host === 'www.ok.ru';
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    try {
      const html = await this.fetcher.text(ctx, url);
      const dataOptsMatch = html.match(/data-options="([^"]+)"/);
      
      if (dataOptsMatch) {
        const decoded = (dataOptsMatch[1] || '')
          .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
          .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        const opts = JSON.parse(decoded);
        let videoMeta = opts?.flashvars?.metadata || opts?.metadata;
        let flashvars = opts?.flashvars || opts;
        
        if (typeof videoMeta === 'string') {
          try { videoMeta = JSON.parse(videoMeta); } catch { }
        }

        // Prefer HLS master playlist for adaptive quality (VLC/MPV compatible)
        const hlsUrl = flashvars?.hlsManifestUrl || videoMeta?.hlsManifestUrl;
        if (hlsUrl) {
          return [{
            url: new URL(hlsUrl),
            format: Format.hls,
            meta: { ...meta },
            requestHeaders: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Referer': 'https://ok.ru/',
            },
          }];
        }

        // Fall back to direct video URLs if HLS isn't available
        const OKRU_QUALITY_RANK: Record<string, number> = { ultra: 8, quad: 7, full: 6, hd: 5, sd: 4, low: 3, lowest: 2, mobile: 1 };
        const videos: { name: string; url: string }[] = videoMeta?.videos || flashvars?.videos || [];
        if (videos.length > 0) {
          const best = videos.sort((a, b) => (OKRU_QUALITY_RANK[b.name] || 0) - (OKRU_QUALITY_RANK[a.name] || 0))[0];
          if (best?.url) {
            return [{
              url: new URL(best.url),
              format: Format.mp4,
              meta: { ...meta },
              requestHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Referer': 'https://ok.ru/',
              },
            }];
          }
        }
      }
    } catch (e) {
      this.logger.warn(`OkRu extraction failed: ${e}`);
    }

    // Fallback: return original embed url if extraction fails
    return [{
      url: new URL(url.href),
      format: Format.unknown,
      meta: { ...meta },
    }];
  }
}
