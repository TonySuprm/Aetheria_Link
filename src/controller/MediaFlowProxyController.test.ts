import { createServer, get as httpGet, IncomingMessage, Server, ServerResponse } from 'node:http';
import express from 'express';
import winston from 'winston';
import { MediaFlowProxyController } from './MediaFlowProxyController';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

/** raw http.get so the test controls the Host header itself (undici fetch strips it). */
const rawGet = (url: string, headers: Record<string, string> = {}, options: { method?: string } = {}): Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }> => {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpGet(
      u,
      { method: options.method ?? 'GET', headers: { Host: u.host, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
};

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Fake MFP upstream: records what it receives and serves canned responses. */
const startFakeMfp = (): Promise<{ server: Server; port: number; requests: RecordedRequest[] }> => {
  const requests: RecordedRequest[] = [];
  const manifest = '#EXTM3U\n#EXTINF:6,\nhttps://public.example/proxy/hls/segment.ts?api_password=s&d=seg0\n';

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push({ url: req.url ?? '', method: req.method ?? '', headers: { ...req.headers } });

    if (req.url?.startsWith('/proxy/hls/manifest.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.writeHead(200);
      res.end(manifest);
      return;
    }
    if (req.url?.startsWith('/proxy/stream')) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      const range = req.headers['range'];
      const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
      if (range && m) {
        res.setHeader('Content-Range', 'bytes 10-19/100');
        res.setHeader('Content-Length', '10');
        res.writeHead(206);
        res.end(Buffer.alloc(10));
      } else {
        res.setHeader('Content-Length', '100');
        res.writeHead(200);
        res.end(Buffer.alloc(100));
      }
      return;
    }
    if (req.url?.startsWith('/extractor/video')) {
      res.setHeader('Location', 'https://public.example/proxy/hls/manifest.m3u8?api_password=s&d=resolved');
      res.writeHead(307);
      res.end();
      return;
    }
    if (req.url?.startsWith('/_token_')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.writeHead(200);
      res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nhttps://public.example/_token_tk2/proxy/hls/segment.ts\n#EXT-X-ENDLIST\n');
      return;
    }
    res.writeHead(500);
    res.end('boom');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port, requests });
    });
  });
};

let mfp: Awaited<ReturnType<typeof startFakeMfp>>;
let app: express.Express;
let server: Server;
let port: number;
const oldEnv = process.env['MEDIA_FLOW_PROXY_URL'];

beforeAll(async () => {
  mfp = await startFakeMfp();
  process.env['MEDIA_FLOW_PROXY_URL'] = `http://127.0.0.1:${mfp.port}`;

  app = express();
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });
  app.use('/', (new MediaFlowProxyController(logger)).router);

  const active = app;
  server = await new Promise<Server>((resolve) => {
    const s = active.listen(0, '127.0.0.1', () => resolve(s));
  });
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => mfp.server.close(() => resolve()));
  if (oldEnv === undefined) delete process.env['MEDIA_FLOW_PROXY_URL'];
  else process.env['MEDIA_FLOW_PROXY_URL'] = oldEnv;
});

beforeEach(() => {
  mfp.requests.length = 0;
});

describe('MediaFlowProxyController', () => {
  test('relays /proxy/hls/manifest.m3u8 and forwards the public host headers upstream', async () => {
    const res = await rawGet(`http://127.0.0.1:${port}/proxy/hls/manifest.m3u8?api_password=s&d=https%3A%2F%2Fexample.com%2Fx.m3u8`, { 'X-Forwarded-Proto': 'https', Host: 'public.example' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(res.body.toString()).toContain('#EXTM3U');

    expect(mfp.requests).toHaveLength(1);
    const upstream = mfp.requests[0]!;
    expect(upstream.method).toBe('GET');
    expect(upstream.url).toBe('/proxy/hls/manifest.m3u8?api_password=s&d=https%3A%2F%2Fexample.com%2Fx.m3u8');
    expect(upstream.headers['x-forwarded-proto']).toBe('https');
    expect(upstream.headers['x-forwarded-host']).toBe('public.example');
  });

  test('falls back to the incoming Host header when x-forwarded-host is absent', async () => {
    await fetch(`http://127.0.0.1:${port}/proxy/hls/manifest.m3u8?d=x`);
    const upstream = mfp.requests[0]!;
    expect(upstream.headers['x-forwarded-host']).toBe(`127.0.0.1:${port}`);
    expect(upstream.headers['x-forwarded-proto']).toBe('http');
  });

  test('forwards the player Range and passes 206 through', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/proxy/stream?api_password=s&d=file`, {
      headers: { Range: 'bytes=10-19' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(10);
    expect(mfp.requests[0]?.headers['range']).toBe('bytes=10-19');
  });

  test('relays /extractor/video redirects (307) verbatim', async () => {
    const res = await rawGet(`http://127.0.0.1:${port}/extractor/video?host=filemoon&api_password=s&d=page&redirect_stream=true`, { 'X-Forwarded-Proto': 'https', Host: 'public.example' });
    expect(res.status).toBe(307);
    expect(res.headers['location']).toBe('https://public.example/proxy/hls/manifest.m3u8?api_password=s&d=resolved');
  });

  test('relays MFP /_token_ child playlists verbatim', async () => {
    const res = await rawGet(`http://127.0.0.1:${port}/_token_tk1/proxy/hls/manifest`, { 'X-Forwarded-Proto': 'https', Host: 'public.example' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(res.body.toString()).toContain('#EXT-X-ENDLIST');

    expect(mfp.requests).toHaveLength(1);
    const upstream = mfp.requests[0]!;
    // The encrypted token must reach MFP intact so its middleware can decrypt it.
    expect(upstream.url).toBe('/_token_tk1/proxy/hls/manifest');
    expect(upstream.headers['x-forwarded-host']).toBe('public.example');
  });

  test('answers CORS preflights without hitting the upstream', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/proxy/hls/manifest.m3u8`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(mfp.requests).toHaveLength(0);
  });

  test('does not relay paths outside /proxy/ and /extractor/', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/not-relayed?d=x`);
    expect(res.status).toBe(404);
    expect(mfp.requests).toHaveLength(0);
  });

  test('passes upstream errors through as status', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/proxy/bogus`);
    expect(res.status).toBe(500);
  });
});
