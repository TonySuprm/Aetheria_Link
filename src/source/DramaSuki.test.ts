import { createTestContext } from '../test';
import { FetcherMock, TmdbId } from '../utils';
import { buildDownloadUrl, DramaSuki, findTitleSegment, guessHeightFromName, isTitleMatch, isYearMatch, levenshtein, parseSnapDirs } from './DramaSuki';

const ctx = createTestContext({ multi: 'on', ko: 'on', zh: 'on', ja: 'on', th: 'on', id: 'on' });

const first = <T>(arr: T[]): T => {
  if (arr.length === 0) {
    throw new Error('expected at least one result');
  }
  return arr[0] as T;
};

describe('DramaSuki', () => {
  let source: DramaSuki;

  beforeEach(() => {
    source = new DramaSuki(new FetcherMock(`${__dirname}/__fixtures__/DramaSuki`));
  });

  test('handles korean drama with release sub-folder — 100 Days My Prince S1E3', async () => {
    const streams = await source.handle(ctx, 'series', new TmdbId(79839, 1, 3));
    expect(streams).toHaveLength(1);
    expect(first(streams).url.href).toBe('https://dl.dramasuki.xyz/0:/Korean-Drama/100%20Days%20My%20Prince%20(2018)/NF%20WEB-DL%20SH3LBY%20(42.6GB)/100%20Days%20My%20Prince%20-%201x03%20(1080p%20NF%20WEB-DL%20SH3LBY).mkv');
    expect(first(streams).meta.bytes).toBe(2815648356);
    expect(first(streams).meta.height).toBe(1080);
  });

  test('filters to the exact episode — 100 Days My Prince S1E1 returns only ep1', async () => {
    const streams = await source.handle(ctx, 'series', new TmdbId(79839, 1, 1));
    expect(streams).toHaveLength(1);
    expect(first(streams).url.href).toContain('1x01');
  });

  test('returns every release for a movie with multiple files — #Alive (2020)', async () => {
    const streams = await source.handle(ctx, 'movie', new TmdbId(547016, undefined, undefined));
    expect(streams).toHaveLength(2);
    expect(streams.every(s => s.url.href.includes('Movies/Korean/%23Alive%20(2020)/'))).toBe(true);
  });

  test('matches a #-prefixed title — #Who Am I S1E1', async () => {
    const streams = await source.handle(ctx, 'series', new TmdbId(243423, 1, 1));
    expect(streams).toHaveLength(1);
    expect(first(streams).url.href).toContain('Japanese-Drama/%23Who%20Am%20I%20(2023)/');
  });

  test('selects the right season sub-folder — Dirty Linen S2E80', async () => {
    const streams = await source.handle(ctx, 'series', new TmdbId(211754, 2, 80));
    expect(streams).toHaveLength(1);
    expect(first(streams).url.href).toContain('Filipino-Drama/Dirty%20Linen%20(2023)/Season%2002/');
    expect(first(streams).url.href).toContain('2x80');
  });

  test('does not leak season 1 episodes when season 2 is requested', async () => {
    const streams = await source.handle(ctx, 'series', new TmdbId(211754, 2, 1));
    // S2E1 exists → exactly one hit, and no S1 episodes leak through.
    expect(streams).toHaveLength(1);
    expect(first(streams).url.href).toContain('2x01');
    expect(first(streams).url.href).not.toContain('1x');
  });

  test('skips files without an episode tag for a series request', async () => {
    // A Good Day to Be a Dog only has 1x01/1x02/1x14 — none tagged 1x99.
    const streams = await source.handle(ctx, 'series', new TmdbId(71764, 1, 99));
    expect(streams).toHaveLength(0);
  });

  test('skips a folder whose title matches but year differs by more than 1', async () => {
    // TMDB returns "#Alive" with year 2025 (archive has "(2020)") — outside ±1 tolerance, no match.
    const streams = await source.handle(ctx, 'movie', new TmdbId(547017, undefined, undefined));
    expect(streams).toHaveLength(0);
  });

  test('matches a title with a ±1 year discrepancy', async () => {
    // #Alive (2019) vs the archive's "(2020)" — within tolerance, should still match.
    const streams = await source.handle(ctx, 'movie', new TmdbId(547018, undefined, undefined));
    expect(streams).toHaveLength(2);
  });

  test('matches a title with a minor spelling variation via fuzzy matching', async () => {
    // "100 Day My Prince" (missing the trailing 's') vs archive "100 Days My Prince" — fuzzy match.
    const streams = await source.handle(ctx, 'series', new TmdbId(79840, 1, 3));
    expect(streams).toHaveLength(1);
    expect(first(streams).url.href).toContain('100%20Days%20My%20Prince');
  });

  test('returns empty for a series whose title is not in the archive', async () => {
    const streams = await source.handle(ctx, 'series', new TmdbId(99999, 1, 1));
    expect(streams).toHaveLength(0);
  });

  test('returns empty for a movie not in the archive', async () => {
    const streams = await source.handle(ctx, 'movie', new TmdbId(88888, undefined, undefined));
    expect(streams).toHaveLength(0);
  });

  test('uses the cached index on subsequent requests', async () => {
    // First call fetches + parses; second call reuses the module-level cache.
    const a = await source.handle(ctx, 'movie', new TmdbId(547016, undefined, undefined));
    const b = await source.handle(ctx, 'movie', new TmdbId(1064219, undefined, undefined));
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(first(b).url.href).toContain('Movies/Chinese/All%20In%20(2024)/');
  });

  test('falls back to guessHeightFromName when findHeight finds no NNNNp token (4K)', async () => {
    const streams = await source.handle(ctx, 'movie', new TmdbId(555000, undefined, undefined));
    expect(streams).toHaveLength(1);
    expect(first(streams).meta.height).toBe(2160);
  });
});

// These tests each need a cold module-level index cache, so they reset + re-require the module to
// get a fresh `cachedFolders`, and point a fresh FetcherMock at an index fixture that's broken/empty.
describe('DramaSuki index failure handling', () => {
  test('returns empty when the index fetch throws (no prior cache)', async () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DramaSuki: FreshDramaSuki } = require('./DramaSuki') as typeof import('./DramaSuki');
    const source = new FreshDramaSuki(new FetcherMock(`${__dirname}/__fixtures__/DramaSuki/error-index`));
    const streams = await source.handle(ctx, 'movie', new TmdbId(547016, undefined, undefined));
    expect(streams).toHaveLength(0);
  });

  test('returns empty when the parsed index has no file-bearing folders', async () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DramaSuki: FreshDramaSuki } = require('./DramaSuki') as typeof import('./DramaSuki');
    const source = new FreshDramaSuki(new FetcherMock(`${__dirname}/__fixtures__/DramaSuki/empty-index`));
    const streams = await source.handle(ctx, 'movie', new TmdbId(547016, undefined, undefined));
    expect(streams).toHaveLength(0);
  });
});

describe('parseSnapDirs', () => {
  test('parses folders with files and skips parent/category nodes', () => {
    const html = `<script>
      D.p(["DramaSuki*0*1", 0, "1*2"])
      D.p(["DramaSuki/Korean-Drama*0*1", 0, "3"])
      D.p(["DramaSuki/Korean-Drama/Show (2020)*0*1", "Show - 1x01 (1080p).mkv*1000*1", "Show - 1x02 (720p).mkv*2000*1", 3000, ""])
    </script>`;
    const folders = parseSnapDirs(html);
    expect(folders).toHaveLength(1);
    expect(folders[0]?.path).toBe('DramaSuki/Korean-Drama/Show (2020)');
    expect(folders[0]?.files).toHaveLength(2);
    expect(folders[0]?.files[0]).toEqual({ name: 'Show - 1x01 (1080p).mkv', bytes: 1000 });
  });

  test('skips a malformed first element (non-string header)', () => {
    const html = `<script>D.p([123, "file*1*1", 0, ""])</script>`;
    expect(parseSnapDirs(html)).toHaveLength(0);
  });

  test('skips folders not under the source root', () => {
    const html = `<script>D.p(["Other/Root*0*1", "file*1*1", 0, ""])</script>`;
    expect(parseSnapDirs(html)).toHaveLength(0);
  });

  test('skips entries with a non-positive/invalid byte count', () => {
    const html = `<script>D.p(["DramaSuki/Korean-Drama/Show (2020)*0*1", "good.mkv*500*1", "bad.mkv*0*1", "nonum.mkv*NaN*1", "empty.mkv**1", 0, ""])</script>`;
    const folders = parseSnapDirs(html);
    expect(folders).toHaveLength(1);
    expect(folders[0]?.files).toEqual([{ name: 'good.mkv', bytes: 500 }]);
  });

  test('dedupes folders that appear more than once (same path)', () => {
    const html = `<script>
      D.p(["DramaSuki/Korean-Drama/Show (2020)*0*1", "a.mkv*1*1", 0, ""])
      D.p(["DramaSuki/Korean-Drama/Show (2020)*0*1", "b.mkv*2*1", 0, ""])
    </script>`;
    expect(parseSnapDirs(html)).toHaveLength(1);
  });

  test('returns [] when there are no D.p() statements', () => {
    expect(parseSnapDirs('<html>nothing here</html>')).toHaveLength(0);
  });

  test('skips an empty array entry D.p([])', () => {
    expect(parseSnapDirs(`<script>D.p([])</script>`)).toHaveLength(0);
  });

  test('handles a string value with an escaped quote inside it', () => {
    // A filename containing a literal escaped quote: \"weird\"name.mkv
    const html = `<script>D.p(["DramaSuki/Korean-Drama/Show (2020)*0*1", "\\"weird\\"name.mkv*1234*1", 0, ""])</script>`;
    const folders = parseSnapDirs(html);
    expect(folders).toHaveLength(1);
    expect(folders[0]?.files[0]?.name).toBe('"weird"name.mkv');
  });

  test('tolerates leading/trailing whitespace and trailing commas inside the array', () => {
    // Leading whitespace before the first token + trailing whitespace after the last token →
    // exercises the leading whitespace-skip loop and the "end of body" break.
    const html = `<script>D.p([  "DramaSuki/Korean-Drama/Show (2020)*0*1"  , "a.mkv*1*1", 0, ""   ])</script>`;
    const folders = parseSnapDirs(html);
    expect(folders).toHaveLength(1);
    expect(folders[0]?.files[0]).toEqual({ name: 'a.mkv', bytes: 1 });
  });
});

describe('findTitleSegment', () => {
  test('extracts name + year from a show path', () => {
    expect(findTitleSegment('DramaSuki/Korean-Drama/100 Days My Prince (2018)/NF WEB-DL SH3LBY (42.6GB)')).toEqual({ name: '100 Days My Prince', year: 2018 });
  });

  test('picks the first (YYYY)-bearing segment', () => {
    expect(findTitleSegment('DramaSuki/Movies/Korean/#Alive (2020)')).toEqual({ name: '#Alive', year: 2020 });
  });

  test('returns undefined when no segment has a (YYYY) suffix', () => {
    expect(findTitleSegment('DramaSuki/Korean-Drama')).toBeUndefined();
  });
});

describe('buildDownloadUrl', () => {
  test('strips the source root and encodes the path', () => {
    expect(buildDownloadUrl('DramaSuki/Movies/Korean/#Alive (2020)', 'Alive (2020) (1080p NF WEB-DL).mkv')?.href)
      .toBe('https://dl.dramasuki.xyz/0:/Movies/Korean/%23Alive%20(2020)/Alive%20(2020)%20(1080p%20NF%20WEB-DL).mkv');
  });

  test('handles a path already lacking the source-root prefix', () => {
    expect(buildDownloadUrl('Korean-Drama/Show (2020)', 'Show - 1x01.mkv')?.href)
      .toBe('https://dl.dramasuki.xyz/0:/Korean-Drama/Show%20(2020)/Show%20-%201x01.mkv');
  });
});

describe('guessHeightFromName', () => {
  test('detects 4k', () => {
    expect(guessHeightFromName('Movie (2160p 4K WEB-DL).mkv')).toBe(2160);
  });
  test('detects a bare 4k token with no other resolution number', () => {
    expect(guessHeightFromName('Show - 1x01 (4K WEB-DL).mkv')).toBe(2160);
  });
  test('detects 720p', () => {
    expect(guessHeightFromName('Show - 1x01 (720p).mkv')).toBe(720);
  });
  test('returns undefined when no resolution token is present', () => {
    expect(guessHeightFromName('random filename.txt')).toBeUndefined();
  });
});

describe('isTitleMatch', () => {
  test('exact slug match', () => {
    expect(isTitleMatch('marrymyhusband', 'marrymyhusband')).toBe(true);
  });

  test('fuzzy match within tolerance (one missing letter)', () => {
    expect(isTitleMatch('100daymyprince', '100daysmyprince')).toBe(true);
  });

  test('rejects a slug that differs too much', () => {
    expect(isTitleMatch('marrymyhusband', 'divorceattorney')).toBe(false);
  });

  test('rejects a fuzzy match when both slugs are too short', () => {
    expect(isTitleMatch('abc', 'abd')).toBe(false);
  });
});

describe('isYearMatch', () => {
  test('exact year', () => {
    expect(isYearMatch(2024, 2024)).toBe(true);
  });

  test('±1 year tolerance', () => {
    expect(isYearMatch(2019, 2020)).toBe(true);
    expect(isYearMatch(2021, 2020)).toBe(true);
  });

  test('rejects a year gap > 1', () => {
    expect(isYearMatch(2018, 2024)).toBe(false);
  });

  test('matches when either year is missing', () => {
    expect(isYearMatch(undefined, 2024)).toBe(true);
    expect(isYearMatch(2024, undefined)).toBe(true);
  });
});

describe('levenshtein', () => {
  test('identical strings → 0', () => {
    expect(levenshtein('kitten', 'kitten')).toBe(0);
  });

  test('known distance kitten → sitting = 3', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  test('empty first string → length of second', () => {
    expect(levenshtein('', 'abc')).toBe(3);
  });

  test('empty second string → length of first', () => {
    expect(levenshtein('abc', '')).toBe(3);
  });
});
