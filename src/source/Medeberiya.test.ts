import axios from 'axios';
import { ContentType } from 'stremio-addon-sdk';
import winston from 'winston';
import { createTestContext } from '../test';
import { Fetcher, TmdbId } from '../utils';
import { Medeberiya } from './Medeberiya';
import { Source } from './Source';

const ctx = createTestContext();
const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

const createFetcher = () => new Fetcher(axios.create(), logger);

const movieTmdb = (name: string, year: number) => ({
  title: name,
  release_date: `${year}-01-01`,
  original_title: name,
  original_language: 'en',
});

const seriesTmdb = (name: string, year: number) => ({
  name,
  first_air_date: `${year}-01-01`,
  original_name: name,
  original_language: 'en',
});

const wpPost = (
  id: number,
  title: string,
  slug: string,
  content: string,
  type: 'post' | 'page' = 'post',
) => ({
  ID: id,
  type,
  title,
  slug,
  content,
  URL: `https://medeberiya1.com/index.php/${slug}/`,
});

describe('Medeberiya', () => {
  let source: Medeberiya;
  let fetcher: Fetcher;

  beforeEach(() => {
    Source.resetCache();
    fetcher = createFetcher();
    source = new Medeberiya(fetcher);
    jest.spyOn(fetcher, 'head').mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockJson = (
    tmdbDetails: unknown,
    wpPosts: unknown[] = [],
    wpPages: unknown[] = [],
  ) => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'api.themoviedb.org') return tmdbDetails;
      if (url.hostname === 'public-api.wordpress.com') {
        if (url.searchParams.get('type') === 'page') {
          return { found: wpPages.length, posts: wpPages };
        }
        return { found: wpPosts.length, posts: wpPosts };
      }
      throw new Error(`Unexpected fetch ${url.href}`);
    });
  };

  test('ignores unsupported content types', async () => {
    mockJson(movieTmdb('Dune', 2021));
    const results = await source['handleInternal'](ctx, 'channel' as ContentType, new TmdbId(1, undefined, undefined));
    expect(results).toHaveLength(0);
  });

  test('movie: collects links while filtering junk/internal links', async () => {
    mockJson(movieTmdb('Dune', 2021), [
      wpPost(1, 'Dune', 'dune', `
        <p><a href="https://streamtape.com/e/abc">Dune 1080p [1.2 GB]</a></p>
        <p><a href="https://mega.nz/file/abc">720p</a></p>
        <p><a href="/index.php/next-post/">Internal link</a></p>
        <p><a href="https://youtube.com/watch">Trailer</a></p>
        <p><a href="https://t.me/medeberiyaa">Telegram</a></p>
        <p><a href="https://example.cdn/direct.mkv">Direct MKV</a></p>
      `),
    ]);

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(1, undefined, undefined));

    expect(results).toHaveLength(3);
    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://streamtape.com/e/abc');
    expect(hrefs).toContain('https://mega.nz/file/abc');
    expect(hrefs).toContain('https://example.cdn/direct.mkv');
    expect(hrefs).not.toContain('https://youtube.com/watch');
    expect(hrefs).not.toContain('https://t.me/medeberiyaa');

    const streamtape = results.find(r => r.url.hostname === 'streamtape.com');
    if (!streamtape) throw new Error('streamtape result missing');
    expect(streamtape.meta.height).toBe(1080);
    expect(streamtape.meta.bytes).toBeGreaterThan(1_000_000_000);
    expect(streamtape.meta.title).toContain('[Medeberiya] streamtape.com - 1080p');
  });

  test('series: returns only links inside the requested episode block', async () => {
    mockJson(seriesTmdb('Breaking Bad', 2008), [
      wpPost(1, 'Breaking Bad', 'breaking-bad', `
        <p><strong>Breaking Bad S01E02:</strong> <a href="https://streamtape.com/e/s1e2">1080p</a> | <a href="https://mega.nz/file/s1e2">720p</a></p>
        <p><strong>Breaking Bad S01E03:</strong> <a href="https://streamtape.com/e/s1e3">1080p</a></p>
      `),
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 1, 2));

    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://streamtape.com/e/s1e2');
    expect(hrefs).toContain('https://mega.nz/file/s1e2');
    expect(hrefs).not.toContain('https://streamtape.com/e/s1e3');
  });

  test('series: matches range batches like S01E01-03 for episode 2', async () => {
    mockJson(seriesTmdb('House of the Dragon', 2022), [
      wpPost(1, 'House of the Dragon', 'house-of-the-dragon', `
        <p><strong>S01E01-03:</strong> <a href="https://streamtape.com/e/range">1080p</a></p>
        <p><strong>S01E04:</strong> <a href="https://streamtape.com/e/s1e4">1080p</a></p>
      `),
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 1, 2));

    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://streamtape.com/e/range');
    expect(hrefs).not.toContain('https://streamtape.com/e/s1e4');
  });

  test('series: includes links from both posts and pages', async () => {
    mockJson(seriesTmdb('Silo', 2023), [], [
      wpPost(2, 'Silo', 'silo', `
        <p><strong>Silo S03E01:</strong> <a href="https://mega.nz/file/s3e1">1080p</a></p>
      `, 'page'),
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 3, 1));

    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://mega.nz/file/s3e1');
  });

  test('returns empty list when WordPress.com API has no matches', async () => {
    mockJson(seriesTmdb('Unknown Show', 2024), []);
    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 1, 1));
    expect(results).toHaveLength(0);
  });

  test('rejects spinoffs and wrong years', async () => {
    mockJson(movieTmdb('Dune', 2021), [
      wpPost(1, 'Dune The Challenge 2021', 'dune-the-challenge-2021', '<p><a href="https://streamtape.com/e/challenge">1080p</a></p>'),
      wpPost(2, 'Dune 2018', 'dune-2018', '<p><a href="https://streamtape.com/e/2018">1080p</a></p>'),
    ]);

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(1, undefined, undefined));
    expect(results).toHaveLength(0);
  });

  test('movie: year mismatch falls back to ±1 tolerance', async () => {
    mockJson(movieTmdb('Dune', 2021), [
      wpPost(1, 'Dune 2022', 'dune-2022', '<p><a href="https://streamtape.com/e/dune">1080p</a></p>'),
    ]);

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(1, undefined, undefined));
    expect(results).toHaveLength(1);
    expect(results[0]?.url.href).toBe('https://streamtape.com/e/dune');
  });
});
