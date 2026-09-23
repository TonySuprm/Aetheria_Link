jest.mock('../utils', () => ({
  getTmdbId: jest.fn(),
  getTmdbNameAndYear: jest.fn(),
  createKeyvSqlite: () => undefined,
  Fetcher: class {
    public text: (ctx: unknown, url: URL) => Promise<string> = async () => '';
  },
}));

describe('DonghuaStream', () => {
  it('should extract 4k quality label from option text', async () => {
    // jest.config sets resetModules: true, so the registry is cleared before this test.
    // Requiring ../utils here (and only here) before requiring ./DonghuaStream guarantees
    // the source under test and this file share the SAME mocked module instance — otherwise
    // mockResolvedValue() below mutates a different instance than the one handleInternal calls.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require('../utils');
    (utils.getTmdbId as jest.Mock).mockResolvedValue({ season: 5, episode: 131, formatSeasonAndEpisode: () => 'S05E131' });
    (utils.getTmdbNameAndYear as jest.Mock).mockResolvedValue(['Battle Through the Heavens', 2023]);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DonghuaStream } = require('./DonghuaStream');
    const fetcher = new utils.Fetcher();
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx: unknown, url: URL) => {
      const path = url.toString();
      if (path.includes('?s=')) {
        return `
                    <div class="listupd">
                        <article class="bsx">
                            <a href="https://donghuastream.org/anime/battle-through-the-heavens/" title="Battle Through the Heavens">
                                <span class="typez">Series</span>
                            </a>
                        </article>
                    </div>`;
      } else if (path.includes('/anime/')) {
        return `
                    <div class="eplister">
                        <ul>
                            <li><a href="https://donghuastream.org/btth-episode-131/">Episode 131</a></li>
                        </ul>
                    </div>`;
      } else {
        return `
                    <select>
                        <option value="PHNjcmlwdD5hbGVydCgnZmFrZScpPC9zY3JpcHQ+">Fake (Don't extract)</option>
                        <option value="PGlmcmFtZSBzcmM9Imh0dHBzOi8vcnVtYmxlLmNvbS9lbWJlZC92MTIzNCI+PC9pZnJhbWU+">(4k) Battle Through The Heavens</option>
                        <option value="PGlmcmFtZSBzcmM9Imh0dHBzOi8vZGFpbHltb3Rpb24uY29tL3ZpZGVvLzEyMzQiPjwvaWZyYW1lPg==">1080p Dailymotion</option>
                    </select>`;
      }
    });

    const source = new DonghuaStream(fetcher);
    const results = await source.handle({}, 'series', 'mock');

    expect(results.length).toBe(2);

    // Results are sorted by quality score: 4K (3) > 1080p (2)
    expect(results[0].meta.title).toContain('[4K]');
    expect(results[0].url.href).toBe('https://rumble.com/embed/v1234');

    expect(results[1].meta.title).toContain('[1080p]');
    expect(results[1].url.href).toBe('https://dailymotion.com/video/1234');
  });
});
