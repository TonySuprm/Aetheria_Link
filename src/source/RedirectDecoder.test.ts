import rot13Cipher from 'rot13-cipher';
import { decodeString, extractEncryptedString, extractFallbackLink } from './RedirectDecoder';

// Encodes using chain 1: b64→b64→rot13→b64
function buildPayload(json: Record<string, string>): string {
  return btoa(btoa(rot13Cipher(btoa(JSON.stringify(json)))));
}

// Encodes without rot13 (chain 2: b64→b64)
function buildPayloadNoRot13(json: Record<string, string>): string {
  return btoa(btoa(JSON.stringify(json)));
}

// Encodes with extra b64 layer (chain 3: b64→b64→b64)
function buildPayloadExtraB64(json: Record<string, string>): string {
  return btoa(btoa(btoa(JSON.stringify(json))));
}

describe('extractEncryptedString', () => {
  test('extracts s() pattern', () => {
    const payload = buildPayload({ o: btoa('https://hub.test/file.mkv') });
    const html = `<script>s('o','${payload}')</script>`;
    expect(extractEncryptedString(html)).toBe(payload);
  });

  test('extracts ck() pattern', () => {
    const payload = buildPayload({ o: btoa('https://hub.test/file.mkv') });
    const html = `<script>ck('_wp_http_1','${payload}')</script>`;
    expect(extractEncryptedString(html)).toBe(payload);
  });

  test('extracts localStorage.setItem() pattern', () => {
    const payload = buildPayload({ o: btoa('https://hub.test/file.mkv') });
    const html = `<script>localStorage.setItem('o','${payload}')</script>`;
    expect(extractEncryptedString(html)).toBe(payload);
  });

  test('extracts generic key-value pattern (≥40 chars)', () => {
    const payload = buildPayload({ o: btoa('https://hub.test/file.mkv') });
    const html = `<script>var data = {"o":"${payload}"}</script>`;
    expect(extractEncryptedString(html)).toBe(payload);
  });

  test('falls back to last long base64 string (≥120 chars)', () => {
    const shortB64 = btoa('too-short');
    const longB64 = 'A'.repeat(150);
    const longestB64 = 'B'.repeat(200);
    const html = `<script>var x="${shortB64}";var y="${longB64}";var z="${longestB64}";</script>`;
    // Last match wins — payloads appear near page bottom
    expect(extractEncryptedString(html)).toBe(longestB64);
  });

  test('returns null when no pattern matches', () => {
    expect(extractEncryptedString('<html><body>nothing here</body></html>')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(extractEncryptedString('')).toBeNull();
  });

  test('s() pattern takes priority over long-b64 fallback', () => {
    const payload = buildPayload({ o: btoa('https://hub.test/file.mkv') });
    const noiseB64 = 'X'.repeat(200);
    const html = `<script>s('o','${payload}')</script><script>var noise="${noiseB64}"</script>`;
    expect(extractEncryptedString(html)).toBe(payload);
  });
});

describe('decodeString', () => {
  test('chain 1: b64→b64→rot13→b64→JSON (standard format)', () => {
    const payload = buildPayload({ o: btoa('https://hub.test/file.mkv') });
    const result = decodeString(payload);
    expect(result?.o).toBe(btoa('https://hub.test/file.mkv'));
  });

  test('chain 2: b64→b64→JSON (rot13 layer removed)', () => {
    const payload = buildPayloadNoRot13({ o: btoa('https://hub.test/file.mkv') });
    const result = decodeString(payload);
    expect(result?.o).toBe(btoa('https://hub.test/file.mkv'));
  });

  test('chain 3: b64→b64→b64→JSON (extra encoding layer)', () => {
    const payload = buildPayloadExtraB64({ o: btoa('https://hub.test/file.mkv') });
    const result = decodeString(payload);
    expect(result?.o).toBe(btoa('https://hub.test/file.mkv'));
  });

  test('preserves all decoded fields', () => {
    const payload = buildPayload({
      o: btoa('https://hub.test/file.mkv'),
      data: 'test-data',
      blog_url: 'https://blog.test',
      wp_http1: 'https://wp.test',
      total_time: '5',
    });
    const result = decodeString(payload);
    expect(result?.o).toBe(btoa('https://hub.test/file.mkv'));
    expect(result?.data).toBe('test-data');
    expect(result?.blog_url).toBe('https://blog.test');
    expect(result?.wp_http1).toBe('https://wp.test');
    expect(result?.total_time).toBe('5');
  });

  test('returns null for invalid input', () => {
    expect(decodeString('not-valid-base64!!!')).toBeNull();
  });

  test('returns null for valid base64 that is not JSON', () => {
    const badPayload = btoa(btoa(rot13Cipher(btoa('not-json-at-all'))));
    expect(decodeString(badPayload)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(decodeString('')).toBeNull();
  });
});

describe('extractFallbackLink', () => {
  test('extracts var reurl value', () => {
    const html = `<html><script>var reurl = "https://hubcloud.one/drive/abc123"</script></html>`;
    expect(extractFallbackLink(html)).toBe('https://hubcloud.one/drive/abc123');
  });

  test('extracts var reurl with single quotes', () => {
    const html = `<html><script>var reurl = 'https://hubcloud.one/drive/abc123'</script></html>`;
    expect(extractFallbackLink(html)).toBe('https://hubcloud.one/drive/abc123');
  });

  test('extracts hubcloud URL from raw HTML (no encryption)', () => {
    const html = `<html><a href="https://hubcloud.one/drive/test123">Download</a></html>`;
    expect(extractFallbackLink(html)).toBe('https://hubcloud.one/drive/test123');
  });

  test('extracts hubdrive URL from raw HTML', () => {
    const html = `<html><a href="https://hubdrive.space/file/123">Download</a></html>`;
    expect(extractFallbackLink(html)).toBe('https://hubdrive.space/file/123');
  });

  test('extracts hubcdn URL from raw HTML', () => {
    const html = `<html><a href="https://hubcdn.fans/file/123">Download</a></html>`;
    expect(extractFallbackLink(html)).toBe('https://hubcdn.fans/file/123');
  });

  test('last hub* URL match wins (payloads near page bottom)', () => {
    const html = `
      <html>
      <nav><a href="https://hubcloud.one/nav-link">Nav</a></nav>
      <div><a href="https://hubcloud.one/drive/real-target?token=abc">Real Link</a></div>
      </html>`;
    expect(extractFallbackLink(html)).toBe('https://hubcloud.one/drive/real-target?token=abc');
  });

  test('var reurl takes priority over hub* URL scan', () => {
    const html = `
      <html>
      <a href="https://hubcloud.one/nav-link">Nav</a>
      <script>var reurl = "https://hubcloud.one/drive/actual"</script>
      </html>`;
    expect(extractFallbackLink(html)).toBe('https://hubcloud.one/drive/actual');
  });

  test('returns null when no hub* URLs found', () => {
    const html = '<html><body>nothing here</body></html>';
    expect(extractFallbackLink(html)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(extractFallbackLink('')).toBeNull();
  });
});
