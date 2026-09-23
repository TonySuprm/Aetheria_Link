import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { OkRu } from './OkRu';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new OkRu(new FetcherMock(`${__dirname}/__fixtures__/OkRu`), logger)]);

const ctx = createTestContext({ mediaFlowProxyUrl: 'https://mediaflow.test.org', mediaFlowProxyPassword: 'test' });

/**
 * OK.ru streams resolve through the MediaFlow Proxy so the result is playable by normal players
 * (libvlc/mpv/Stremio-native) that cannot send the custom UA/Referer headers the ok.ru CDN
 * requires. The addon resolves the real manifest/file URL server-side and hands it to the proxy,
 * which injects the headers and rewrites all segment/file URLs.
 */
describe('OkRu', () => {
  test('resolves the HLS manifest and routes it through the MFP HLS proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://ok.ru/video/5500000000000'));

    expect(results).toHaveLength(1);
    const result = assertSingle(results);
    expect(result.format).toBe('hls');
    expect(result.label).toBe('OK.ru (MFP)');

    const url = new URL(result.url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    expect(url.searchParams.get('api_password')).toBe('test');
    expect(url.searchParams.get('h_referer')).toBe('https://ok.ru/');
    // The resolved manifest is the absolute CDN m3u8 from the player data-options.
    expect(url.searchParams.get('d')).toBe('https://ok-cdn.example.com/stream/master.m3u8');
  });

  test('falls back to the best direct file and routes it through the MFP stream proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://www.ok.ru/video/5500000000001'));

    expect(results).toHaveLength(1);
    const result = assertSingle(results);
    expect(result.format).toBe('mp4');

    const url = new URL(result.url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/stream');
    expect(url.searchParams.get('h_referer')).toBe('https://ok.ru/');
    // Quality ranking picks `hd` over `mobile` / `lowest`.
    expect(url.searchParams.get('d')).toBe('https://ok-cdn.example.com/stream/hd.mp4');
  });

  test('does not support non-ok.ru hosts', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://vimeo.com/12345'))).toEqual([]);
  });

  test('returns empty when the player page fetch fails', async () => {
    // `9999999999999` has no fixture — the `.error` file makes FetcherMock throw, exercising the catch.
    expect(await extractorRegistry.handle(ctx, new URL('https://ok.ru/video/9999999999999'))).toEqual([]);
  });

  test('does not support ok.ru when MediaFlow Proxy is not configured', async () => {
    const noMfp = createTestContext();
    expect(await extractorRegistry.handle(noMfp, new URL('https://ok.ru/video/5500000000000'))).toEqual([]);
  });
});

function assertSingle<T>(results: T[]): T {
  expect(results).toHaveLength(1);
  return results[0] as T;
}
