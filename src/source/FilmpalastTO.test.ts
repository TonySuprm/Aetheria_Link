import { createTestContext } from '../test';
import { FetcherMock, ImdbId } from '../utils';
import { FilmpalastTO } from './FilmpalastTO';

const ctx = createTestContext({ de: 'on' });

describe('FilmpalastTO', () => {
  let source: FilmpalastTO;

  beforeEach(() => {
    source = new FilmpalastTO(new FetcherMock(`${__dirname}/__fixtures__/FilmpalastTO`));
  });

  test('handles non-existent movies gracefully', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt12345678', undefined, undefined));
    expect(streams).toHaveLength(0);
  });

  test('handles fetch error gracefully', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt9999999', undefined, undefined));
    expect(streams).toHaveLength(0);
  });

  test('handle the matrix', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt0133093', undefined, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('handles embedded player with data-player-url', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt1111111', undefined, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('handles multiple hosters including known streaming hosts', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt2222222', undefined, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('falls back to first result when year does not match', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt3333333', undefined, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('handles series with season and episode', async () => {
    const streams = await source.handle(ctx, 'series', new ImdbId('tt0903747', 2, 3));
    expect(streams).toMatchSnapshot();
  });

  test('handles series with season but no episode', async () => {
    const streams = await source.handle(ctx, 'series', new ImdbId('tt0903747', 1, undefined));
    expect(streams).toMatchSnapshot();
  });

  test('returns empty when search finds no stream page', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt4444444', undefined, undefined));
    expect(streams).toHaveLength(0);
  });

  test('skips malformed href in stream block without throwing', async () => {
    const streams = await source.handle(ctx, 'movie', new ImdbId('tt5555555', undefined, undefined));
    expect(streams).toMatchSnapshot();
  });
});
