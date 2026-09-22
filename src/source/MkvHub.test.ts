import axios from 'axios';
import { ContentType } from 'stremio-addon-sdk';
import winston from 'winston';
import { createTestContext } from '../test';
import { Fetcher, TmdbId } from '../utils';
import { MkvHub } from './MkvHub';
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

const searchPage = (hrefs: string[]) =>
  `<html><body>${hrefs.map(h => `<a href="${h}"></a>`).join('')}</body></html>`;

const moviePostPage = () => `
  <html><body>
    <h3 style="text-align: center;">|| Download 720p HD via Single Links Size: 1.33GB ||</h3>
    <p style="text-align: center;">
      <a class="dbuttn watch" href="https://safe.linkomark.top/view/watch720">Watch Online Links</a>
      <a class="dbuttn blue" href="https://safe.linkomark.top/view/dl720">Get Download Links</a>
      <a class="dbuttn magnet" href="https://get.torrent-box.top/save/abc">Magnet Link</a>
    </p>
    <h3 style="text-align: center;">|| Download 1080p HD via Single Links Size: 2.49GB ||</h3>
    <p style="text-align: center;">
      <a class="dbuttn watch" href="https://safe.linkomark.top/view/watch1080">Watch Online Links</a>
      <a class="dbuttn blue" href="https://safe.linkomark.top/view/dl1080">Get Download Links</a>
      <a class="dbuttn magnet" href="https://get.torrent-box.top/save/def">Magnet Link</a>
    </p>
    <h3 style="text-align: center;">How to Download from MkvHub?</h3>
  </body></html>
`;

const seriesPostPage = () => `
  <html><body>
    <h3 style="text-align: center;">|| Complete Series Download (Ep 01-04) 480p \u2013 963MB Zip ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/zip480">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Complete Series Download (Ep 05-07) 480p \u2013 705MB Zip ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/zip480b">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Download (Ep 08) 480p \u2013 445MB ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/ep8_480">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Complete Series Download (Ep 01-04) 720p \u2013 2.4GB Zip ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/zip720">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Download (Ep 08) 720p \u2013 1.1GB ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/ep8_720">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Complete Series Download (Ep 01-04) 1080p \u2013 4.8GB Zip ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/zip1080">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Download (Ep 08) 1080p \u2013 2.5GB ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/ep8_1080">Get Download Links</a></p>
  </body></html>
`;

const twoLevelSeriesPostPage = () => `
  <html><body>
    <h3 style="text-align: center;">|| Download S03E01 via Single Links ||</h3>
    <h3 style="text-align: center;">|| Download 480p HD via Single Links Size: 232MB ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/e1_480">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Download 720p HD via Single Links Size: 595MB ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/e1_720">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Download 1080p HD via Single Links Size: 1.28GB ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/e1_1080">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Download S03E02 via Single Links ||</h3>
    <h3 style="text-align: center;">|| Download 720p HD via Single Links Size: 573MB ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/e2_720">Get Download Links</a></p>
    <h3 style="text-align: center;">|| Download 1080p HD via Single Links Size: 1.23GB ||</h3>
    <p style="text-align: center;"><a class="dbuttn blue" href="https://secure.linkszilla.top/view/e2_1080">Get Download Links</a></p>
  </body></html>
`;

const multiHosterPage = () =>
  `<html><body>
    <a href="https://hubcloud.cx/drive/abc123">HubCloud</a>
    <a href="https://new2.gdflix.app/file/def456">GDFlix</a>
    <a href="https://gofile.io/d/ghi789">GoFile</a>
    <a href="https://1fichier.com/?abc">1fichier</a>
    <a href="https://clicknupload.cam/xyz">ClicknUpload</a>
  </body></html>`;

const sendCmPage = () =>
  `<html><body>
    <a href="https://send.cm/d/abc123">SendCm</a>
    <a href="https://1fichier.com/?def">1fichier</a>
  </body></html>`;

describe('MkvHub', () => {
  let source: MkvHub;
  let fetcher: Fetcher;

  beforeEach(() => {
    Source.resetCache();
    fetcher = createFetcher();
    source = new MkvHub(fetcher);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockText = (responses: { test: (url: URL) => boolean; html: string }[]) => {
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
      const match = responses.find(r => r.test(url));
      if (match) return match.html;
      throw new Error(`Unexpected fetch ${url.href}`);
    });
  };

  test('ignores unsupported content types', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async () => seriesTmdb('Example Show', 2024));
    const results = await source['handleInternal'](ctx, 'channel' as ContentType, new TmdbId(1));
    expect(results).toHaveLength(0);
  });

  test('movie: returns 720p and 1080p links with multiple hosters', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'api.themoviedb.org') return movieTmdb('Inception', 2010);
      throw new Error('Unexpected JSON fetch');
    });
    mockText([
      {
        test: url => url.searchParams.has('s'),
        html: searchPage(['https://www.mkvhub.pics/inception-2010-english-720p-1080p-bluray-x264-6ch-esubs/']),
      },
      {
        test: url => url.pathname.includes('inception-2010'),
        html: moviePostPage(),
      },
      {
        test: url => url.pathname.includes('dl720'),
        html: sendCmPage(),
      },
      {
        test: url => url.pathname.includes('dl1080'),
        html: multiHosterPage(),
      },
    ]);

    const results = await source['handleInternal'](ctx, 'movie', new TmdbId(1));

    // 720p → 1 hoster (SendCm), 1080p → 3 hosters (HubCloud, GDFlix, GoFile)
    expect(results).toHaveLength(4);

    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://send.cm/d/abc123');
    expect(hrefs).toContain('https://hubcloud.cx/drive/abc123');
    expect(hrefs).toContain('https://new2.gdflix.app/file/def456');
    expect(hrefs).toContain('https://gofile.io/d/ghi789');

    // 1fichier / clicknupload are NOT supported hosters → excluded
    expect(hrefs).not.toContain('https://1fichier.com/?abc');
    expect(hrefs).not.toContain('https://clicknupload.cam/xyz');

    const sendCm = results.find(r => r.url.hostname === 'send.cm');
    expect(sendCm?.meta.height).toBe(720);

    const hubCloud = results.find(r => r.url.hostname === 'hubcloud.cx');
    expect(hubCloud?.meta.height).toBe(1080);
    expect(hubCloud?.meta.title).toContain('1080p');
    expect(hubCloud?.meta.title).toContain('HubCloud');
  });

  test('series: returns 720p/1080p links for episode 8 (skips zip packs)', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'api.themoviedb.org') return seriesTmdb('Stranger Things', 2016);
      throw new Error('Unexpected JSON fetch');
    });
    mockText([
      {
        test: url => url.searchParams.has('s'),
        html: searchPage([
          'https://www.mkvhub.pics/stranger-things-tales-from-85-2026-s01-complete-dual-audio/',
          'https://www.mkvhub.pics/stranger-things-2025-s05-dual-audio-hindi-english-org-2-0-480p-720p-1080p-web-dl-x264-esubs-ep-01-04-added/',
        ]),
      },
      {
        test: url => url.pathname.includes('stranger-things-2025-s05'),
        html: seriesPostPage(),
      },
      {
        test: url => url.pathname.includes('ep8_720'),
        html: multiHosterPage(),
      },
      {
        test: url => url.pathname.includes('ep8_1080'),
        html: multiHosterPage(),
      },
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 5, 8));

    // Ep 8: 720p (3 hosters) + 1080p (3 hosters) = 6. Zip packs and 480p are skipped.
    expect(results).toHaveLength(6);

    const heights = results.map(r => r.meta.height);
    expect(heights.every(h => h === 720 || h === 1080)).toBe(true);

    // No zip-pack URLs should be fetched
    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://hubcloud.cx/drive/abc123');
  });

  test('series: returns 0 for episode 1 (only zip packs available)', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'api.themoviedb.org') return seriesTmdb('Stranger Things', 2016);
      throw new Error('Unexpected JSON fetch');
    });
    mockText([
      {
        test: url => url.searchParams.has('s'),
        html: searchPage([
          'https://www.mkvhub.pics/stranger-things-2025-s05-dual-audio-hindi-english-org-2-0-480p-720p-1080p-web-dl-x264-esubs-ep-01-04-added/',
        ]),
      },
      {
        test: url => url.pathname.includes('stranger-things-2025-s05'),
        html: seriesPostPage(),
      },
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 5, 1));
    expect(results).toHaveLength(0);
  });

  test('series: two-level headings (S03E01 episode heading + quality sub-headings)', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'api.themoviedb.org') return seriesTmdb('House of the Dragon', 2022);
      throw new Error('Unexpected JSON fetch');
    });
    mockText([
      {
        test: url => url.searchParams.has('s'),
        html: searchPage(['https://www.mkvhub.pics/house-of-the-dragon-2026-s03/']),
      },
      {
        test: url => url.pathname.includes('house-of-the-dragon-2026-s03'),
        html: twoLevelSeriesPostPage(),
      },
      {
        test: url => url.pathname.includes('e1_720'),
        html: multiHosterPage(),
      },
      {
        test: url => url.pathname.includes('e1_1080'),
        html: multiHosterPage(),
      },
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 3, 1));

    // S03E01: 720p (3 hosters) + 1080p (3 hosters) = 6. 480p dropped, E02 excluded.
    expect(results).toHaveLength(6);
    const heights = results.map(r => r.meta.height);
    expect(heights.every(h => h === 720 || h === 1080)).toBe(true);
    const hrefs = results.map(r => r.url.href);
    expect(hrefs).toContain('https://hubcloud.cx/drive/abc123');
  });

  test('filters out spinoff posts (title boundary check)', async () => {
    jest.spyOn(fetcher, 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
      if (url.hostname === 'api.themoviedb.org') return seriesTmdb('Stranger Things', 2016);
      throw new Error('Unexpected JSON fetch');
    });
    mockText([
      {
        test: url => url.searchParams.has('s'),
        // Only the spinoff — should NOT match "Stranger Things" S01
        html: searchPage([
          'https://www.mkvhub.pics/stranger-things-tales-from-85-2026-s01-complete-dual-audio/',
        ]),
      },
    ]);

    const results = await source['handleInternal'](ctx, 'series', new TmdbId(1, 1, 1));
    expect(results).toHaveLength(0);
  });
});
