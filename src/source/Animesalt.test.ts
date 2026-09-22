import axios from 'axios';
import winston from 'winston';
import { createTestContext } from '../test';
import { Fetcher, TmdbId } from '../utils';
import { Animesalt } from './Animesalt';
import { Source } from './Source';

const ctx = createTestContext();
const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

/** Episode/movie page HTML with a FirePlayer iframe containing the video hash. */
const episodePage = (hash: string): string => `
  <html><body>
    <iframe src="https://as-cdn21.top/video/${hash}"></iframe>
  </body></html>`;

describe('Animesalt', () => {
  let source: Animesalt;
  let fetcher: Fetcher;

  beforeEach(() => {
    Source.resetCache();
    fetcher = new Fetcher(axios.create(), logger);
    source = new Animesalt(fetcher);
  });

  test('movie resolves to HLS m3u8 via FirePlayer API', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'api.themoviedb.org') return { title: 'Your Name', release_date: '2016-08-26' };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.searchParams.has('s')) return `<a href="https://animesalt.link/movies/your-name/">Your Name</a>`;
      if (url.pathname === '/movies/your-name/') return episodePage('abc123def456');
      return '';
    });
    jest.spyOn(fetcher, 'textPost').mockResolvedValue(
      JSON.stringify({ hls: true, videoSource: 'https://as-cdn21.top/cdn/hls/xyz/master.m3u8?md5=abc&expires=999' }),
    );

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
    expect(results).toHaveLength(1);
    expect(results[0].url.pathname).toBe('/cdn/hls/xyz/master.m3u8');
    expect(results[0].meta.height).toBe(1080);
    expect(results[0].meta.title).toContain('Your Name');
    expect(results[0].meta.referer).toContain('as-cdn21.top');
  });

  test('series finds the matching episode and resolves to HLS', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'api.themoviedb.org') return { name: 'Cells at Work!', first_air_date: '2018-07-07' };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.searchParams.has('s')) return `<a href="https://animesalt.link/series/cells-at-work/">Cells at Work!</a>`;
      if (url.pathname === '/series/cells-at-work/') {
        return `<a href="https://animesalt.link/episode/cells-at-work-1x1/">EP1</a><a href="https://animesalt.link/episode/cells-at-work-1x2/">EP2</a>`;
      }
      if (url.pathname === '/episode/cells-at-work-1x1/') return episodePage('abc123def456');
      return '';
    });
    jest.spyOn(fetcher, 'textPost').mockResolvedValue(
      JSON.stringify({ hls: true, videoSource: 'https://as-cdn21.top/cdn/hls/abc/master.m3u8?md5=x&expires=999' }),
    );

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(200, 1, 1));
    expect(results).toHaveLength(1);
    expect(results[0].url.hostname).toBe('as-cdn21.top');
    expect(results[0].url.pathname).toContain('master.m3u8');
    expect(results[0].meta.season).toBe(1);
    expect(results[0].meta.episode).toBe(1);
  });

  test('series returns empty when the requested episode is not listed', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'api.themoviedb.org') return { name: 'Cells at Work!', first_air_date: '2018-07-07' };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.searchParams.has('s')) return `<a href="https://animesalt.link/series/cells-at-work/">Cells at Work!</a>`;
      if (url.pathname === '/series/cells-at-work/') return `<a href="https://animesalt.link/episode/cells-at-work-1x1/">EP1</a>`;
      return '';
    });

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(200, 1, 5));
    expect(results).toEqual([]);
  });

  test('returns empty when no post matches the name', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'api.themoviedb.org') return { title: 'Totally Unknown Movie', release_date: '2020-01-01' };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockResolvedValue('<html><body></body></html>');

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(999, undefined, undefined));
    expect(results).toEqual([]);
  });

  test('returns empty when episode page has no video hash', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'api.themoviedb.org') return { title: 'Your Name', release_date: '2016-08-26' };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.searchParams.has('s')) return `<a href="https://animesalt.link/movies/your-name/">Your Name</a>`;
      if (url.pathname === '/movies/your-name/') return '<html><body>No player here</body></html>';
      return '';
    });

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
    expect(results).toEqual([]);
  });

  test('returns empty when FirePlayer API returns no videoSource', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'api.themoviedb.org') return { title: 'Your Name', release_date: '2016-08-26' };
      return {};
    });
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.searchParams.has('s')) return `<a href="https://animesalt.link/movies/your-name/">Your Name</a>`;
      if (url.pathname === '/movies/your-name/') return episodePage('deadbeef');
      return '';
    });
    jest.spyOn(fetcher, 'textPost').mockResolvedValue(JSON.stringify({ hls: false, videoSource: null }));

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
    expect(results).toEqual([]);
  });
});
