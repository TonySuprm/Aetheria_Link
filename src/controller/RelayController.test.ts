import { createServer, get, IncomingMessage, Server, ServerResponse } from 'node:http';
import express from 'express';
import winston from 'winston';
import { RelayController } from './RelayController';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

/** A fake upstream that mimics dl.dramasuki.xyz: serves a fixed buffer via plain GET only (it does
 * NOT honour Range — exactly like the real GDrive-backed host under quota enforcement). The relay
 * must translate the player's Range into a slice of this plain GET. */
const startFakeUpstream = (size: number): Promise<{ server: Server; port: number; data: Buffer }> => {
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    data[i] = i % 256;
  }
  let throttleHits = 0;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // 111477.xyz-style redirect hop: /redir.mkv -> /range.mkv
    if (req.url === '/redir.mkv') {
      res.writeHead(302, { Location: '/range.mkv' });
      res.end();
      return;
    }
    // workers.dev-style CDN endpoint that HONOURS Range -> 206 (111477.xyz profile)
    if (req.url === '/range.mkv') {
      res.setHeader('Content-Type', 'video/x-matroska');
      res.setHeader('Accept-Ranges', 'bytes');
      const range = req.headers['range'];
      const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
      if (range && m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : size - 1;
        const clampedEnd = Math.min(end, size - 1);
        res.setHeader('Content-Range', `bytes ${start}-${clampedEnd}/${size}`);
        res.setHeader('Content-Length', String(clampedEnd - start + 1));
        res.writeHead(206);
        res.end(data.subarray(start, clampedEnd + 1));
      } else {
        res.setHeader('Content-Length', size);
        res.writeHead(200);
        res.end(data);
      }
      return;
    }
    // dl.dramasuki.xyz-style: plain 200 full, ignores Range (GDrive quota rejects Range)
    if (req.url === '/file.mkv') {
      res.setHeader('Content-Type', 'video/x-matroska');
      res.setHeader('Content-Length', size);
      res.writeHead(200);
      res.end(data);
      return;
    }
    // workers.dev-style CDN that throttles the first request with 429 + Retry-After,
    // then serves the range on retry (mirrors the real 111477.xyz burst behaviour).
    if (req.url === '/throttle.mkv') {
      throttleHits += 1;
      if (throttleHits === 1) {
        res.setHeader('Retry-After', '1');
        res.writeHead(429);
        res.end('rate limited');
        return;
      }
      res.setHeader('Content-Type', 'video/x-matroska');
      res.setHeader('Accept-Ranges', 'bytes');
      const range = req.headers['range'];
      const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
      if (range && m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : size - 1;
        const clampedEnd = Math.min(end, size - 1);
        res.setHeader('Content-Range', `bytes ${start}-${clampedEnd}/${size}`);
        res.setHeader('Content-Length', String(clampedEnd - start + 1));
        res.writeHead(206);
        res.end(data.subarray(start, clampedEnd + 1));
      } else {
        res.setHeader('Content-Length', size);
        res.writeHead(200);
        res.end(data);
      }
      return;
    }
    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      resolve({ server, port: (server.address() as { port: number }).port, data });
    });
  });
};

const startRelayApp = (): Promise<{ app: express.Express; server: Server; port: number }> => {
  const app = express();
  app.use('/', (new RelayController(logger)).router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ app, server, port: (server.address() as { port: number }).port });
    });
  });
};

interface RelayResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** Hit the relay with an optional Range header and return the parsed response. */
const fetchRelay = (port: number, url: string, range?: string): Promise<RelayResponse> => {
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(`/relay?url=${encodeURIComponent(url)}`, `http://127.0.0.1:${port}`);
    const opts = range ? { headers: { Range: range } } : {};
    const req = get(reqUrl, opts, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers as Record<string, string | string[] | undefined>,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
  });
};

describe('RelayController', () => {
  let upstream: { server: Server; port: number; data: Buffer };
  let relay: { app: express.Express; server: Server; port: number };

  beforeAll(async () => {
    upstream = await startFakeUpstream(2000);
    process.env['RELAY_TEST_UPSTREAM'] = `http://127.0.0.1:${upstream.port}`;
    relay = await startRelayApp();
  });

  afterAll(async () => {
    await new Promise<void>(r => upstream.server.close(() => r()));
    await new Promise<void>(r => relay.server.close(() => r()));
    delete process.env['RELAY_TEST_UPSTREAM'];
  });

  test('translates a Range request into a slice of a plain-GET upstream', async () => {
    const res = await fetchRelay(relay.port, 'https://dl.dramasuki.xyz/file.mkv', 'bytes=10-19');
    expect(res.status).toBe(206);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toBe('bytes 10-19/2000');
    expect(res.headers['content-length']).toBe('10');
    expect(res.body).toEqual(upstream.data.subarray(10, 20));
  });

  test('serves the full file (HTTP 200) when no Range is requested', async () => {
    const res = await fetchRelay(relay.port, 'https://dl.dramasuki.xyz/file.mkv');
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('2000');
    expect(res.body.length).toBe(2000);
    expect(res.body).toEqual(upstream.data);
  });

  test('honours a suffix range (bytes=-N = last N bytes)', async () => {
    const res = await fetchRelay(relay.port, 'https://dl.dramasuki.xyz/file.mkv', 'bytes=-50');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 1950-1999/2000');
    expect(res.body).toEqual(upstream.data.subarray(1950));
  });

  test('rejects a non-allow-listed host', async () => {
    const res = await fetchRelay(relay.port, 'https://evil.example/file.mkv');
    expect(res.status).toBe(403);
  });

  test('rejects a malformed url', async () => {
    const res = await fetchRelay(relay.port, 'not-a-url');
    expect(res.status).toBe(400);
  });

  // 111477.xyz profile: Range-forward entry. The player's Range is forwarded upstream and the
  // upstream 206 (+ Content-Range/Content-Length) is passed through verbatim — no local slicing.
  test('forwards Range upstream for 111477.xyz and passes the 206 through (no redirect)', async () => {
    const res = await fetchRelay(relay.port, 'https://111477.xyz/range.mkv', 'bytes=10-19');
    expect(res.status).toBe(206);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toBe('bytes 10-19/2000');
    expect(res.headers['content-length']).toBe('10');
    expect(res.body).toEqual(upstream.data.subarray(10, 20));
  });

  test('follows a 302 redirect for 111477.xyz and forwards Range to the final target', async () => {
    const res = await fetchRelay(relay.port, 'https://111477.xyz/redir.mkv', 'bytes=10-19');
    expect(res.status).toBe(206);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toBe('bytes 10-19/2000');
    expect(res.headers['content-length']).toBe('10');
    expect(res.body).toEqual(upstream.data.subarray(10, 20));
  });

  // Regression: a 429 + Retry-After from the workers.dev CDN must NOT abort the relay
  // (the old HEAD pre-flight returned an instant 502 here, leaving Stremio stuck at
  // 0:00). The GET path must honour Retry-After, retry, and pass the eventual 206 through.
  test('recovers from a 429 + Retry-After by retrying and passing the 206 through', async () => {
    const res = await fetchRelay(relay.port, 'https://111477.xyz/throttle.mkv', 'bytes=10-19');
    expect(res.status).toBe(206);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toBe('bytes 10-19/2000');
    expect(res.headers['content-length']).toBe('10');
    expect(res.body).toEqual(upstream.data.subarray(10, 20));
  });

  // Regression: a LARGE no-Range upstream (e.g. GDFlix 4K 21.9GB via google, which ignores Range
  // and always returns 200 from byte 0) must NOT advertise fake seekability. If it did, ffmpeg
  // would seek forward to the Matroska Cues (~GBs in) during header parsing and the relay would
  // have to download the whole prefix before serving a single sought byte -> stuck at 0:00. Instead
  // serve a genuinely non-seekable 200 stream so ffmpeg reads sequentially from the start.
  test('serves a non-seekable 200 stream (no Accept-Ranges) for a large no-Range file', async () => {
    process.env['RELAY_NON_SEEKABLE_THRESHOLD'] = '100'; // 2000-byte mock now counts as "large"
    const localRelay = await startRelayApp();
    try {
      const res = await fetchRelay(localRelay.port, 'https://dl.dramasuki.xyz/file.mkv', 'bytes=10-19');
      expect(res.status).toBe(200); // NOT 206 — Range ignored
      expect(res.headers['accept-ranges']).toBeUndefined(); // no fake seekability advertised
      expect(res.headers['content-range']).toBeUndefined();
      expect(res.headers['content-length']).toBe('2000'); // full size, streamed from byte 0
      expect(res.body).toEqual(upstream.data); // whole file from the start
    } finally {
      await new Promise<void>(r => localRelay.server.close(() => r()));
      delete process.env['RELAY_NON_SEEKABLE_THRESHOLD'];
    }
  });
});
