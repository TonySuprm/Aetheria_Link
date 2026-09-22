import { Context, CountryCode, Format, InternalUrlResult, Meta } from '../types';
import { Extractor } from './Extractor';

export class MovieBox extends Extractor {
  public readonly id = 'moviebox';

  public readonly label = 'MovieBox';

  public override readonly ttl: number = 10800000; // 3h

  public supports(_ctx: Context, url: URL): boolean {
    return url.host === 'themoviebox.org' && url.href.includes('/moviesDetail/');
  }

  private deflattenNuxt(payload: string): any[] {
    try {
      const rawData = JSON.parse(payload);
      if (!Array.isArray(rawData)) return [rawData];

      function resolve(index: number, seen = new Set<number>()): any {
        if (index === null || index === undefined || typeof index !== 'number' || index < 0 || index >= rawData.length) return index;
        if (seen.has(index)) return `[Circular Ref: ${index}]`;

        const val = rawData[index];
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null) return val;

        if (Array.isArray(val)) {
          seen.add(index);
          const res = val.map(v => typeof v === 'number' ? resolve(v, new Set(seen)) : v);
          seen.delete(index);
          return res;
        }

        if (typeof val === 'object') {
          seen.add(index);
          const obj: any = {};
          for (const [k, v] of Object.entries(val)) {
            obj[k] = typeof v === 'number' ? resolve(v, new Set(seen)) : v;
          }
          seen.delete(index);
          return obj;
        }
        return val;
      }

      return rawData.map((_, i) => resolve(i));
    } catch {
      return [];
    }
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const html = await this.fetcher.text(ctx, url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!html) return [];

    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    const payloadHtml = scripts.find(s => s[1]?.includes('videoAddress'));
    if (!payloadHtml || !payloadHtml[1]) return [];

    const deflattened = this.deflattenNuxt(payloadHtml[1]);

    // Locate the videoAddress root node (usually one object representing the stream container)
    const videoRefs = deflattened.filter(x => typeof x === 'object' && x !== null && x.videoAddress);
    if (videoRefs.length === 0) return [];

    const results: InternalUrlResult[] = [];
    const countryCodeArray = meta.countryCodes ?? [CountryCode.multi];

    // Iterate over everything that was matched
    for (const ref of videoRefs) {
      if (!ref.videoAddress) continue;

      const v = ref.videoAddress;
      if (!v.url) continue;

      const streamUrl = new URL(v.url);
      const isHls = streamUrl.href.includes('.m3u8');
      const isMp4 = streamUrl.href.includes('.mp4');
      const format = isHls ? Format.hls : isMp4 ? Format.mp4 : Format.unknown;

      const resolution = v.width || 0;
      const sizeBytes = v.size ? parseInt(v.size, 10) : undefined;
      const height = v.height || 0; // standard 1080/720 marker

      results.push({
        url: streamUrl,
        format,
        label: height ? `${height}p` : `${resolution}w`,
        requestHeaders: { Referer: 'https://themoviebox.org/' },
        meta: {
          ...meta,
          countryCodes: countryCodeArray,
          height: height || undefined,
          bytes: sizeBytes || undefined,
        },
      });
    }

    return results;
  }
}

