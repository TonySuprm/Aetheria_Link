import * as cheerio from 'cheerio';
import { createTestContext } from '../test';
import { FetcherMock, TmdbId } from '../utils';
import { Source } from './Source';
import { WorldFree4u } from './WorldFree4u';

const ctx = createTestContext();

describe('WorldFree4u', () => {
  let source: WorldFree4u;

  beforeEach(() => {
    Source.resetCache();
    source = new WorldFree4u(new FetcherMock(`${__dirname}/__fixtures__/WorldFree4u`));
  });

  describe('collectQualityLinks', () => {
    test('pairs each a.dl with its nearest preceding h4 (quality + size)', () => {
      const html = `<h4>Dunkirk 2017 [Hindi-English] HDRip 480p AAC ESub [335Mb]</h4>
        <h4><strong><a class="dl" href="https://linkos.site/abc/480">Download Links</a></strong></h4>
        <h4>Dunkirk 2017 [Hindi-English] HDRip 720p AAC ESub [800Mb]</h4>
        <h4><strong><a class="dl" href="https://linkos.site/abc/720">Download Links</a></strong></h4>
        <h4>Dunkirk 2017 [Hindi-English] HDRip 1080p AAC ESub [1.5Gb]</h4>
        <h4><strong><a class="dl" href="https://epios.site/abc/1080">Download Links</a></strong></h4>`;
      const $ = cheerio.load(html);
      const links = source['collectQualityLinks']($);
      expect(links).toHaveLength(3);
      expect(links[0]).toMatchObject({ height: 480, href: 'https://linkos.site/abc/480' });
      expect(links[0]?.bytes).toBeGreaterThan(300_000_000);
      expect(links[1]).toMatchObject({ height: 720, href: 'https://linkos.site/abc/720' });
      expect(links[2]).toMatchObject({ height: 1080, href: 'https://epios.site/abc/1080' });
      expect(links[2]?.bytes).toBeGreaterThan(1_000_000_000);
    });

    test('ignores a.dl anchors that are not linkos/epios short links', () => {
      const html = `<h4>Some 1080p [1GB]</h4>
        <h4><a class="dl" href="https://example.com/x">Download</a></h4>`;
      const $ = cheerio.load(html);
      expect(source['collectQualityLinks']($)).toHaveLength(0);
    });

    test('falls back to the link heading text when no preceding h4 exists', () => {
      const html = `<h4><strong>Dunkirk 720p [800Mb] </strong><a class="dl" href="https://linkos.site/abc/720">Download Links</a></h4>`;
      const $ = cheerio.load(html);
      const links = source['collectQualityLinks']($);
      expect(links).toHaveLength(1);
      expect(links[0]?.height).toBe(720);
    });
  });

  describe('movie resolution', () => {
    test('resolves post -> linkos -> multicloud -> direct mkv, dropping 480p', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'Dunkirk', release_date: '2017-07-21', original_title: 'Dunkirk' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) {
          // Real card structure: the <a> text begins with a rotated year badge ("2017") BEFORE the
          // title, and a decoy "Operation Dunkirk" card must NOT match. Slug-based matching handles both.
          return `<html><body>
            <a href="https://worldfree4u.dog/dunkirk-2017/" class="cursor-pointer overflow-hidden group block shadow-sm">
              <span class="absolute top-3">2017</span>
              <div>Dunkirk  Dual Audio HDRip || 300Mb || 720p || 1080p</div>
            </a>
            <a href="https://worldfree4u.dog/operation-dunkirk-2017-brrip-720p-dual-audio/" class="cursor-pointer overflow-hidden group block shadow-sm">
              <span class="absolute top-3">2017</span>
              <div>Operation Dunkirk  BRRip 720p Dual Audio</div>
            </a>
          </body></html>`;
        }
        if (url.pathname === '/dunkirk-2017/') {
          return `<h4>Dunkirk 2017 HDRip 480p [335Mb]</h4>
            <h4><strong><a class="dl" href="https://linkos.site/x/480">Download Links</a></strong></h4>
            <h4>Dunkirk 2017 HDRip 720p [800Mb]</h4>
            <h4><strong><a class="dl" href="https://linkos.site/x/720">Download Links</a></strong></h4>
            <h4>Dunkirk 2017 HDRip 1080p [1.5Gb]</h4>
            <h4><strong><a class="dl" href="https://linkos.site/x/1080">Download Links</a></strong></h4>`;
        }
        if (url.hostname === 'linkos.site') {
          return `<h3><a class="dl" href="https://new.multicloudlinks.com/view/m720">MULTICLOUD</a></h3>
            <h3><a class="dl" href="https://gdflix.dev/file/xyz">GDFLIX</a></h3>`;
        }
        if (url.hostname === 'new.multicloudlinks.com') {
          return `<a class="premium-btn" href="https://bdl1.multicloudlinks.com/Dunkirk.2017.720p.mkv">Direct Download</a>
            <a class="premium-btn" href="https://gofile.io/d/zz">GoFile</a>`;
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
      // 480p dropped → 720p + 1080p only
      expect(streams).toHaveLength(2);
      expect(streams.every(s => s.url.href.endsWith('.mkv'))).toBe(true);
      expect(streams.some(s => s.meta.height === 720)).toBe(true);
      expect(streams.some(s => s.meta.height === 1080)).toBe(true);
      expect(streams.every(s => s.url.href.startsWith('https://bdl1.multicloudlinks.com/'))).toBe(true);
      expect(streams[0]?.meta.sourceLabel).toBe('WorldFree4u');
    });

    test('falls back to the GDFlix hoster when the linkos page has no MultiCloud hoster', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'Dunkirk', release_date: '2017-07-21', original_title: 'Dunkirk' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://worldfree4u.dog/dunkirk-2017/">Dunkirk 2017</a>`;
        if (url.pathname === '/dunkirk-2017/') {
          return `<h4>Dunkirk 720p [800Mb]</h4>
            <h4><strong><a class="dl" href="https://linkos.site/x/720">Download Links</a></strong></h4>`;
        }
        // linkos page lists only GDFlix (no MultiCloud) → fall back to the GDFlix hoster URL;
        // the GDFlix extractor resolves it downstream.
        if (url.hostname === 'linkos.site') return `<h3><a class="dl" href="https://gdflix.dev/file/xyz">GDFLIX</a></h3>`;
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.hostname).toBe('gdflix.dev');
      expect(streams[0]?.url.pathname).toBe('/file/xyz');
      expect(streams[0]?.meta.height).toBe(720);
    });

    test('falls back to GDFlix for 4K when the MultiCloud view page renders no hosters (loader)', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'Avatar: Fire and Ash', release_date: '2025-12-19', original_title: 'Avatar: Fire and Ash' };
        return {};
      });
      const viewUrl = 'https://new.multicloudlinks.com/view/j6z1va';
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://worldfree4u.dog/avatar-fire-and-ash-2025/">Avatar Fire and Ash 2025</a>`;
        if (url.pathname === '/avatar-fire-and-ash-2025/') {
          return `<h4>Avatar Fire and Ash 2025 HDRip 2160p 4K [21.9Gb]</h4>
            <h4><strong><a class="dl" href="https://linkos.site/x/2160">Download Links</a></strong></h4>`;
        }
        if (url.hostname === 'linkos.site') {
          return `<h3><a class="dl" href="${viewUrl}">MULTICLOUD</a></h3>
            <h3><a class="dl" href="https://gdflix.dev/file/XKINoNPB3U6BUBZ">GDFLIX</a></h3>`;
        }
        // 4K MultiCloud view page: JS "Generating Secure Links…" loader — NO bdl1/gofile/dr1 anchors.
        if (url.hostname === 'new.multicloudlinks.com') {
          return `<div class="loader"></div><p>Generating Secure Links...</p><meta http-equiv="refresh" content="5">`;
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(83533, undefined, undefined));
      // MultiCloud empty → GDFlix fallback URL returned (the GDFlix extractor resolves it later).
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.hostname).toBe('gdflix.dev');
      expect(streams[0]?.url.pathname).toBe('/file/XKINoNPB3U6BUBZ');
      expect(streams[0]?.meta.height).toBe(2160);
    });

    test('falls back to dr1 Turbo via /relay when bdl1 direct is absent (1080p/4K)', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'Dunkirk', release_date: '2017-07-21', original_title: 'Dunkirk' };
        return {};
      });
      const viewUrl = 'https://new.multicloudlinks.com/view/mvsixf';
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://worldfree4u.dog/dunkirk-2017/">Dunkirk 2017</a>`;
        if (url.pathname === '/dunkirk-2017/') {
          return `<h4>Dunkirk 2017 HDRip 1080p [2.0Gb]</h4>
            <h4><strong><a class="dl" href="https://linkos.site/x/1080">Download Links</a></strong></h4>`;
        }
        if (url.hostname === 'linkos.site') {
          return `<h3><a class="dl" href="${viewUrl}">MULTICLOUD</a></h3>`;
        }
        // MultiCloud view page: NO bdl1 direct .mkv, only the referer-locked dr1 Turbo link.
        if (url.hostname === 'new.multicloudlinks.com') {
          return `<a class="premium-btn" href="https://dr1.multidownload.shop/d/5bbd6b65?exp=1783132358&token=abc&eid=xyz">Turbo Download</a>
            <a class="premium-btn" href="https://cgd1.multicloudlinks.com/mvsixf">Direct Download 2</a>`;
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(100, undefined, undefined));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.pathname).toBe('/relay');
      // The dr1 URL is carried in the `url` param; the MultiCloud view page is the referer.
      expect(streams[0]?.url.searchParams.get('url')).toContain('multidownload.shop/d/');
      expect(streams[0]?.url.searchParams.get('referer')).toBe(viewUrl);
      expect(streams[0]?.meta.height).toBe(1080);
    });

    test('prefers GoFile (Range CDN) over dr1 relay when bdl1 is absent (Avatar 720p/1080p/4K)', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'Avatar: Fire and Ash', release_date: '2025-12-19', original_title: 'Avatar: Fire and Ash' };
        return {};
      });
      const viewUrl = 'https://new.multicloudlinks.com/view/yw7qvg';
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://worldfree4u.dog/avatar-fire-and-ash-2025/">Avatar Fire and Ash 2025</a>`;
        if (url.pathname === '/avatar-fire-and-ash-2025/') {
          return `<h4>Avatar Fire and Ash 2025 HDRip 720p [1.18Gb]</h4>
            <h4><strong><a class="dl" href="https://linkos.site/x/720">Download Links</a></strong></h4>`;
        }
        if (url.hostname === 'linkos.site') {
          return `<h3><a class="dl" href="${viewUrl}">MULTICLOUD</a></h3>`;
        }
        // MultiCloud view: no bdl1, has GoFile + dr1 → GoFile (Range CDN) must win.
        if (url.hostname === 'new.multicloudlinks.com') {
          return `<a class="premium-btn" href="https://dr1.multidownload.shop/d/424e1892?exp=1&token=t">Turbo Download</a>
            <a class="premium-btn" href="https://gofile.io/d/RVsTze">GoFile</a>`;
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(300, undefined, undefined));
      // bdl1 absent → both GoFile (fast, Range CDN) and dr1 (always-alive relay floor) returned.
      expect(streams).toHaveLength(2);
      expect(streams[0]?.url.hostname).toBe('gofile.io');
      expect(streams[0]?.url.pathname).toBe('/d/RVsTze');
      expect(streams[1]?.url.pathname).toBe('/relay');
      expect(streams[1]?.url.searchParams.get('url')).toContain('multidownload.shop/d/');
      expect(streams.every(s => s.meta.height === 720)).toBe(true);
    });
  });

  describe('series episode resolution', () => {
    test('resolves post -> epios -> episode multicloud -> direct mkv', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'House of the Dragon', first_air_date: '2022-08-21', original_name: 'House of the Dragon' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) {
          return `<a href="https://worldfree4u.dog/house-of-the-dragon-season-3/">House of the Dragon (Season 3) WEB Series</a>`;
        }
        if (url.pathname.startsWith('/house-of-the-dragon')) {
          return `<h4>House of the Dragon (Season 3) [Hindi-English] HDRip 720p [600Mb/E]</h4>
            <h4><strong><a class="dl" href="https://epios.site/token/1/5616">Download Links</a></strong></h4>`;
        }
        if (url.hostname === 'epios.site') {
          return `<h3><strong>Sharedrive Episodes</strong></h3>
            <h3><a href="https://sharedrive.0sh.site/file/a"><em><strong>Episode 1</strong></em></a></h3>
            <h3><a href="https://new.multicloudlinks.com/view/he7y3u"><em><strong>Episode 2</strong></em></a></h3>`;
        }
        if (url.hostname === 'new.multicloudlinks.com') {
          return `<a class="premium-btn" href="https://bdl1.multicloudlinks.com/HotD.S03E02.720p.mkv">Direct Download</a>`;
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(200, 3, 2));
      expect(streams).toHaveLength(1);
      expect(streams[0]?.url.href).toContain('HotD.S03E02.720p.mkv');
      expect(streams[0]?.meta.height).toBe(720);
    });

    test('selects the correct episode when multiple are listed', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { name: 'House of the Dragon', first_air_date: '2022-08-21', original_name: 'House of the Dragon' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<a href="https://worldfree4u.dog/house-of-the-dragon-season-3/">House of the Dragon (Season 3)</a>`;
        if (url.pathname.startsWith('/house-of-the-dragon')) {
          return `<h4>House of the Dragon (Season 3) HDRip 1080p [1.1Gb/E]</h4>
            <h4><strong><a class="dl" href="https://epios.site/token/1/5615">Download Links</a></strong></h4>`;
        }
        if (url.hostname === 'epios.site') {
          return `<h3><a href="https://new.multicloudlinks.com/view/ep01"><em><strong>Episode 1</strong></em></a></h3>
            <h3><a href="https://new.multicloudlinks.com/view/ep10"><em><strong>Episode 10</strong></em></a></h3>`;
        }
        if (url.hostname === 'new.multicloudlinks.com') {
          return `<a class="premium-btn" href="https://bdl1.multicloudlinks.com/HotD.S03E10.1080p.mkv">Direct Download</a>`;
        }
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'series', new TmdbId(200, 3, 10));
      expect(streams).toHaveLength(1);
      // Episode 1 must NOT be selected for an episode-10 request
      expect(streams[0]?.url.href).toContain('E10');
    });
  });

  describe('findPost', () => {
    test('returns empty when no post matches the name', async () => {
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'Nonexistent Movie', release_date: '1999-01-01', original_title: 'Nonexistent Movie' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) return `<html><body><a href="https://worldfree4u.dog/some-other-film/">Some Other Film 2020</a></body></html>`;
        return '';
      });

      const streams = await source['handleInternal'](ctx, 'movie', new TmdbId(999, undefined, undefined));
      expect(streams).toHaveLength(0);
    });

    test('strips subtitle punctuation (e.g. colon) from the WP search query so the post is found', async () => {
      const seenSearch: string[] = [];
      jest.spyOn(source['fetcher'], 'json').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.hostname === 'api.themoviedb.org') return { title: 'Avatar: Fire and Ash', release_date: '2025-12-17', original_title: 'Avatar: Fire and Ash' };
        return {};
      });
      jest.spyOn(source['fetcher'], 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
        if (url.searchParams.has('s')) {
          seenSearch.push(url.searchParams.get('s') ?? '');
          return `<a href="https://worldfree4u.dog/avatar-fire-and-ash-2025/">Avatar Fire and Ash 2025</a>`;
        }
        return '';
      });

      await source['handleInternal'](ctx, 'movie', new TmdbId(83533, undefined, undefined));
      // The colon must be gone — "Avatar: Fire and Ash" → "Avatar Fire and Ash".
      expect(seenSearch).toHaveLength(1);
      expect(seenSearch[0]).toBe('Avatar Fire and Ash');
    });
  });
});
