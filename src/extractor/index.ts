import winston from 'winston';
import { envGet, Fetcher } from '../utils';
import { AllDebrid } from './AllDebrid';
import { Buzzheavier } from './Buzzheavier';
import { Dailymotion } from './Dailymotion';
import { DoodStream } from './DoodStream';
import { Dropload } from './Dropload';
import { ExternalUrl } from './ExternalUrl';
import { Extractor } from './Extractor';
import { Fastream } from './Fastream';
import { FileLions } from './FileLions';
import { FileMoon } from './FileMoon';
import { Fsst } from './Fsst';
import { Gdflix } from './Gdflix';
import { GDrivePlayer } from './GDrivePlayer';
import { GoFile } from './GoFile';
import { HBLinks } from './HBLinks';
import { HDStream4U } from './HDStream4U';
import { HubExtractor } from './HubExtractor';
import { JustPlay } from './JustPlay';
import { KinoGer } from './KinoGer';
import { KrakenFiles } from './KrakenFiles';
import { LuluStream } from './LuluStream';
import { Mega } from './Mega';
import { Mixdrop } from './Mixdrop';
import { MkvKing } from './MkvKing';
import { MovieBox } from './MovieBox';
import { OkRu } from './OkRu';
import { PixelDrain } from './PixelDrain';
import { RealDebrid } from './RealDebrid';
import { Rumble } from './Rumble';
import { SaveFiles } from './SaveFiles';
import { SendCm } from './SendCm';
import { StrCloud } from './StrCloud';
import { StreamEmbed } from './StreamEmbed';
import { Streamtape } from './Streamtape';
import { StreamWish } from './StreamWish';
import { SuperVideo } from './SuperVideo';
import { TransferIt } from './TransferIt';
import { UHDMovies } from './UHDMovies';
import { Uqload } from './Uqload';
import { Vidara } from './Vidara';
import { VidFast } from './VidFast';
import { Vidmoly } from './Vidmoly';
import { Vidoza } from './Vidoza';
import { Vidsonic } from './Vidsonic';
import { VidSrc } from './VidSrc';
import { Vidzee } from './Vidzee';
import { VixSrc } from './VixSrc';
import { Voe } from './Voe';
import { YouTube } from './YouTube';

export * from './Extractor';
export * from './ExtractorRegistry';

export const createExtractors = (fetcher: Fetcher, logger: winston.Logger): Extractor[] => {
  const disabledExtractors = envGet('DISABLED_EXTRACTORS')?.split(',') ?? [];

  const hubExtractor = new HubExtractor(fetcher, logger);

  return [
    // RealDebrid is placed before AllDebrid because its supported-hoster set is
    // broader (e.g. nitroflare, rapidrar.com, send.now). Placing it first lets
    // RealDebrid handle hosters AllDebrid does not support while still falling
    // back to AllDebrid for RealDebrid-unsupported hosts (supports() is gated
    // by the API key, so AllDebrid-only users simply skip RealDebrid).
    new RealDebrid(fetcher, logger),
    new AllDebrid(fetcher, logger),
    new Buzzheavier(fetcher, logger),
    new Dailymotion(fetcher, logger),
    new DoodStream(fetcher, logger),
    new Dropload(fetcher, logger),
    new Fastream(fetcher, logger),
    new FileLions(fetcher, logger),
    new FileMoon(fetcher, logger),
    new Fsst(fetcher, logger),
    new GDrivePlayer(fetcher, logger),
    new Gdflix(fetcher, logger),
    new GoFile(fetcher, logger),
    new HBLinks(fetcher, logger, hubExtractor),
    new HDStream4U(fetcher, logger),
    hubExtractor,
    new JustPlay(fetcher, logger),
    new KinoGer(fetcher, logger),
    new KrakenFiles(fetcher, logger),
    new LuluStream(fetcher, logger),
    new Mega(fetcher, logger),
    new Mixdrop(fetcher, logger),
    new MovieBox(fetcher, logger),
    new OkRu(fetcher, logger),
    new PixelDrain(fetcher, logger),
    new Rumble(fetcher, logger),
    new SaveFiles(fetcher, logger),
    new SendCm(fetcher, logger),
    new StreamEmbed(fetcher, logger),
    new Streamtape(fetcher, logger),
    new StreamWish(fetcher, logger),
    new StrCloud(fetcher, logger),
    new SuperVideo(fetcher, logger),
    new TransferIt(fetcher, logger),
    new UHDMovies(fetcher, logger),
    new Uqload(fetcher, logger),
    new Vidara(fetcher, logger),
    new VidFast(fetcher, logger),
    new Vidmoly(fetcher, logger),
    new Vidsonic(fetcher, logger),
    new Vidzee(fetcher, logger),
    new VidSrc(fetcher, logger, [ // https://vidsrc.domains/
      'vidsrcme.ru',
      'vidsrcme.su',
      'vidsrc-me.ru',
      'vidsrc-me.su',
      'vsembed.ru',
      'vsembed.su',
      'vsrc.su',
    ]),
    new Vidoza(fetcher, logger),
    new VixSrc(fetcher, logger),
    new Voe(fetcher, logger),
    new YouTube(fetcher, logger),
    new MkvKing(fetcher, logger),
    new ExternalUrl(fetcher, logger), // fallback extractor which must come last
  ].filter(extractor => !disabledExtractors.includes(extractor.id));
};
