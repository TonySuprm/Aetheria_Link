import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { FileLions } from './FileLions';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new FileLions(new FetcherMock(`${__dirname}/__fixtures__/FileLions`), logger)]);

const ctx = createTestContext({ mediaFlowProxyUrl: 'https://mediaflow.test.org', mediaFlowProxyPassword: 'test' });

/**
 * The StreamHG / filelions player pages hide their stream URL inside a Dean Edwards packed
 * JavaScript blob. The page exposes several candidates, but the one MediaFlow's own extractor
 * picks (`hls4`) is a **host-less relative path** (`/stream/<token>/master.m3u8`) that breaks the
 * HLS proxy. We therefore resolve the page ourselves and hand the HLS proxy an **absolute**
 * `hls2` CDN URL. These tests assert on the stable parts of the resulting proxy URL (endpoint,
 * host param, absolute CDN `d=` ending in `master.m3u8`) since the `?t=&s=&e=` tokens are
 * time-limited and change on every extraction.
 */
describe('FileLions', () => {
  test('filelions f resolves to an absolute HLS CDN url via the HLS proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://filelions.to/f/tyn45apubte2'));

    expect(results).toHaveLength(1);
    const result = assertSingle(results);
    expect(result.format).toBe('hls');
    expect(result.label).toBe('FileLions (MFP)');

    const url = new URL(result.url.href);
    // Routed through MediaFlow's HLS proxy, not the extractor endpoint.
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    expect(url.searchParams.get('api_password')).toBe('test');
    expect(url.searchParams.get('h_referer')).toBe('https://filelions.to/f/tyn45apubte2');
    // The resolved stream URL must be absolute and point at an .m3u8 manifest (NOT a host-less /stream/ path).
    const d = url.searchParams.get('d');
    expect(d).toBeTruthy();
    expect(d?.startsWith('https://')).toBe(true);
    expect(d?.includes('master.m3u8')).toBe(true);
    expect(d?.includes('/stream/')).toBe(false); // the relative-URL bug must be gone
  });

  test('mivalyo v passes the referer lock through to the proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://mivalyo.com/v/tah5znapz3e5'), { referer: 'https://kinoger.com' });

    expect(results).toHaveLength(1);
    const url = new URL(assertSingle(results).url.href);
    expect(url.searchParams.get('h_referer')).toBe('https://kinoger.com');
    const d = url.searchParams.get('d');
    expect(d?.startsWith('https://')).toBe(true);
    expect(d?.includes('master.m3u8')).toBe(true);
  });

  test('perfectcrown.buzz (dramacool/embedload chain) resolves the relative hls4 to an absolute CDN url', async () => {
    // This is the host the dramacool/embedload chain lands on. Its packed JS defines a *relative*
    // `hls4` (`/stream/<token>/master.m3u8`) and an absolute `hls2`. We must hand the HLS proxy the
    // absolute `hls2`, otherwise MediaFlow gets a host-less URL and returns an empty manifest.
    const results = await extractorRegistry.handle(ctx, new URL('https://perfectcrown.buzz/e/xhfmoqrvfknx'));

    expect(results).toHaveLength(1);
    const url = new URL(assertSingle(results).url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    const d = url.searchParams.get('d');
    expect(d).toBeTruthy();
    expect(d?.startsWith('https://')).toBe(true);
    expect(d?.includes('master.m3u8')).toBe(true);
    expect(d?.includes('/stream/')).toBe(false); // must NOT be the host-less relative path
    // The referer should default to the page itself when none is supplied.
    expect(url.searchParams.get('h_referer')).toBe('https://perfectcrown.buzz/e/xhfmoqrvfknx');
  });

  test('file not found returns no results', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://filelions.to/v/ylcp2cu5qanb'))).toEqual([]);
  });

  test('deleted by administration returns no results', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://callistanise.com/f/cy4t5nkerjrt'))).toEqual([]);
  });
});

function assertSingle<T>(results: T[]): T {
  expect(results).toHaveLength(1);
  return results[0] as T;
}
