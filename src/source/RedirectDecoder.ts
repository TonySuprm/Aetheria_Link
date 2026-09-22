import rot13Cipher from 'rot13-cipher';

// Encrypted payload extraction patterns from redirect pages
const EXTRACTION_PATTERNS = [
  /s\(\s*['"]o['"]\s*,\s*['"]([^'"]+)['"]/, // s('o','...')
  /ck\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/, // ck('_wp_http_N','...')
  /localStorage\.setItem\(\s*['"]o['"]\s*,\s*['"]([^'"]+)['"]/, // localStorage variant
  /['"]o['"]\s*[:=]\s*['"]([A-Za-z0-9+/=]{40,})['"]/, // generic key-value ≥40 chars
] as const;

// Last-resort: any long base64-ish string (payloads tend to be near the bottom of the page)
const LONG_B64_RE = /[A-Za-z0-9+/=]{120,}/g;

const VAR_REURL_RE = /var\s+reurl\s*=\s*["']([^"']+)["']/;

// Hub* URL pattern for fallback link extraction
const HUB_URL_RE = /(https?:\/\/[^\s"'<>]*(?:hubcloud|hubdrive|hubcdn)[^\s"'<>]*)/gi;

export interface DecodedRedirect {
  o?: string;
  data?: string;
  blog_url?: string;
  wp_http1?: string;
  total_time?: string;
  [key: string]: string | undefined;
}

// Extract encrypted payload from redirect page HTML
export function extractEncryptedString(html: string): string | null {
  for (const pattern of EXTRACTION_PATTERNS) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Last-resort: longest base64-ish string (last match wins — payloads appear near page bottom)
  const matches = [...html.matchAll(LONG_B64_RE)];
  const last = matches[matches.length - 1];
  return last?.[0] ?? null;
}

// Try multiple decode chains — site may have removed/added encoding layers
export function decodeString(encoded: string): DecodedRedirect | null {
  // Chain 1: b64→b64→rot13→b64→JSON (standard format)
  try {
    return JSON.parse(atob(rot13Cipher(atob(atob(encoded)))));
  } catch { /* next */ }

  // Chain 2: b64→b64→JSON (rot13 layer removed by site)
  try {
    return JSON.parse(atob(atob(encoded)));
  } catch { /* next */ }

  // Chain 3: b64→b64→b64→JSON (extra encoding layer added by site)
  try {
    return JSON.parse(atob(atob(atob(encoded))));
  } catch { /* next */ }
  return null;
}

// Last-resort URL scan — may false-positive on nav/ads; blast radius = wasted extraction attempt
export function extractFallbackLink(html: string): string | null {
  const reurlMatch = html.match(VAR_REURL_RE);
  if (reurlMatch?.[1]) return reurlMatch[1];

  const matches = [...html.matchAll(HUB_URL_RE)];
  const last = matches[matches.length - 1];
  return last?.[1] ?? null;
}
