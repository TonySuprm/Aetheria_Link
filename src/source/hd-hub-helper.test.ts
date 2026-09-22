import rot13Cipher from 'rot13-cipher';
import { createTestContext } from '../test';
import { Fetcher } from '../utils';
import { resolveRedirectUrl } from './hd-hub-helper';

const ctx = createTestContext();

// Encodes using chain 1: b64→b64→rot13→b64
function buildPayload(json: Record<string, string>): string {
  return btoa(btoa(rot13Cipher(btoa(JSON.stringify(json)))));
}

// Encodes without rot13 (chain 2)
function buildPayloadNoRot13(json: Record<string, string>): string {
  return btoa(btoa(JSON.stringify(json)));
}

// Encodes with extra b64 layer (chain 3)
function buildPayloadExtraB64(json: Record<string, string>): string {
  return btoa(btoa(btoa(JSON.stringify(json))));
}

const makeFetcher = (pages: Record<string, string> = {}): Fetcher =>
  ({ text: (_ctx: unknown, url: URL) => Promise.resolve(pages[url.href] ?? '') } as unknown as Fetcher);

const REDIRECT_URL = new URL('https://gadgetsweb.xyz/?id=test');

describe('resolveRedirectUrl', () => {
  test('resolves primary o field via s() pattern', async () => {
    const payload = buildPayload({ o: btoa('https://hub.test.buzz/file.mkv') });
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>` });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hub.test.buzz/file.mkv');
  });

  test('resolves primary o field via ck() pattern', async () => {
    const payload = buildPayload({ o: btoa('https://hub.test.buzz/file.mkv') });
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>ck('_wp_http_1','${payload}')</script>` });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hub.test.buzz/file.mkv');
  });

  test('resolves via blog_url fallback when o field is absent', async () => {
    const payload = buildPayload({ blog_url: 'https://blog.test.com', data: 'testdata' });
    const fetcher = makeFetcher({
      [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>`,
      'https://blog.test.com/?re=testdata': 'https://hub.test.buzz/fallback.mkv',
    });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hub.test.buzz/fallback.mkv');
  });

  test('resolves via wp_http1 with wait+retry', async () => {
    const payload = buildPayload({ wp_http1: 'https://wp.test.com', data: 'wpdata', total_time: '0' });
    const fetcher = makeFetcher({
      [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>`,
      [new URL('https://wp.test.com/?re=' + btoa('wpdata')).href]: '<script>var reurl = "https://hub.test.buzz/wphttp1.mkv"</script>',
    });
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => process.nextTick(fn)) as unknown as typeof setTimeout);
    const result = await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL);
    expect(result.href).toBe('https://hub.test.buzz/wphttp1.mkv');
    jest.restoreAllMocks();
  });

  test('wp_http1 resolves via raw URL when no var reurl in response', async () => {
    const payload = buildPayload({ wp_http1: 'https://wp.test.com', data: 'wpdata', total_time: '0' });
    const fetcher = makeFetcher({
      [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>`,
      [new URL('https://wp.test.com/?re=' + btoa('wpdata')).href]: 'https://hub.test.buzz/raw-url.mkv',
    });
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => process.nextTick(fn)) as unknown as typeof setTimeout);
    const result = await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL);
    expect(result.href).toBe('https://hub.test.buzz/raw-url.mkv');
    jest.restoreAllMocks();
  });

  test('wp_http1 retries on Invalid Request', async () => {
    const payload = buildPayload({ wp_http1: 'https://wp.test.com', data: 'wpdata', total_time: '0' });
    let callCount = 0;
    const fetcher = {
      text: (_ctx: unknown, url: URL) => {
        if (url.href === REDIRECT_URL.href) {
          return Promise.resolve(`<script>s('o','${payload}')</script>`);
        }
        callCount++;
        if (callCount <= 2) return Promise.resolve('Invalid Request');
        return Promise.resolve('<script>var reurl = "https://hub.test.buzz/retry.mkv"</script>');
      },
    } as unknown as Fetcher;
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => process.nextTick(fn)) as unknown as typeof setTimeout);
    const result = await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL);
    expect(result.href).toBe('https://hub.test.buzz/retry.mkv');
    jest.restoreAllMocks();
  });

  test('wp_http1 throws after max retries on persistent Invalid Request', async () => {
    const payload = buildPayload({ wp_http1: 'https://wp.test.com', data: 'wpdata', total_time: '0' });
    const fetcher = makeFetcher({
      [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>`,
      [new URL('https://wp.test.com/?re=' + btoa('wpdata')).href]: 'Invalid Request',
    });
    // Use real timers but mock the retry delay to avoid 10s+ test
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => process.nextTick(fn)) as unknown as typeof setTimeout);
    await expect(resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).rejects.toThrow('wp_http1 resolution failed after 5 retries');
    jest.restoreAllMocks();
  });

  test('resolves via chain 2 (no rot13) when chain 1 fails', async () => {
    const payload = buildPayloadNoRot13({ o: btoa('https://hub.test.buzz/no-rot13.mkv') });
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>` });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hub.test.buzz/no-rot13.mkv');
  });

  test('resolves via chain 3 (extra b64) when chains 1 and 2 fail', async () => {
    const payload = buildPayloadExtraB64({ o: btoa('https://hub.test.buzz/extra-b64.mkv') });
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>` });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hub.test.buzz/extra-b64.mkv');
  });

  test('resolves via extractFallbackLink when no encrypted string found', async () => {
    const html = `<html><script>var reurl = "https://hubcloud.one/drive/fallback123"</script></html>`;
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: html });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hubcloud.one/drive/fallback123');
  });

  test('resolves via hub* URL scan when no encrypted string and no var reurl', async () => {
    const html = `<html><a href="https://hubcloud.one/drive/scanned">Download</a></html>`;
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: html });
    expect((await resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).href).toBe('https://hubcloud.one/drive/scanned');
  });

  test('throws when no pattern matches and no fallback link', async () => {
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: '<script>no pattern here</script>' });
    await expect(resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).rejects.toThrow('[hd-hub-helper] No usable URL found');
  });

  test('throws when encoded payload is not valid JSON (all chains fail)', async () => {
    const badPayload = btoa(btoa(rot13Cipher(btoa('not-json-at-all'))));
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>s('o','${badPayload}')</script>` });
    // All 3 decode chains fail, no fallback link in HTML
    await expect(resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).rejects.toThrow('[hd-hub-helper] No usable URL found');
  });

  test('throws when JSON payload has no usable URL fields', async () => {
    const payload = buildPayload({});
    const fetcher = makeFetcher({ [REDIRECT_URL.href]: `<script>s('o','${payload}')</script>` });
    await expect(resolveRedirectUrl(ctx, fetcher, REDIRECT_URL)).rejects.toThrow('[hd-hub-helper] No usable URL found');
  });
});
