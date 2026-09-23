import { Context } from '../types';
import { Fetcher } from './Fetcher';

interface ExtractResult {
  destination_url: string;
  request_headers: Record<string, string>;
  mediaflow_proxy_url: string;
  query_params: Record<string, string>;
}

export const supportsMediaFlowProxy = (ctx: Context): boolean => !!ctx.config['mediaFlowProxyUrl'];

const stripProtocol = (value: string): string => value.replace(/^https?:\/\//i, '');
const configProtocol = (value: string): string => value.toLowerCase().startsWith('https://') ? 'https:' : 'http:';

const LOOPBACK_PROXY_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

/**
 * True when the configured MediaFlow Proxy is the embedded, co-running instance
 * (Railway/docker-compose/sidecar on loopback). Such a proxy has no address
 * reachable by Stremio players, so client-facing URLs must be exposed through
 * the add-on's own public host (relayed by MediaFlowProxyController).
 */
export const isEmbeddedMediaFlowProxy = (value?: string): boolean => {
  if (!value) return false;
  const hostPart = stripProtocol(value).split('/')[0]?.split('[')[0] ?? '';
  const host = hostPart.split(':')[0]?.trim().toLowerCase();
  return host ? LOOPBACK_PROXY_HOSTS.has(host) : false;
};

/**
 * Base URL for requests issued BY THE ADDON (server-side fetches such as
 * `/extractor/video` resolution): always the configured proxy (loopback when
 * co-running). Never the public host — the add-on must reach the proxy
 * directly to avoid a public round-trip.
 */
const serverBase = (ctx: Context): URL => {
  const cfg = ctx.config.mediaFlowProxyUrl ?? '';
  return new URL(`${configProtocol(cfg)}//${stripProtocol(cfg)}`);
};

/**
 * Base URL for stream URLs HANDED TO THE PLAYER. For an external (public)
 * proxy configuration that is the proxy itself; for the embedded loopback
 * proxy it is the add-on's public host, because the add-on relays the
 * `/proxy/*` and `/extractor/*` paths to the co-running proxy.
 */
const publicBase = (ctx: Context): URL => {
  const cfg = ctx.config.mediaFlowProxyUrl;
  if (cfg && !isEmbeddedMediaFlowProxy(cfg)) return serverBase(ctx);
  return ctx.hostUrl;
};

const addExtractorParams = (mediaFlowProxyUrl: URL, host: string, url: URL, ctx: Context, headers: Record<string, string>): void => {
  mediaFlowProxyUrl.searchParams.append('host', host);
  if (ctx.config.mediaFlowProxyPassword) {
    mediaFlowProxyUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
  }
  mediaFlowProxyUrl.searchParams.append('d', url.href);

  for (const headerKey in headers) {
    mediaFlowProxyUrl.searchParams.set('h_' + headerKey.toLowerCase(), headers[headerKey] as string);
  }
};

const buildMediaFlowProxyExtractorUrl = (ctx: Context, host: string, url: URL, headers: Record<string, string>, base: URL): URL => {
  const mediaFlowProxyUrl = new URL('/extractor/video', base);
  addExtractorParams(mediaFlowProxyUrl, host, url, ctx, headers);
  return mediaFlowProxyUrl;
};

export const buildMediaFlowProxyExtractorRedirectUrl = (ctx: Context, host: string, url: URL, headers: Record<string, string> = {}): URL => {
  const mediaFlowProxyUrl = buildMediaFlowProxyExtractorUrl(ctx, host, url, headers, publicBase(ctx));

  mediaFlowProxyUrl.searchParams.append('redirect_stream', 'true');

  return mediaFlowProxyUrl;
};

export const buildMediaFlowProxyExtractorStreamUrl = async (ctx: Context, fetcher: Fetcher, host: string, url: URL, headers: Record<string, string>): Promise<URL> => {
  const mediaFlowProxyUrl = buildMediaFlowProxyExtractorUrl(ctx, host, url, headers, serverBase(ctx));

  const extractResult: ExtractResult = await fetcher.json(ctx, mediaFlowProxyUrl, { queueLimit: 4, queueTimeout: 10000, timeout: 20000 });

  const streamUrl = new URL(extractResult.mediaflow_proxy_url);

  // The proxy reports its own host; for the embedded proxy that is loopback,
  // which is unreachable by players. Re-base onto the public host.
  if (isEmbeddedMediaFlowProxy(extractResult.mediaflow_proxy_url)) {
    streamUrl.protocol = publicBase(ctx).protocol;
    streamUrl.host = publicBase(ctx).host;
  }

  for (const queryParamsKey in extractResult.query_params) {
    streamUrl.searchParams.append(queryParamsKey, extractResult.query_params[queryParamsKey] as string);
  }
  for (const requestHeadersKey in extractResult.request_headers) {
    streamUrl.searchParams.append(`h_${requestHeadersKey}`, extractResult.request_headers[requestHeadersKey] as string);
  }
  streamUrl.searchParams.append('d', extractResult.destination_url);

  return streamUrl;
};
export const buildMediaFlowProxyHlsUrl = (ctx: Context, m3u8Url: URL, headers: Record<string, string> = {}, proxySegments = false): URL => {
  const mediaFlowProxyUrl = new URL('/proxy/hls/manifest.m3u8', publicBase(ctx));
  if (ctx.config.mediaFlowProxyPassword) {
    mediaFlowProxyUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
  }
  mediaFlowProxyUrl.searchParams.append('d', m3u8Url.href);
  if (proxySegments) mediaFlowProxyUrl.searchParams.append('force_playlist_proxy', 'true');
  for (const headerKey in headers) {
    mediaFlowProxyUrl.searchParams.set('h_' + headerKey.toLowerCase(), headers[headerKey] as string);
  }
  return mediaFlowProxyUrl;
};

export const buildMediaFlowProxyStreamUrl = (ctx: Context, url: URL, headers: Record<string, string> = {}): URL => {
  const mediaFlowProxyUrl = new URL('/proxy/stream', publicBase(ctx));
  if (ctx.config.mediaFlowProxyPassword) {
    mediaFlowProxyUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
  }
  mediaFlowProxyUrl.searchParams.append('d', url.href);
  for (const headerKey in headers) {
    mediaFlowProxyUrl.searchParams.set('h_' + headerKey.toLowerCase(), headers[headerKey] as string);
  }
  return mediaFlowProxyUrl;
};
