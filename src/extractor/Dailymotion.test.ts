import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { Dailymotion } from './Dailymotion';
import { ExtractorRegistry } from './ExtractorRegistry';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new Dailymotion(new FetcherMock(`${__dirname}/__fixtures__/Dailymotion`), logger)]);

const ctx = createTestContext({ mediaFlowProxyUrl: 'https://mediaflow.test.org', mediaFlowProxyPassword: 'test' });

/**
 * Dailymotion resolves the master `.m3u8` server-side (metadata API) and hands it to the MediaFlow
 * HLS proxy so the stream is playable by normal players (libvlc/mpv/Stremio-native) without yt-dlp
 * or custom header support. These tests assert the stable parts of the resulting proxy URL
 * (endpoint, password, referer, and the resolved absolute `d=` manifest) rather than snapshots,
 * since Dailymotion CDN `sec=` tokens are short-lived and change on every extraction.
 */
describe('Dailymotion', () => {
  test('resolves the master HLS manifest and routes it through the MFP HLS proxy', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://www.dailymotion.com/video/xbbtrw2'));

    expect(results).toHaveLength(1);
    const result = assertSingle(results);
    expect(result.format).toBe('hls');
    expect(result.label).toBe('Dailymotion (MFP)');

    const url = new URL(result.url.href);
    // Routed through MediaFlow's HLS proxy (absolute manifest `d=`, NOT the page URL).
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    expect(url.searchParams.get('api_password')).toBe('test');
    // The MFP proxy injects the browser UA + dailymotion Referer the CDN requires.
    expect(url.searchParams.get('h_referer')).toBe('https://www.dailymotion.com/');
    expect(url.searchParams.get('h_user-agent')).toContain('Mozilla');
    // The resolved manifest must be the absolute cdndirector master m3u8 (auto quality first).
    expect(url.searchParams.get('d')).toBe(
      'https://cdndirector.dailymotion.com/cdn/manifest/video/xbbtrw2.m3u8?sec=FAKETOKEN123&dmTs=997274',
    );
  });

  test('without an auto master, picks the highest single-quality HLS ladder', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://www.dailymotion.com/video/xfa1234'));

    expect(results).toHaveLength(1);
    const url = new URL(assertSingle(results).url.href);
    expect(url.origin + url.pathname).toBe('https://mediaflow.test.org/proxy/hls/manifest.m3u8');
    // 1080 outranks 720 when there is no `auto` master.
    expect(url.searchParams.get('d')).toBe('https://cdndirector.dailymotion.com/cdn/m/fx-1080.m3u8?sec=FAKE1080');
  });

  test('parses the video id from a geo player page ?video= query and returns empty when no HLS quality', async () => {
    const results = await extractorRegistry.handle(ctx, new URL('https://geo.dailymotion.com/player/xabc.html?video=x93u5v6'));
    expect(results).toEqual([]);
  });

  test('does not support non-dailymotion hosts', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://vimeo.com/12345'))).toEqual([]);
  });

  test('returns empty when the metadata API fetch fails', async () => {
    // `xerr999` has no fixture — the `.error` file makes FetcherMock throw, exercising the catch.
    expect(await extractorRegistry.handle(ctx, new URL('https://www.dailymotion.com/video/xerr999'))).toEqual([]);
  });

  test('does not support dailymotion hosts when MediaFlow Proxy is not configured', async () => {
    const noMfp = createTestContext();
    expect(await extractorRegistry.handle(noMfp, new URL('https://www.dailymotion.com/video/xbbtrw2'))).toEqual([]);
  });
});

function assertSingle<T>(results: T[]): T {
  expect(results).toHaveLength(1);
  return results[0] as T;
}
