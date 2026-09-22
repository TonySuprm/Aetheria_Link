import { Context } from '../types';
import { Fetcher } from '../utils';
import { decodeString, extractEncryptedString, extractFallbackLink } from './RedirectDecoder';

const WP_HTTP_MAX_RETRIES = 5;
const WP_HTTP_RETRY_DELAY_MS = 2000;
// Cap total_time wait to prevent malformed pages from causing 30s+ hangs
const MAX_TOTAL_TIME_SECONDS = 10;

export const resolveRedirectUrl = async (ctx: Context, fetcher: Fetcher, redirectUrl: URL): Promise<URL> => {
  const html = await fetcher.text(ctx, redirectUrl);

  // Layer 1: encrypted payload extraction + multi-chain decode
  const encrypted = extractEncryptedString(html);
  if (encrypted) {
    const decoded = decodeString(encrypted);
    if (decoded) {
      // Primary: use 'o' field (base64-encoded URL)
      const o = (decoded.o ?? '').trim();
      if (o) return new URL(atob(o));

      const data = (decoded.data ?? '').trim();

      // Fallback 1: blog_url + data raw (NOT base64-encoded — intentional asymmetry with wp_http1)
      const blogUrl = (decoded.blog_url ?? '').trim();
      if (blogUrl && data) {
        const result = await fetcher.text(ctx, new URL(`${blogUrl}?re=${data}`));
        return new URL(result.trim());
      }

      // Fallback 2: wp_http1 + data base64-encoded + total_time wait
      const wpHttp1 = (decoded.wp_http1 ?? '').trim();
      if (wpHttp1 && data) {
        return resolveViaWpHttp(ctx, fetcher, wpHttp1, data, decoded.total_time);
      }
    }
  }

  // Layer 2: last-resort URL scan from raw HTML (may false-positive on nav/ads)
  const fallbackUrl = extractFallbackLink(html);
  if (fallbackUrl) return new URL(fallbackUrl);

  throw new Error(`[hd-hub-helper] No usable URL found from: ${redirectUrl.href}`);
};

// wp_http1 resolution with server-enforced wait + retry on "Invalid Request"
const resolveViaWpHttp = async (
  ctx: Context, fetcher: Fetcher, wpHttp1: string, data: string, totalTime?: string,
): Promise<URL> => {
  const cappedTotalTime = Math.min(Number(totalTime) || 0, MAX_TOTAL_TIME_SECONDS);
  const waitMs = (cappedTotalTime + 3) * 1000;
  await new Promise(resolve => setTimeout(resolve, waitMs));

  // wp_http1 sends data as base64 (intentional asymmetry with blog_url which sends raw)
  const token = btoa(data);
  const retryUrl = new URL(`${wpHttp1}?re=${token}`);

  for (let attempt = 0; attempt < WP_HTTP_MAX_RETRIES; attempt++) {
    const result = await fetcher.text(ctx, retryUrl);
    if (!result.includes('Invalid Request')) {
      const reurlMatch = result.match(/var\s+reurl\s*=\s*["']([^"']+)["']/);
      if (reurlMatch?.[1]) return new URL(reurlMatch[1]);
      try {
        return new URL(result.trim());
      } catch { /* next attempt */ }
    }
    await new Promise(resolve => setTimeout(resolve, WP_HTTP_RETRY_DELAY_MS));
  }

  throw new Error(`[hd-hub-helper] wp_http1 resolution failed after ${WP_HTTP_MAX_RETRIES} retries`);
};
