import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { Gdflix } from './Gdflix';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const ctx = createTestContext();

const gdflixUrl = new URL('https://gdflix.dev/file/XKINoNPB3U6BUBZ');
const busyUrl = new URL('https://instant.busycdn.xyz/abc?bytes=23515176098');
const googleUrl = 'https://video-downloads.googleusercontent.com/ADGPM2nBOf6efkEoJi3token';

describe('Gdflix', () => {
  test('resolves gdflix file page -> busycdn 302 -> fastcdn ?url=<google> -> /relay', async () => {
    const fetcher = new FetcherMock(`${__dirname}/__fixtures__/Gdflix`);
    const extractor = new Gdflix(fetcher, logger);

    jest.spyOn(fetcher, 'text').mockImplementation(async (_c: unknown, url: URL) => {
      if (url.hostname === 'gdflix.dev') {
        return `<a class="premium-btn" href="${busyUrl.href}">Instant Download</a>`;
      }
      return '';
    });
    jest.spyOn(fetcher, 'fetch').mockImplementation(async (_c: unknown, url: URL) => {
      if (url.hostname === 'instant.busycdn.xyz') {
        return {
          data: '',
          headers: { location: `https://fastcdn-dl.pages.dev/?url=${googleUrl}` },
          status: 302,
          statusText: 'Found',
          config: {} as never,
        };
      }
      return { data: '', headers: {}, status: 200, statusText: 'OK', config: {} as never };
    });

    const results = await extractor.extract(ctx, gdflixUrl, { sourceLabel: 'WorldFree4u', height: 2160 });
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r?.url.pathname).toBe('/relay');
    expect(r?.url.searchParams.get('url')).toBe(googleUrl);
    expect(r?.url.searchParams.get('url')).toContain('video-downloads.googleusercontent.com');
    expect(r?.notWebReady).toBe(true);
    expect(r?.meta?.extractorId).toBe('gdflix');
  });

  test('returns empty when the file page has no busycdn link', async () => {
    const fetcher = new FetcherMock(`${__dirname}/__fixtures__/Gdflix`);
    const extractor = new Gdflix(fetcher, logger);
    jest.spyOn(fetcher, 'text').mockResolvedValue('<html>no download links here</html>');

    const results = await extractor.extract(ctx, gdflixUrl, { sourceLabel: 'WorldFree4u' });
    expect(results).toHaveLength(0);
  });

  test('returns empty when busycdn does not redirect to a google video URL', async () => {
    const fetcher = new FetcherMock(`${__dirname}/__fixtures__/Gdflix`);
    const extractor = new Gdflix(fetcher, logger);
    jest.spyOn(fetcher, 'text').mockResolvedValue(`<a href="${busyUrl.href}">Instant Download</a>`);
    jest.spyOn(fetcher, 'fetch').mockResolvedValue({
      data: '',
      headers: { location: 'https://fastcdn-dl.pages.dev/?url=https://example.com/not-google' },
      status: 302,
      statusText: 'Found',
      config: {} as never,
    });

    const results = await extractor.extract(ctx, gdflixUrl, { sourceLabel: 'WorldFree4u' });
    expect(results).toHaveLength(0);
  });

  test('supports only gdflix hosts', () => {
    const fetcher = new FetcherMock(`${__dirname}/__fixtures__/Gdflix`);
    const extractor = new Gdflix(fetcher, logger);
    expect(extractor.supports(ctx, new URL('https://gdflix.dev/file/abc'))).toBe(true);
    expect(extractor.supports(ctx, new URL('https://new1.gdflix.io/file/abc'))).toBe(true);
    expect(extractor.supports(ctx, new URL('https://gofile.io/d/abc'))).toBe(false);
  });

  describe('lazy extraction (stream-build path)', () => {
    // The gdflix chain (FlareSolverr + busycdn) is slow (~10-15s). StreamResolver awaits a source's
    // extractions with Promise.all, so a blocking extraction would drop EVERY WorldFree4u stream
    // from the response. Lazy extraction returns an instant /extract/ proxy without awaiting, and
    // pre-warms the real extraction in the background so play-time finds a warm cache.
    test('handle(allowLazy=true) returns a /extract/ proxy and pre-warms the cache for play-time', async () => {
      const fetcher = new FetcherMock(`${__dirname}/__fixtures__/Gdflix`);
      const textSpy = jest.spyOn(fetcher, 'text').mockImplementation(async (_c: unknown, url: URL) =>
        url.hostname === 'gdflix.dev' ? `<a class="premium-btn" href="${busyUrl.href}">Instant Download</a>` : '',
      );
      jest.spyOn(fetcher, 'fetch').mockImplementation(async (_c: unknown, url: URL) =>
        url.hostname === 'instant.busycdn.xyz'
          ? { data: '', headers: { location: `https://fastcdn-dl.pages.dev/?url=${googleUrl}` }, status: 302, statusText: 'Found', config: {} as never }
          : { data: '', headers: {}, status: 200, statusText: 'OK', config: {} as never },
      );
      const registry = new ExtractorRegistry(logger, [new Gdflix(fetcher, logger)]);
      const meta = { sourceLabel: 'WorldFree4u', height: 2160 };

      // Stream-list path: instant /extract/ proxy — no await on the FlareSolverr chain.
      const proxy = await registry.handle(ctx, gdflixUrl, meta, true);
      expect(proxy).toHaveLength(1);
      expect(proxy[0]?.url.pathname).toContain('/extract');
      expect(proxy[0]?.url.searchParams.get('url')).toBe(gdflixUrl.href);

      // Let the fire-and-forget pre-warm finish (mocked fetches resolve immediately).
      await new Promise(resolve => setTimeout(resolve, 50));

      // Play-time path (ExtractController): pre-warm warmed urlResultCache → cached google /relay,
      // returned without re-running the chain.
      const played = await registry.handle(ctx, gdflixUrl, meta, false);
      expect(played).toHaveLength(1);
      expect(played[0]?.url.pathname).toBe('/relay');
      expect(played[0]?.url.searchParams.get('url')).toBe(googleUrl);
      // The file page was fetched exactly once (pre-warm); the cached play-time call did not re-fetch.
      expect(textSpy).toHaveBeenCalledTimes(1);
    });
  });
});
