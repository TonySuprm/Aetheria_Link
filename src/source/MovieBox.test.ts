import { createTestContext } from '../test';
import { FetcherMock, TmdbId } from '../utils';
import { MovieBox } from './MovieBox';

const ctx = createTestContext();

describe('MovieBox', () => {
  let source: MovieBox;

  beforeEach(() => {
    source = new MovieBox(new FetcherMock(`${__dirname}/__fixtures__/MovieBox`));
  });

  test('handle movie avatar', async () => {
    const streams = await source.handle(ctx, 'movie', new TmdbId(19995, undefined, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('handle tv returns empty (TV unsupported natively)', async () => {
    const streams = await source.handle(ctx, 'series', new TmdbId(1396, 1, 1));
    expect(streams).toHaveLength(0);
  });

  test('handle not found movie', async () => {
    const streams = await source.handle(ctx, 'movie', new TmdbId(9999999, undefined, undefined));
    expect(streams).toHaveLength(0);
  });

  test('handle movie found in search returns detail url', async () => {
    const streams = await source.handle(ctx, 'movie', new TmdbId(7777777, undefined, undefined));
    expect(streams).toHaveLength(1);
    const stream = streams.find(s => s.meta.title === 'NoResourcesMovie (2020)');
    expect(stream).toBeDefined();
    expect(stream?.url.toString()).toBe('https://themoviebox.org/moviesDetail/noresourcesmovie-xyz789');
  });

  test('handle movie with fallback match', async () => {
    const streams = await source.handle(ctx, 'movie', new TmdbId(8888888, undefined, undefined));
    expect(streams).toHaveLength(1);
    const stream = streams.find(s => s.meta.title === 'FallbackMovie (2022)');
    expect(stream).toBeDefined();
    expect(stream?.url.toString()).toBe('https://themoviebox.org/moviesDetail/the-fallbackmovie-saga-abc123');
  });

  test('returns empty when search page payload is non-JSON', async () => {
    const streams = await source.handle(ctx, 'movie', new TmdbId(6666666, undefined, undefined));
    expect(streams).toHaveLength(0);
  });
});
