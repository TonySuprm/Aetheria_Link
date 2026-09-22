import { Context, Format, InternalUrlResult, Meta } from '../types';
import { showExternalUrls } from '../utils';
import { Extractor } from './Extractor';

const MEDIAFLOW_EXTRACTOR_HOSTS = [
  'ok.ru', 'www.ok.ru',
  'mixdrop.my', 'mixdrop.co', 'mixdrop.to',
  'uqload.com', 'uqload.cx',
  'filelions.com', 'filelions.to',
  'filemoon.sx', 'filemoon.to',
  'streamtape.com', 'streamta.pe',
  'streamwish.com', 'streamwish.to',
  'supervideo.tv',
  'vidoza.com',
  'voe.sx', 'voe.video',
  'doodstream.com', 'dood.to', 'dood.watch',
  'lulustream.com',
  'fastream.to',
  'vidfast.com',
  'vidoza.net',
  'streamwish.com',
];

// File extensions of direct-playable video URLs. These are served as inline web-ready streams
// (Stremio plays them directly, including seeking via HTTP Range), NOT as gated external URLs.
// Sources whose host serves direct video files (e.g. DramaSuki's dl.dramasuki.xyz goindex host)
// rely on this so their results appear and play without enabling "Include external URLs".
const DIRECT_VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'];

const isDirectVideoUrl = (url: URL): boolean => {
  const path = url.pathname.toLowerCase();
  return DIRECT_VIDEO_EXTENSIONS.some(ext => path.endsWith('.' + ext));
};

/**
 * Hosts whose direct video files must be relayed through the addon (not handed to the player raw)
 * because they reject ranged requests. Currently empty as DramaSuki relay causes massive buffering stalls.
 */
const RELAY_HOSTS = new Set<string>();

const needsRelay = (url: URL): boolean => RELAY_HOSTS.has(url.host);

/** Build a /relay?url=<file> URL on this addon instance. Keeps the file URL out of the player. */
const buildRelayUrl = (ctx: Context, fileUrl: URL): URL => {
  const relay = new URL('/relay', ctx.hostUrl);
  relay.searchParams.set('url', fileUrl.href);
  return relay;
};

export class ExternalUrl extends Extractor {
  public readonly id = 'external';

  public readonly label = 'External';

  // Lowered TTL from 6h to 15m to ensure tokenized dynamic .m3u8 endpoints refresh properly
  public override readonly ttl = 900000; // 15m

  public supports(ctx: Context, url: URL): boolean {
    // Direct video files are always supported — they play inline as web-ready streams.
    // isHls: genuine HLS streams (manifest URL or HLS proxy path)
    const isHls = url.href.includes('.m3u8') || url.pathname.includes('/proxy/hls/');
    // isProxyStream: relay/MFP wrappers that carry direct video files (MKV, MP4, etc.)
    const isProxyStream = url.pathname.includes('/proxy/stream') || url.pathname.includes('/relay');
    if (isDirectVideoUrl(url) || isHls || isProxyStream) {
      return true;
    }
    if (!showExternalUrls(ctx.config)) return false;
    // Skip hosts that have dedicated MediaFlow extractors
    if (MEDIAFLOW_EXTRACTOR_HOSTS.some(h => url.host === h || url.host.endsWith('.' + h))) return false;
    return true;
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    // A direct video file → a playable mp4-format stream (Stremio treats Format.mp4 as web-ready,
    // so it renders and plays inline without "Include external URLs" being enabled).
    // isHls: genuine HLS — only real .m3u8 URLs or the /proxy/hls/ tunnel
    const isHls = url.href.includes('.m3u8') || url.pathname.includes('/proxy/hls/');
    // isProxyStream: /proxy/stream or /relay wrapping a direct video file (MKV, MP4)
    // These must NOT be treated as HLS — doing so causes VLC to parse MKV bytes as M3U8
    const isProxyStream = url.pathname.includes('/proxy/stream') || url.pathname.includes('/relay');
    // /relay wraps raw MKV/MP4 served as application/octet-stream (e.g. 111477.xyz via its
    // workers.dev CDN). Stremio's inline Chromium player cannot demux MKV / play octet-stream, so
    // these must be routed through Stremio's streaming server (ffmpeg) via notWebReady:true.
    // StreamResolver only emits notWebReady:true when format !== mp4 AND notWebReady !== false,
    // so relay streams use Format.unknown + notWebReady:true (NOT Format.mp4/false, which would
    // force inline playback and stall at 0:00). /proxy/stream (MFP) and raw direct-video files
    // keep their existing mp4/false behaviour.
    const isRelay = url.pathname.includes('/relay');
    if (isDirectVideoUrl(url) || isHls || isProxyStream) {
      // DramaSuki's dl.dramasuki.xyz is a Google-Drive-backed goindex that REJECTS ranged requests
      // (HTTP 403 "download quota exceeded") while allowing a single plain GET. Stremio/players
      // always send Range → they'd stall at 0:00 on the raw URL. Route such files through the
      // addon's own /relay endpoint, which does a plain GET upstream and honours the player's Range
      // locally, so playback progresses.
      const finalUrl = needsRelay(url) ? buildRelayUrl(ctx, url) : url;

      let displayLabel = url.host;
      if (displayLabel.includes('127.0.0.1') || displayLabel.includes('localhost')) {
        displayLabel = 'MediaProxy';
        const downstream = url.searchParams.get('d');
        if (downstream) {
          try {
            displayLabel = new URL(downstream).host;
          } catch { /* invalid downstream url — keep MediaProxy */ }
        }
      }

      return [
        {
          url: finalUrl,
          // Only tag as HLS if we know it's a genuine HLS stream.
          // /proxy/stream and /relay wrap MKV/MP4 payloads — tagging them as HLS
          // causes VLC to try parsing raw binary video data as an M3U8 playlist,
          // which immediately stalls playback at 0:00.
          format: isHls ? Format.hls : (isRelay ? Format.unknown : Format.mp4),
          isExternal: false,
          // /relay wraps raw MKV/octet-stream (111477.xyz, Vadapav). Stremio's inline Chromium
          // <video> player cannot demux MKV, so the stream MUST be flagged notWebReady so Stremio
          // routes it through its streaming server (ffmpeg). format=unknown alone is not enough:
          // StreamResolver's behaviorHints gate only emits notWebReady:true when BOTH format!==mp4
          // AND notWebReady!==false — a literal false here defeats the gate → inline → stall at 0:00.
          // /proxy/stream (MFP) and raw direct-video files keep notWebReady:false (inline-OK).
          notWebReady: isRelay,
          label: displayLabel,
          meta,
        },
      ];
    }

    const isPlayable = url.href.includes('.m3u8') || url.href.includes('.mp4');
    let format = Format.unknown;
    if (url.href.includes('.m3u8')) format = Format.hls;
    else if (url.href.includes('.mp4')) format = Format.mp4;

    return [
      {
        url: url,
        format: format,
        isExternal: !isPlayable,
        label: `${url.host}`,
        meta,
      },
    ];
  };
}
