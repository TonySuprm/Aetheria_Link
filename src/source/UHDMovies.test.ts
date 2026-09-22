import * as cheerio from 'cheerio';
import { createTestContext } from '../test';
import { FetcherMock, TmdbId } from '../utils';
import { Source } from './Source';
import { UHDMovies } from './UHDMovies';

const ctx = createTestContext();

describe('UHDMovies internal parsers', () => {
  let source: UHDMovies;

  beforeEach(() => {
    Source.resetCache();
    source = new UHDMovies(new FetcherMock(`${__dirname}/__fixtures__/UHDMovies`));
  });

  test('collectMovieLinks captures size from the quality header', () => {
    const html = `<div class="entry-content">
      <p><strong>2160p 4K UHD HDR10 [22.5GB]</strong></p>
      <a class="maxbutton-1 maxbutton" href="https://cloud.unblockedgames.world/?sid=abc123">Download (G-Drive)</a>
    </div>`;
    const links = source['collectMovieLinks'](cheerio.load(html));
    expect(links).toHaveLength(1);
    expect(links[0]?.height).toBe(2160);
    expect(links[0]?.bytes).toBeGreaterThan(0);
  });

  test('collectMovieLinks captures size from a separate element', () => {
    const html = `<div class="entry-content">
      <p><strong>2160p 4K UHD HDR10</strong></p>
      <p>Size: [22.5GB]</p>
      <a class="maxbutton-1 maxbutton" href="https://cloud.unblockedgames.world/?sid=abc123">Download (G-Drive)</a>
    </div>`;
    const links = source['collectMovieLinks'](cheerio.load(html));
    expect(links).toHaveLength(1);
    expect(links[0]?.height).toBe(2160);
    expect(links[0]?.bytes).toBeGreaterThan(0);
  });

  test('collectMovieLinks deduplicates duplicate quality buttons', () => {
    const html = `<div class="entry-content">
      <p><strong>1080p x264</strong> [5.5GB]</p>
      <a class="maxbutton-1 maxbutton" href="https://cloud.unblockedgames.world/?sid=aaa">Download (G-Drive)</a>
      <a class="maxbutton-2 maxbutton" href="https://cloud.unblockedgames.world/?sid=bbb">Download (G-Drive)</a>
    </div>`;
    const links = source['collectMovieLinks'](cheerio.load(html));
    expect(links).toHaveLength(1);
  });

  test('collectSeriesLinks captures episode link with size', () => {
    const html = `<div class="entry-content">
      <h3>SEASON 1</h3>
      <p><strong>1080p x264 [2.1GB]</strong></p>
      <a class="maxbutton-5 maxbutton" href="https://cloud.unblockedgames.world/?sid=ep1"><span class="mb-text">Episode 1</span></a>
    </div>`;
    const links = source['collectSeriesLinks'](cheerio.load(html), 1, 1);
    expect(links).toHaveLength(1);
    expect(links[0]?.height).toBe(1080);
    expect(links[0]?.bytes).toBeGreaterThan(0);
  });

});
