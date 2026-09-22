import winston from 'winston';
import { createTestContext } from '../test';
import { Format, UrlResult } from '../types';
import { StreamResolver } from './StreamResolver';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

const makeUrlResult = (url: string, overrides?: Partial<UrlResult>): UrlResult => ({
  url: new URL(url),
  format: Format.mp4,
  label: 'test',
  ttl: 300000,
  ...overrides,
});

const mockFetch = (responses: Record<string, { status: number; method?: string }>) => {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method as string) ?? 'GET';
    const match = Object.entries(responses).find(([pattern, cfg]) => url.includes(pattern) && (!cfg.method || cfg.method === method));
    const res = match?.[1] ?? { status: 200 };
    return {
      status: res.status,
      headers: new Headers(),
    } as Response;
  });
};

describe('StreamResolver dead-link filter', () => {
  let resolver: StreamResolver;
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    resolver = new StreamResolver(logger, {} as any);
    ctx = createTestContext();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('drops 404 and keeps 200 direct URLs', async () => {
    const fetchMock = mockFetch({
      '/dead.mp4': { status: 404 },
      '/alive.mp4': { status: 200 },
    });
    const urlResults = [
      makeUrlResult('https://cdn.example/dead.mp4'),
      makeUrlResult('https://cdn.example/alive.mp4'),
    ];

    const result = await resolver['filterDeadUrls']({ ...ctx, streamDeadline: Date.now() + 10000 }, urlResults);

    expect(result).toHaveLength(1);
    expect(result[0]?.url.pathname).toBe('/alive.mp4');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('keeps URLs that time out or error', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('ETIMEDOUT');
    });
    const urlResults = [makeUrlResult('https://cdn.example/slow.mp4')];

    const result = await resolver['filterDeadUrls']({ ...ctx, streamDeadline: Date.now() + 10000 }, urlResults);

    expect(result).toHaveLength(1);
  });

  test('probes /extract/ URLs via their target url query parameter', async () => {
    const fetchMock = mockFetch({
      'target.example/dead': { status: 404 },
      'target.example/alive': { status: 200 },
    });
    const urlResults = [
      makeUrlResult('http://127.0.0.1:51546/%7B%22dummy%22%3A%221%22%7D/extract/?index=0&url=https%3A%2F%2Ftarget.example%2Fdead', { format: Format.unknown }),
      makeUrlResult('http://127.0.0.1:51546/%7B%22dummy%22%3A%221%22%7D/extract/?index=0&url=https%3A%2F%2Ftarget.example%2Falive', { format: Format.unknown }),
      makeUrlResult('https://hoster.page/embed/abc', { isExternal: true }),
    ];

    const result = await resolver['filterDeadUrls']({ ...ctx, streamDeadline: Date.now() + 10000 }, urlResults);

    expect(result).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('probes MediaFlow extractor URLs via their d query parameter', async () => {
    const fetchMock = mockFetch({
      'embed.example/video': { status: 410 },
    });
    const urlResults = [
      makeUrlResult('http://127.0.0.1:8156/extractor/video?host=filemoon&api_password=secret&d=https%3A%2F%2Fembed.example%2Fvideo', { format: Format.unknown }),
    ];

    const result = await resolver['filterDeadUrls']({ ...ctx, streamDeadline: Date.now() + 10000 }, urlResults);

    expect(result).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('falls back to GET Range when HEAD returns 405', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method as string) ?? 'GET';
      if (url.includes('/range.mp4') && method === 'HEAD') {
        return { status: 405, headers: new Headers() } as Response;
      }
      if (url.includes('/range.mp4') && method === 'GET') {
        return { status: 200, headers: new Headers() } as Response;
      }
      return { status: 200, headers: new Headers() } as Response;
    });

    const urlResults = [makeUrlResult('https://cdn.example/range.mp4')];
    const result = await resolver['filterDeadUrls']({ ...ctx, streamDeadline: Date.now() + 10000 }, urlResults);

    expect(result).toHaveLength(1);
  });

  test('keeps all URLs when there is no time budget', async () => {
    const fetchMock = mockFetch({ '/dead.mp4': { status: 404 } });
    const urlResults = [makeUrlResult('https://cdn.example/dead.mp4')];

    const result = await resolver['filterDeadUrls']({ ...ctx, streamDeadline: Date.now() + 500 }, urlResults);

    expect(result).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('drops 5xx URLs', async () => {
    mockFetch({ '/error.mp4': { status: 503 } });
    const urlResults = [makeUrlResult('https://cdn.example/error.mp4')];

    const result = await resolver['filterDeadUrls']({ ...ctx, streamDeadline: Date.now() + 10000 }, urlResults);

    expect(result).toHaveLength(0);
  });

  test('uses real extractor for HubDrive/HubCloud URLs that return 200 for dead files', async () => {
    const handle = jest.fn().mockImplementation(async (_ctx, url: URL) => {
      if (url.href.includes('/dead')) return [];
      return [makeUrlResult('https://hubcloud.ist/drive/alive', { format: Format.mp4, label: 'HubCloud' })];
    });
    resolver = new StreamResolver(logger, { handle } as any);
    const fetchMock = jest.spyOn(global, 'fetch'); // should NOT be used for hubs

    const urlResults = [
      makeUrlResult('http://127.0.0.1:51546/%7B%7D/extract/?index=0&url=https%3A%2F%2Fhubdrive.tips%2Ffile%2Fdead', { format: Format.unknown }),
      makeUrlResult('http://127.0.0.1:51546/%7B%7D/extract/?index=0&url=https%3A%2F%2Fhubcloud.ist%2Fdrive%2Falive', { format: Format.unknown }),
    ];

    const result = await resolver['filterDeadUrls']({ ...ctx, streamDeadline: Date.now() + 10000 }, urlResults);

    expect(result).toHaveLength(1);
    expect(result[0]?.url.searchParams.get('url')).toContain('hubcloud.ist/drive/alive');
    expect(handle).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
