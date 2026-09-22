import winston from 'winston';
import { createExtractors, ExtractorRegistry } from '../extractor';
import { createSources } from '../source';
import { createTestContext } from '../test';
import { FetcherMock } from './FetcherMock';
import { ImdbId, TmdbId } from './id';
import { StreamResolver } from './StreamResolver';

process.env['DISABLE_DEAD_LINK_FILTER'] = '1';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

/**
 * StreamResolver races every enabled source against STREAM_MAX_MS (default 18s). This test
 * materialises the full source/extractor list and resolves a sample movie + series to confirm
 * the combined batch reliably returns before Stremio's client timeout, even when individual
 * sources fail or return empty.
 */
describe('StreamResolver deadline', () => {
  const fetcher = new FetcherMock(`${__dirname}/__fixtures__/Timing`);
  const sources = createSources(fetcher);
  const extractorRegistry = new ExtractorRegistry(logger, createExtractors(fetcher, logger));
  const resolver = new StreamResolver(logger, extractorRegistry);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('resolves all enabled movie sources before the 18s stream deadline', async () => {
    const start = performance.now();
    const result = await resolver.resolve(
      createTestContext(),
      sources,
      'movie',
      new ImdbId('tt0137523', undefined, undefined),
    );
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(18000);
    expect(result).toHaveProperty('streams');
  });

  test('resolves all enabled series sources before the 18s stream deadline', async () => {
    const start = performance.now();
    const result = await resolver.resolve(
      createTestContext(),
      sources,
      'series',
      new TmdbId(1396, 1, 1),
    );
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(18000);
    expect(result).toHaveProperty('streams');
  });
});
