import axios from 'axios';
import { ContentType } from 'stremio-addon-sdk';
import winston from 'winston';
import { createTestContext } from '../test';
import { Fetcher, TmdbId } from '../utils';
import { PaheInk } from './PaheInk';
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

const searchPage = (title: string, href: string) => `
  <html><body>
    <h2 class="entry-title"><a href="${href}" title="${title}">${title}</a></h2>
  </body></html>
`;

const seriesPostPage = () => `
  <div class="post-tabs-ver">
    <ul class="tabs-nav">
      <li>Episode 1</li>
      <li>Episode 2-4</li>
    </ul>
    <div class="pane">
      <div class="box download"><div class="box-inner-block">
        <span style="color: #00ccff;"><b>Episode 1</b></span><br />
        720p x264 | 400 MB<br />
        <a href="https://tpi.li/abc123" target="_blank" class="shortc-button small red">MG</a>
        <a href="https://tpi.li/def456" target="_blank" class="shortc-button small purple">GD</a>
        &nbsp;<br />&nbsp;<br />
        1080p x265 6CH | 973 MB<br />
        <a href="https://tpi.li/ghi789" target="_blank" class="shortc-button small red">MG</a>
        <a href="https://tpi.li/jkl012" target="_blank" class="shortc-button small green">SD</a>
      </div></div>
    </div>
    <div class="pane">
      <div class="box download"><div class="box-inner-block">
        <span style="color: #00ccff;"><b>Episode 2-4</b></span><br />
        1080p x264 6CH | 2.90 GB<br />
        <a href="https://oii.la/xyz999" target="_blank" class="shortc-button small red">MG</a>
      </div></div>
    </div>
  </div>
`;

const moviePostPage = () => `
  <div class="box download"><div class="box-inner-block">
    480p x264 | 200 MB<br />
    <a href="https://tpi.li/lowq" target="_blank" class="shortc-button small red">MG</a>
    &nbsp;<br />&nbsp;<br />
    1080p x264 6CH | 1.49 GB<br />
    <a href="https://tpi.li/movie1080x264" target="_blank" class="shortc-button small red">MG</a>
    &nbsp;<br />&nbsp;<br />
    2160p x265 6CH | 4.20 GB<br />
    <a href="https://tpi.li/movie4kx265" target="_blank" class="shortc-button small red">MG</a>
  </div></div>
`;

const resolvedShortlinkPage = (destination: string) => {
  const b64 = Buffer.from(destination).toString('base64');
  return `
    <form>
      <input name="token" value="sigprefix${b64}" />
    </form>
  `;
};

describe('PaheInk', () => {
  let source: PaheInk;
  let fetcher: Fetcher;

  beforeEach(() => {
    Source.resetCache();
    fetcher = createFetcher();
    source = new PaheInk(fetcher);
    jest.spyOn(fetcher, 'head').mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockJson = () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'api.themoviedb.org') return seriesTmdb('Example Show', 2024);
      throw new Error('Unexpected JSON fetch');
    });
  };

  const mockText = (responses: { test: (url: URL) => boolean; html: string }[]) => {
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
      const match = responses.find(r => r.test(url));
      if (match) return match.html;
      throw new Error(`Unexpected fetch ${url.href}`);
    });
  };

  test('ignores unsupported content types', async () => {
    mockJson();
    const results = await source['handleInternal'](ctx, 'channel' as ContentType, new TmdbId(1));
    expect(results).toHaveLength(0);
  });

  test('series: returns 1080p/2160p x264/x265 links for requested episode only', async () => {
    mockJson();
    mockText([
      {
        test: url => url.searchParams.has('s'),
        html: searchPage('Example Show Season 1 WEB-DL', 'https://pahe.ink/example-show-s1/'),
      },
      {
        test: url => url.pathname.includes('example-show-s1'),
        html: seriesPostPage(),
      },
      {
        test: url => url.hostname === 'tpi.li' && url.pathname.includes('ghi789'),
        html: resolvedShortlinkPage('https://mega.nz/file/ABC#xyz'),
      },
      {
        test: url => url.hostname === 'tpi.li' && url.pathname.includes('jkl012'),
        html: resolvedShortlinkPage('https://send.now/abc123'),
      },
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 1, 1));

    expect(results).toHaveLength(2);
    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://mega.nz/file/ABC#xyz');
    expect(hrefs).toContain('https://send.now/abc123');

    const mega = results.find(r => r.url.hostname === 'mega.nz');
    expect(mega?.meta.height).toBe(1080);
    expect(mega?.meta.title).toContain('1080p x265');
  });

  test('series: matches episode inside a range tab', async () => {
    mockJson();
    mockText([
      {
        test: url => url.searchParams.has('s'),
        html: searchPage('Example Show Season 1 WEB-DL', 'https://pahe.ink/example-show-s1/'),
      },
      {
        test: url => url.pathname.includes('example-show-s1'),
        html: seriesPostPage(),
      },
      {
        test: url => url.hostname === 'oii.la',
        html: resolvedShortlinkPage('https://mega.nz/folder/XYZ'),
      },
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 1, 3));
    expect(results).toHaveLength(1);
    expect(results[0].url.href).toBe('https://mega.nz/folder/XYZ');
  });

  test('movie: returns 1080p and 2160p links', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'api.themoviedb.org') return movieTmdb('Example Movie', 2024);
      throw new Error('Unexpected JSON fetch');
    });
    mockText([
      {
        test: url => url.searchParams.has('s'),
        html: searchPage('Example Movie (2024) BluRay', 'https://pahe.ink/example-movie-2024/'),
      },
      {
        test: url => url.pathname.includes('example-movie-2024'),
        html: moviePostPage(),
      },
      {
        test: url => url.hostname === 'tpi.li' && url.pathname.includes('movie1080x264'),
        html: resolvedShortlinkPage('https://gdflix.dev/file/1080x264'),
      },
      {
        test: url => url.hostname === 'tpi.li' && url.pathname.includes('movie4kx265'),
        html: resolvedShortlinkPage('https://mega.nz/file/4K'),
      },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(1));

    expect(results).toHaveLength(2);
    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://gdflix.dev/file/1080x264');
    expect(hrefs).toContain('https://mega.nz/file/4K');
  });

  test('skips unsupported bot-protected shorteners', async () => {
    mockJson();
    mockText([
      {
        test: url => url.searchParams.has('s'),
        html: searchPage('Example Show Season 1 WEB-DL', 'https://pahe.ink/example-show-s1/'),
      },
      {
        test: url => url.pathname.includes('example-show-s1'),
        html: `
          <div class="post-tabs-ver">
            <ul class="tabs-nav"><li>Episode 1</li></ul>
            <div class="pane">
              <div class="box download"><div class="box-inner-block">
                <span style="color: #00ccff;"><b>Episode 1</b></span><br />
                1080p x265 6CH | 717 MB<br />
                <a href="https://teknoasian.com/?ht=abc" target="_blank" class="shortc-button small red">MG</a>
              </div></div>
            </div>
          </div>
        `,
      },
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 1, 1));
    expect(results).toHaveLength(0);
  });
});
