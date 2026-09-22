import https from 'node:https';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Extractor } from './Extractor';

export class Rumble extends Extractor {
  public readonly id = 'rumble';
  public readonly label = 'Rumble';

  public override supports(_ctx: Context, url: URL): boolean {
    return url.host === 'rumble.com' || url.host === 'www.rumble.com';
  }

  private fetchHtmlDirect(url: URL): Promise<{ html: string; status: number }> {
    return new Promise((resolve, reject) => {
      const req = https.get({
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://rumble.com/',
        },
      }, (res) => {
        const status = res.statusCode ?? 0;
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ html: data, status }));
      });
      req.on('error', reject);
      req.setTimeout(12000, () => {
        req.destroy();
        reject(new Error('Rumble direct fetch timeout'));
      });
    });
  }

  protected override async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    try {
      let html = '';
      let httpStatus = 0;
      try {
        html = await this.fetcher.text(ctx, url, {
          noProxyHeaders: true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        httpStatus = 200;
      } catch {
        // Fetcher.text throws on 403 / CF challenge, but Rumble returns the full embed HTML even with 403 status
        const result = await this.fetchHtmlDirect(url);
        html = result.html;
        httpStatus = result.status;
      }

      // 410 Gone = video permanently deleted from Rumble channel. 404 = not found.
      // Return empty so the player never receives a dead embed URL it cannot play.
      if (httpStatus === 410 || httpStatus === 404) {
        this.logger.warn(`Rumble embed ${url.href} returned HTTP ${httpStatus} (deleted) — returning empty`);
        return [];
      }

      if (html) {
        const unescaped = html.split('\\/').join('/');

        // 1. HLS VOD master playlist — HIGHEST PRIORITY.
        // This is a proper multi-bitrate HLS manifest that lists all quality tiers.
        // mpv automatically picks the highest-bandwidth stream from it (4K/2560p first).
        // NOTE: The embed HTML also contains a tiny sprite/thumbnail .mp4 (320x148, ~1.6MB)
        // which is NOT a real video — it must NEVER be selected over HLS.
        const hlsVodMatch = unescaped.match(/(https:[^"'\s\\]+hls-vod[^"'\s\\]+playlist\.m3u8[^"'\s\\]*)/) ||
                            unescaped.match(/(https:[^"'\s\\]+hls-vod[^"'\s\\]+\.m3u8[^"'\s\\]*)/);
        if (hlsVodMatch?.[1]) {
          return [{
            url: new URL(hlsVodMatch[1]),
            format: Format.hls,
            meta: { ...meta },
          }];
        }

        // 2. Chunklist HLS entries sorted by resolution — pick the highest.
        type ChunkEntry = { w: number; h: number; chunkUrl: string };
        const chunkEntries: ChunkEntry[] = [];
        const blockRe = /"tar"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+chunklist[^"]+)"[^}]*\}[^}]*"meta"\s*:\s*\{[^}]*"w"\s*:\s*(\d+)[^}]*"h"\s*:\s*(\d+)/g;
        for (const bm of unescaped.matchAll(blockRe)) {
          const w = parseInt(bm[2] ?? '0', 10);
          const h = parseInt(bm[3] ?? '0', 10);
          if (w > 320 && bm[1]) chunkEntries.push({ w, h, chunkUrl: bm[1] });
        }
        if (chunkEntries.length > 0) {
          chunkEntries.sort((a, b) => b.w - a.w);
          const best = chunkEntries[0]!;
          this.logger.warn(`Rumble: selected chunklist ${best.w}x${best.h}`);
          return [{
            url: new URL(best.chunkUrl),
            format: Format.hls,
            meta: { ...meta },
          }];
        }

        // 3. Any other .m3u8 as final HLS fallback
        const anyHlsMatch = unescaped.match(/"url"\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/);
        const anyHlsUrl = anyHlsMatch?.[1];
        if (anyHlsUrl) {
          return [{
            url: new URL(anyHlsUrl),
            format: Format.hls,
            meta: { ...meta },
          }];
        }

        // 4. MP4 fallback — but exclude the tiny sprite/thumbnail MP4 (size <= 2MB)
        const mp4BlockRe = /"mp4"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+\.mp4[^"]*)"[^}]*\}[^}]*"meta"\s*:\s*\{[^}]*"size"\s*:\s*(\d+)/g;
        let bestMp4: { url: string; size: number } | null = null;
        for (const mm of unescaped.matchAll(mp4BlockRe)) {
          const size = parseInt(mm[2] ?? '0', 10);
          const mpUrl = mm[1];
          if (mpUrl && size > 2_000_000 && (!bestMp4 || size > bestMp4.size)) {
            bestMp4 = { url: mpUrl, size };
          }
        }
        if (bestMp4) {
          return [{
            url: new URL(bestMp4.url),
            format: Format.mp4,
            meta: { ...meta },
          }];
        }
      }
    } catch (e) {
      this.logger.warn(`Rumble extraction failed: ${e}`);
    }

    // Fallback: return original embed url only if we couldn't determine status (network error etc.)
    return [{
      url: new URL(url.href),
      format: Format.unknown,
      meta: { ...meta },
    }];
  }
}
