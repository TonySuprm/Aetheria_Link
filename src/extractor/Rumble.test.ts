import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { Rumble } from './Rumble';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new Rumble(new FetcherMock(`${__dirname}/__fixtures__/Rumble`), logger)]);

const ctx = createTestContext({ mediaFlowProxyUrl: 'https://mediaflow.test.org', mediaFlowProxyPassword: 'test' });

/**
 * Rumble streams resolve through the MediaFlow Proxy so the result is playable by normal players
 * (libvlc/mpv/Stremio-native) that cannot send the custom UA/Referer headers Rumble's CDN
 * expects. Every resolved path (HLS VOD master, chunklist, generic m3u8, direct mp4) is handed to
 * the MFP HLS / stream proxy, which injects the headers and rewrites all URLs.
 */
describe('Rumble', () => {
  test('prefers the HLS VOD master playlist and routes it through the MFP HLS proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://rumble.com/va1hlm/test.html'));

    expect(results).toHaveLength(1);
    const result = assertSingle(results);
    expect(result.format).toBe('hls');
    expect(result.label).toBe('Rumble (MFP)');

    const url = new URL(result.url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    expect(url.searchParams.get('api_password')).toBe('test');
    expect(url.searchParams.get('h_referer')).toBe('https://rumble.com/');
    expect(url.searchParams.get('d')).toBe('https://mrumble.com/video/abc123/hls-vod/master/playlist.m3u8');
  });

  test('selects the highest-resolution chunklist and routes it through the MFP HLS proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://rumble.com/va2chl/test.html'));

    expect(results).toHaveLength(1);
    const result = assertSingle(results);
    expect(result.format).toBe('hls');
    const url = new URL(result.url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    // 1280x720 beats 640x360.
    expect(url.searchParams.get('d')).toBe('https://cdn.rumble.com/videos/xyz/chunklist/hd.m3u8');
  });

  test('falls back to any .m3u8 and routes it through the MFP HLS proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://rumble.com/va3any/test.html'));

    expect(results).toHaveLength(1);
    expect(assertSingle(results).format).toBe('hls');
    const url = new URL(assertSingle(results).url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    expect(url.searchParams.get('d')).toBe('https://cdn.rumble.com/videos/pqr/stream/variant.m3u8');
  });

  test('falls back to the direct mp4 and routes it through the MFP stream proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://rumble.com/va4mp4/test.html'));

    expect(results).toHaveLength(1);
    const result = assertSingle(results);
    expect(result.format).toBe('mp4');
    const url = new URL(result.url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/stream');
    expect(url.searchParams.get('h_referer')).toBe('https://rumble.com/');
    expect(url.searchParams.get('d')).toBe('https://cdn.rumble.com/videos/def/video/hd.mp4');
  });

  test('returns empty when no stream is found on the page', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://rumble.com/va5none/test.html'))).toEqual([]);
  });

  // The `.error` fixtures make FetcherMock throw, exercising the direct-https fallback. The live
  // https.get inside fetchHtmlDirect is spied on (it is istanbul-ignored) so no real network is hit.
  test('falls back to direct https, and returns empty when the video is 410 (deleted)', async () => {
    const extractor = new Rumble(new FetcherMock(`${__dirname}/__fixtures__/Rumble`), logger);
    const registry = new ExtractorRegistry(logger, [extractor]);
    jest.spyOn(extractor as unknown as { fetchHtmlDirect: (u: URL) => Promise<{ html: string; status: number }> }, 'fetchHtmlDirect')
      .mockResolvedValue({ html: '', status: 410 });

    expect(await registry.handle(ctx, new URL('https://rumble.com/va6del/deleted.html'))).toEqual([]);
  });

  test('falls back to direct https, and returns empty when the video is 404 (not found)', async () => {
    const extractor = new Rumble(new FetcherMock(`${__dirname}/__fixtures__/Rumble`), logger);
    const registry = new ExtractorRegistry(logger, [extractor]);
    jest.spyOn(extractor as unknown as { fetchHtmlDirect: (u: URL) => Promise<{ html: string; status: number }> }, 'fetchHtmlDirect')
      .mockResolvedValue({ html: '', status: 404 });

    expect(await registry.handle(ctx, new URL('https://rumble.com/va6nofound/missing.html'))).toEqual([]);
  });

  test('falls back to direct https HTML when the fetcher fails', async () => {
    const extractor = new Rumble(new FetcherMock(`${__dirname}/__fixtures__/Rumble`), logger);
    const registry = new ExtractorRegistry(logger, [extractor]);
    jest.spyOn(extractor as unknown as { fetchHtmlDirect: (u: URL) => Promise<{ html: string; status: number }> }, 'fetchHtmlDirect')
      .mockResolvedValue({
        html: '<script>window.rumble={"video":{"url":"https://mrumble.com/video/net123/hls-vod/master/playlist.m3u8"}};</script>',
        status: 200,
      });

    const results = await registry.handle(ctx, new URL('https://rumble.com/va7net/netfail.html'));
    expect(results).toHaveLength(1);
    const url = new URL(assertSingle(results).url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    expect(url.searchParams.get('d')).toBe('https://mrumble.com/video/net123/hls-vod/master/playlist.m3u8');
  });

  test('does not support non-rumble hosts', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://vimeo.com/999'))).toEqual([]);
  });

  test('does not support rumble when MediaFlow Proxy is not configured', async () => {
    const noMfp = createTestContext();
    expect(await extractorRegistry.handle(noMfp, new URL('https://rumble.com/va1hlm/test.html'))).toEqual([]);
  });
});

function assertSingle<T>(results: T[]): T {
  expect(results).toHaveLength(1);
  return results[0] as T;
}
