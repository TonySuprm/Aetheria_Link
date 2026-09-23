import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { MovieBox } from './MovieBox';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new MovieBox(new FetcherMock(`${__dirname}/__fixtures__/MovieBox`), logger)]);

const ctx = createTestContext();

describe('MovieBox', () => {
  test('Avatar movie streams', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://themoviebox.org/moviesDetail/avatar-WLDIi21IUBa'))).toMatchSnapshot();
  });

  test('Breaking Bad S01E01 streams', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://themoviebox.org/moviesDetail/breaking-bad-ej6Bp0MCAo7'))).toMatchSnapshot();
  });

  test('No streams available', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://themoviebox.org/moviesDetail/no-streams-abc123'))).toMatchSnapshot();
  });

  test('Empty page returns empty', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://themoviebox.org/moviesDetail/empty-page-xyz'))).toMatchSnapshot();
  });

  test('supports themoviebox.org MoviesDetail URLs', () => {
    const extractor = new MovieBox(new FetcherMock(`${__dirname}/__fixtures__/MovieBox`), logger);
    expect(extractor.supports(ctx, new URL('https://themoviebox.org/moviesDetail/avatar-WLDIi21IUBa'))).toBe(true);
  });

  test('does not support themoviebox.org URLs outside MoviesDetail', () => {
    const extractor = new MovieBox(new FetcherMock(`${__dirname}/__fixtures__/MovieBox`), logger);
    expect(extractor.supports(ctx, new URL('https://themoviebox.org/newWeb/searchResult?keyword=Avatar'))).toBe(false);
  });

  test('does not support other URLs', () => {
    const extractor = new MovieBox(new FetcherMock(`${__dirname}/__fixtures__/MovieBox`), logger);
    expect(extractor.supports(ctx, new URL('https://example.com/play?id=123'))).toBe(false);
  });
});
