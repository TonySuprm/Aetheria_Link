import axios from 'axios';
import winston from 'winston';
import { createTestContext } from '../test';
import { Fetcher, ImdbId } from '../utils';
import { ImdbSu } from './ImdbSu';
import { Source } from './Source';

const ctx = createTestContext();
const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

const embedPage = (playerUrl: string): string => `
  <html><body>
    <iframe src="${playerUrl}" id="pf"></iframe>
  </body></html>`;

const playerPage = (streamDataApiUrl: string): string => `
  <html><body>
    <script>
      const CONFIG = ${JSON.stringify({
        mediaType: 'movie',
        mediaId: 'tt0371746',
        idType: 'imdb',
        streamDataApiUrl,
        playToken: 'deadbeef',
        playTokenTs: 1234567890,
        hostDomain: 'player.imdb.su',
      })};
    </script>
  </body></html>`;

const streamData = (): string => JSON.stringify({
  status_code: '200',
  data: {
    file_name: 'Iron.Man.2008.1080p.mp4',
    stream_urls: [
      'https://example-cdn.com/foo/master.m3u8',
      'https://example-cdn.com/bar/master.m3u8',
    ],
  },
});

const masterM3u8 = (): string => `
#EXTM3U
#EXT-X-STREAM-INF:RESOLUTION=1920x1080
1080p.m3u8
#EXT-X-STREAM-INF:RESOLUTION=1280x720
720p.m3u8
`;

describe('ImdbSu', () => {
  let source: ImdbSu;
  let fetcher: Fetcher;

  beforeEach(() => {
    Source.resetCache();
    fetcher = new Fetcher(axios.create(), logger);
    source = new ImdbSu(fetcher);
  });

  test('movie extracts variant playlists from VidAPI streamData', async () => {
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'player.imdb.su') return embedPage('https://nextgencloudfabric.com/embed/movie/tt0371746');
      if (url.hostname === 'nextgencloudfabric.com') return playerPage('https://streamdata.vaplayer.ru/api.php');
      if (url.hostname === 'streamdata.vaplayer.ru') return streamData();
      if (url.pathname.endsWith('master.m3u8')) return masterM3u8();
      return '';
    });

    const results = await source['handleInternal'](ctx, 'movie', new ImdbId('tt0371746', undefined, undefined));
    expect(results).toHaveLength(2);
    expect(results[0].url.href).toContain('1080p.m3u8');
    expect(results[0].meta.height).toBe(1080);
    expect(results[1].url.href).toContain('720p.m3u8');
    expect(results[1].meta.height).toBe(720);
  });

  test('tv builds embed path with season and episode', async () => {
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'player.imdb.su') {
        expect(url.pathname).toBe('/embed/tv/tt0903747/4/2');
        return embedPage('https://nextgencloudfabric.com/embed/tv/tt0903747/4/2');
      }
      if (url.hostname === 'nextgencloudfabric.com') {
        return playerPage('https://streamdata.vaplayer.ru/api.php')
          .replace('"mediaType":"movie"', '"mediaType":"tv"')
          .replace('"mediaId":"tt0371746"', '"mediaId":"tt0903747"');
      }
      if (url.hostname === 'streamdata.vaplayer.ru') {
        return JSON.stringify({
          status_code: 200,
          data: {
            stream_urls: ['https://example-cdn.com/bb/master.m3u8'],
          },
        });
      }
      if (url.pathname.endsWith('master.m3u8')) return masterM3u8();
      return '';
    });

    const results = await source['handleInternal'](ctx, 'series', new ImdbId('tt0903747', 4, 2));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].meta.season).toBe(4);
    expect(results[0].meta.episode).toBe(2);
  });

  test('returns empty when streamData API reports non-200', async () => {
    jest.spyOn(fetcher, 'text').mockImplementation(async (_ctx, url) => {
      if (url.hostname === 'player.imdb.su') return embedPage('https://nextgencloudfabric.com/embed/movie/tt0371746');
      if (url.hostname === 'nextgencloudfabric.com') return playerPage('https://streamdata.vaplayer.ru/api.php');
      if (url.hostname === 'streamdata.vaplayer.ru') return JSON.stringify({ status_code: '404', data: {} });
      return '';
    });

    const results = await source['handleInternal'](ctx, 'movie', new ImdbId('tt0371746', undefined, undefined));
    expect(results).toEqual([]);
  });
});
