import { Fetcher, Id } from '../utils';
import { DonghuaStream } from './DonghuaStream';
import { CountryCode } from '../types';
import axios from 'axios';

jest.mock('../utils');

describe('DonghuaStream', () => {
    let source: DonghuaStream;
    let fetcher: Fetcher;

    beforeEach(() => {
        fetcher = new Fetcher(axios);
        source = new DonghuaStream(fetcher);
    });

    it('should extract 4k quality label from option text', async () => {
        // Mock the fetcher texts
        jest.spyOn(fetcher, 'text').mockImplementation(async (ctx, url) => {
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

        // Mock TMDB mapping logic
        const { getTmdbId, getTmdbNameAndYear } = require('../utils');
        const mockTmdbId = { season: 5, episode: 131, formatSeasonAndEpisode: () => 'S05E131' };
        getTmdbId.mockResolvedValue(mockTmdbId);
        getTmdbNameAndYear.mockResolvedValue(['Battle Through the Heavens', 2023]);

        const results = await source.handle({}, 'series', 'mock' as any);

        expect(results.length).toBe(2);

        // Results are sorted by quality score: 4K (3) > 1080p (2)
        expect(results[0].meta.title).toContain('[4K]');
        expect(results[0].url.href).toBe('https://rumble.com/embed/v1234');

        expect(results[1].meta.title).toContain('[1080p]');
        expect(results[1].url.href).toBe('https://dailymotion.com/video/1234');
    });
});
