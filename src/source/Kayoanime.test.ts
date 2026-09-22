import { createTestContext } from '../test';
import { FetcherMock, TmdbId } from '../utils';
import { CustomRequestConfig } from '../utils/Fetcher';
import { Kayoanime } from './Kayoanime';
import { Source } from './Source';

const ctx = createTestContext();

/** Build an `embeddedfolderview` HTML body listing the given (id, filename) pairs. */
const folderHtml = (files: { id: string; name: string }[]): string =>
  files
    .map(
      f =>
        `<div class="flip-entry" id="entry-${f.id}"><div class="flip-entry-info">`
        + `<a href="https://drive.google.com/file/d/${f.id}/view?usp=drive_web" target="_blank">`
        + `<div class="flip-entry-visual"></div><div class="flip-entry-title">${f.name}</div></a></div></div>`,
    )
    .join('');

describe('Kayoanime', () => {
  let source: Kayoanime;

  beforeEach(() => {
    Source.resetCache();
    source = new Kayoanime(new FetcherMock(`${__dirname}/__fixtures__/Kayoanime`));
  });

  describe('series episode resolution', () => {
    test('resolves post -> public GDrive folder -> episode file -> /relay usercontent stream', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'Frieren: Beyond Journey\'s End', first_air_date: '2023-09-29', original_name: 'Sousou no Frieren' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) {
          return `<a href="https://kayoanime.com/sousou-no-frieren-frieren-beyond-journeys-end-season-1-2-1080p-bluray-dual-audio-hevc/">Sousou no Frieren (Season 1-2) 1080p BluRay Dual Audio HEVC</a>`;
        }
        if (url.hostname === 'kayoanime.com') {
          return `<h1 class="post-title">Sousou no Frieren (Season 1-2) 1080p BluRay Dual Audio HEVC</h1>
            <div class="toggle-content">
              <a href="https://tinyurl.com/9yh733xs" class="shortc-button small blue">Google Group</a>
              <a href="https://drive.google.com/drive/folders/PRIVATE01?usp=sharing" class="shortc-button small pink">1080p [BLURAY][Private Drive]</a>
              <a href="https://drive.google.com/drive/folders/PUBLIC1080?usp=sharing" class="shortc-button small pink">1080p</a>
              <a href="https://drive.google.com/drive/folders/S2PRIVATE?usp=sharing" class="shortc-button small pink">Season 2 [Private Drive]</a>
            </div>`;
        }
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          // Season 1 public folder lists episodes 1-3.
          return folderHtml([
            { id: 'FID01', name: 'Sousou no Frieren - 01.mkv' },
            { id: 'FID02', name: 'Sousou no Frieren - 02.mkv' },
            { id: 'FID03', name: 'Sousou no Frieren - 03.mkv' },
          ]);
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(200, 1, 1));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.pathname).toBe('/relay');
      const upstream = streams[0]?.url.searchParams.get('url') ?? '';
      expect(upstream).toContain('drive.usercontent.google.com/download');
      expect(upstream).toContain('id=FID01');
      expect(streams[0]?.meta.height).toBe(1080);
      expect(streams[0]?.meta.title).toBe('Sousou no Frieren - 01.mkv');
      expect(streams[0]?.meta.sourceLabel).toBe('Kayoanime');
    });

    test('selects the requested episode, not episode 1', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'Frieren: Beyond Journey\'s End', first_air_date: '2023-09-29', original_name: 'Sousou no Frieren' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://kayoanime.com/sousou-no-frieren-frieren-beyond-journeys-end-season-1-1080p-bluray/">Frieren (Season 1) 1080p</a>`;
        if (url.hostname === 'kayoanime.com') return `<h1 class="post-title">Frieren 1080p BluRay</h1><div class="toggle-content"><a href="https://drive.google.com/drive/folders/PUB?usp=sharing" class="shortc-button">1080p</a></div>`;
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          return folderHtml([
            { id: 'E01', name: 'Frieren - 01.mkv' },
            { id: 'E10', name: 'Frieren - 10.mkv' },
          ]);
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(200, 1, 10));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.searchParams.get('url')).toContain('id=E10');
    });
  });

  describe('folder selection', () => {
    test('a private drive folder with no listable files yields nothing; public folder covers it', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'Frieren: Beyond Journey\'s End', first_air_date: '2023-09-29' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://kayoanime.com/frieren-season-1-1080p-bluray/">Frieren 1080p</a>`;
        if (url.hostname === 'kayoanime.com') return `<div class="toggle-content"><a href="https://drive.google.com/drive/folders/PRIVATE?usp=sharing" class="shortc-button">1080p [Private Drive]</a></div>`;
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          // Private folder → sign-in page, no /file/d/ entries.
          return `<html><body>Sign in to continue</body></html>`;
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(200, 1, 1));
      expect(streams).toHaveLength(0);
    });

    test('for a season-2 request, prefers a season-specific folder over a generic one', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'Frieren: Beyond Journey\'s End', first_air_date: '2023-09-29' };
        return {};
      });
      const fetchedFolders: string[] = [];
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://kayoanime.com/sousou-no-frieren-frieren-beyond-journeys-end-season-1-2-1080p-bluray/">Frieren (Season 1-2) 1080p</a>`;
        if (url.hostname === 'kayoanime.com') {
          return `<div class="toggle-content">
            <a href="https://drive.google.com/drive/folders/GENERIC?usp=sharing" class="shortc-button">1080p</a>
            <a href="https://drive.google.com/drive/folders/S2PUB?usp=sharing" class="shortc-button">Season 2 1080p</a>
          </div>`;
        }
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          fetchedFolders.push(url.searchParams.get('id') ?? '');
          if (url.searchParams.get('id') === 'S2PUB') return folderHtml([{ id: 'S2E01', name: 'Frieren S2 - 01.mkv' }]);
          return folderHtml([{ id: 'G01', name: 'Frieren - 01.mkv' }]);
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(200, 2, 1));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.searchParams.get('url')).toContain('id=S2E01');
      // The season-specific folder was the one resolved for this quality.
      expect(fetchedFolders).toContain('S2PUB');
    });
  });

  describe('movie resolution', () => {
    test('picks the video file from a movie folder', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'Spirited Away', release_date: '2001-07-20', original_title: 'Sen to Chihiro' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://kayoanime.com/spirited-away-2001-1080p-bluray-dual-audio/">Spirited Away 2001 1080p BluRay Dual Audio</a>`;
        if (url.hostname === 'kayoanime.com') return `<div class="toggle-content"><a href="https://drive.google.com/drive/folders/MOVIEFOLDER?usp=sharing" class="shortc-button">1080p</a></div>`;
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          return folderHtml([{ id: 'MVID', name: 'Spirited Away (2001) 1080p.mkv' }]);
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.searchParams.get('url')).toContain('id=MVID');
      expect(streams[0]?.meta.height).toBe(1080);
    });

    test('returns both 720p (folder) and 1080p (direct file link) when both are present', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'The Boy and the Beast', release_date: '2015-07-11', original_title: 'Bakemono no Ko' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://kayoanime.com/the-boy-and-the-beast-bakemono-no-ko-1080p-bluray-dual-audio-hevc/">The Boy and the Beast 1080p BluRay Dual Audio</a>`;
        if (url.hostname === 'kayoanime.com') {
          return `<h1 class="post-title">The Boy and the Beast 1080p Bluray Dual Audio HEVC</h1>
            <div class="toggle-content">
              <a href="https://drive.google.com/drive/folders/F720?usp=sharing" class="shortc-button">720p</a>
              <a href="https://drive.google.com/file/d/F1080/view" class="shortc-button">1080p</a>
            </div>`;
        }
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          return folderHtml([{ id: 'F720V', name: 'The Boy and the Beast.mkv' }]);
        }
        return '';
      });
      jest.spyOn(source['fetcher'], 'head').mockImplementation(async (_ctx: unknown, url: URL) => {
        // Only the 1080p direct file link is HEAD-checked.
        if (url.searchParams.get('id') === 'F1080') return { 'content-length': '2785175634' };
        throw new Error('unexpected head');
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
      expect(streams).toHaveLength(2);
      const heights = streams.map(s => s.meta.height).sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(heights).toEqual([720, 1080]);
      const ids = streams.map(s => s.url.searchParams.get('url'));
      expect(ids.some(u => u?.includes('id=F720V'))).toBe(true);
      expect(ids.some(u => u?.includes('id=F1080'))).toBe(true);
      // The direct file link's size was captured from the HEAD.
      const f1080 = streams.find(s => s.meta.height === 1080);
      expect(f1080?.meta.bytes).toBe(2785175634);
    });

    test('skips a direct file link that is not accessible (HEAD fails)', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'The Boy and the Beast', release_date: '2015-07-11' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://kayoanime.com/the-boy-and-the-beast-1080p-bluray-dual-audio-hevc/">The Boy and the Beast 1080p</a>`;
        if (url.hostname === 'kayoanime.com') {
          return `<div class="toggle-content">
            <a href="https://drive.google.com/drive/folders/F720?usp=sharing" class="shortc-button">720p</a>
            <a href="https://drive.google.com/file/d/F1080/view" class="shortc-button">1080p [Private Drive]</a>
          </div>`;
        }
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          return folderHtml([{ id: 'F720V', name: 'The Boy and the Beast.mkv' }]);
        }
        return '';
      });
      jest.spyOn(source['fetcher'], 'head').mockImplementation(async () => {
        throw new Error('403 Forbidden');
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
      // Private 1080p file link inaccessible (no cookie) → only 720p folder survives.
      expect(streams).toHaveLength(1);
      expect(streams[0]?.meta.height).toBe(720);
    });
  });

  describe('Private Drive via GDRIVE_COOKIE', () => {
    test('forwards the cookie when listing a private folder', async () => {
      process.env['GDRIVE_COOKIE'] = 'SID=abc; HSID=xyz';
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'Monster Musume: Everyday Life with Monster Girls', first_air_date: '2015-07-08' };
        return {};
      });
      let listHeaders: Record<string, string> | undefined;
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL, cfg?: CustomRequestConfig) => {
        if (url.searchParams.has('s')) return `<a href="https://kayoanime.com/monster-musume-everyday-life-with-monster-girls-seasons-1-1080p-bluray-dual-audio-hevc/">Monster Musume 1080p</a>`;
        if (url.hostname === 'kayoanime.com') return `<div class="toggle-content"><a href="https://drive.google.com/drive/folders/PRIV?usp=sharing" class="shortc-button">1080p [Private Drive]</a></div>`;
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          listHeaders = cfg?.headers as Record<string, string> | undefined;
          return folderHtml([{ id: 'MM01', name: 'Monster Musume - 01.mkv' }]);
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(200, 1, 1));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.searchParams.get('url')).toContain('id=MM01');
      expect(listHeaders?.['Cookie']).toBe('SID=abc; HSID=xyz');
      delete process.env['GDRIVE_COOKIE'];
    });
  });

  describe('findPost', () => {
    test('returns empty when only per-episode subbed posts match (no download post)', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'Some Anime', first_air_date: '2025-01-01' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) {
          return `<a href="https://kayoanime.com/some-anime-episode-1-english-subbed/">Some Anime Episode 1 English Subbed</a>`;
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(300, 1, 1));
      expect(streams).toHaveLength(0);
    });

    test('matches a post whose slug prefixes the Japanese title (contains, not startsWith)', async () => {
      const seenSearch: string[] = [];
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'Frieren: Beyond Journey\'s End', first_air_date: '2023-09-29' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) {
          seenSearch.push(url.searchParams.get('s') ?? '');
          return `<a href="https://kayoanime.com/sousou-no-frieren-frieren-beyond-journeys-end-season-1-2-1080p-bluray-dual-audio-hevc/">Sousou no Frieren 1080p</a>`;
        }
        if (url.hostname === 'kayoanime.com') return `<div class="toggle-content"></div>`;
        return '';
      });

      await source['handleInternal'](ctx, 'series', new TmdbId(200, 1, 1));
      expect(seenSearch).toEqual(['Frieren Beyond Journey s End']);
    });
  });

  describe('episode parsing (via listFolder)', () => {
    test.each([
      ['Sousou no Frieren - 01.mkv', 1],
      ['Show S02E05.mkv', 5],
      ['Show Episode 12.mkv', 12],
      ['Show E07.mkv', 7],
      ['Show - 10.mkv', 10],
    ])('matches episode from "%s" when episode %i is requested', async (name, episode) => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'Show', first_air_date: '2024-01-01' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://kayoanime.com/show-season-1-1080p-bluray/">Show 1080p</a>`;
        if (url.hostname === 'kayoanime.com') return `<div class="toggle-content"><a href="https://drive.google.com/drive/folders/PUB?usp=sharing" class="shortc-button">1080p</a></div>`;
        if (url.hostname === 'drive.google.com' && url.pathname === '/embeddedfolderview') {
          return folderHtml([{ id: `EP${episode}`, name }]);
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(200, 1, episode));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.searchParams.get('url')).toContain(`id=EP${episode}`);
    });
  });
});
