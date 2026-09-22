import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExternalUrl } from './ExternalUrl';
import { ExtractorRegistry } from './ExtractorRegistry';
import winston from 'winston';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

const registry = new ExtractorRegistry(logger, [new ExternalUrl(new FetcherMock(`${__dirname}/__fixtures__/ExternalUrl`), logger)]);

describe('ExternalUrl', () => {
  test('hands a dl.dramasuki.xyz direct .mkv through unchanged (relay disabled)', async () => {
    const ctx = createTestContext(); // includeExternalUrls NOT enabled
    const results = await registry.handle(ctx, new URL('https://dl.dramasuki.xyz/0:/Korean-Drama/Show%20(2020)/Show%20-%201x01%20(1080p).mkv'));
    expect(results).toHaveLength(1);
    expect(results[0]?.format).toBe('mp4');
    expect(results[0]?.isExternal).toBe(false);
    expect(results[0]?.label).toBe('dl.dramasuki.xyz');
    expect(results[0]?.url.href).toBe('https://dl.dramasuki.xyz/0:/Korean-Drama/Show%20(2020)/Show%20-%201x01%20(1080p).mkv');
  });

  test('hands a non-relay-host direct .mkv URL through unchanged', async () => {
    const ctx = createTestContext();
    const results = await registry.handle(ctx, new URL('https://example.org/video.mkv'));
    expect(results).toHaveLength(1);
    expect(results[0]?.url.href).toBe('https://example.org/video.mkv');
  });

  test('treats a direct .mp4 video URL as a playable stream without includeExternalUrls', async () => {
    const ctx = createTestContext();
    const results = await registry.handle(ctx, new URL('https://example.com/video.mp4'));
    expect(results).toHaveLength(1);
    expect(results[0]?.format).toBe('mp4');
    expect(results[0]?.isExternal).toBe(false);
  });

  test('treats a direct .webm video URL as a playable stream', async () => {
    const ctx = createTestContext();
    const results = await registry.handle(ctx, new URL('https://example.com/clip.webm'));
    expect(results).toHaveLength(1);
    expect(results[0]?.format).toBe('mp4');
    expect(results[0]?.isExternal).toBe(false);
  });

  test('ignores the host of a direct video URL (not checked against MediaFlow hosts)', async () => {
    // A .mp4 on a host that would otherwise be a MediaFlow host is still handled here because
    // direct video files are resolved inline, not via MediaFlow.
    const ctx = createTestContext();
    const results = await registry.handle(ctx, new URL('https://streamtape.com/direct/file.mp4'));
    expect(results).toHaveLength(1);
    expect(results[0]?.format).toBe('mp4');
  });

  test('returns [] for a non-video external URL when includeExternalUrls is not enabled', async () => {
    const ctx = createTestContext();
    const results = await registry.handle(ctx, new URL('https://example.com/watch/abc123'));
    expect(results).toHaveLength(0);
  });

  test('returns an external result for a non-video URL when includeExternalUrls is enabled', async () => {
    const ctx = createTestContext({ includeExternalUrls: 'on' });
    const results = await registry.handle(ctx, new URL('https://example.com/watch/abc123'));
    expect(results).toHaveLength(1);
    expect(results[0]?.isExternal).toBe(true);
    expect(results[0]?.format).toBe('unknown');
  });

  test('skips MediaFlow-hosted non-video embed URLs even with includeExternalUrls enabled', async () => {
    const ctx = createTestContext({ includeExternalUrls: 'on' });
    const results = await registry.handle(ctx, new URL('https://streamtape.com/e/gjA1OQ4klyHxgJ'));
    expect(results).toHaveLength(0);
  });

  // Regression: /relay wraps raw MKV/octet-stream (111477.xyz, Vadapav). Stremio's inline Chromium
  // player cannot demux MKV, so the result MUST be flagged notWebReady:true so Stremio routes it
  // through its streaming server (ffmpeg). format must NOT be mp4 (the StreamResolver gate emits
  // notWebReady only when format!==mp4 AND notWebReady!==false). A literal notWebReady:false here
  // previously defeated the gate → inline playback → MKV stalled at 0:00.
  test('flags a /relay-wrapped file as notWebReady (not inline-playable MKV)', async () => {
    const ctx = createTestContext();
    const relayUrl = new URL('http://127.0.0.1:51546/relay/Succession.S01E01.mkv');
    relayUrl.searchParams.set('url', 'https://a.111477.xyz/tvs/Succession/Season%201/Succession.S01E01.mkv');
    const results = await registry.handle(ctx, relayUrl);
    expect(results).toHaveLength(1);
    expect(results[0]?.format).toBe('unknown');
    expect(results[0]?.notWebReady).toBe(true);
    expect(results[0]?.isExternal).toBe(false);
  });

  // /proxy/stream (MediaFlowProxy) wraps seekable MP4/HLS payloads and stays inline-OK.
  test('keeps a /proxy/stream (MediaFlowProxy) wrapper inline-playable', async () => {
    const ctx = createTestContext();
    const results = await registry.handle(ctx, new URL('http://127.0.0.1:8889/proxy/stream/d=https%3A%2F%2Fexample.com%2Fvideo.mp4'));
    expect(results).toHaveLength(1);
    expect(results[0]?.format).toBe('mp4');
    expect(results[0]?.notWebReady).toBe(false);
  });
});
