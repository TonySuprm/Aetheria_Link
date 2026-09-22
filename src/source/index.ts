import { envGet, Fetcher } from '../utils';
import { AcerMovies } from './AcerMovies';
import { Anidap } from './Anidap';
import { Animesalt } from './Animesalt';
import { Animexin } from './Animexin';
// import { CineHDPlus } from './CineHDPlus'; // Disabled per user request
// import { Cuevana } from './Cuevana'; // Disabled per user request
import { DDLValley } from './DDLValley';
import { DonghuaStream } from './DonghuaStream';
import { DramaCoolg } from './DramaCoolg';
// import { DramaDay } from './DramaDay'; // Disabled: non-functional (filecrypt anti-scrape blocks
//   its hoster resolution). DramaSuki covers the same content cleanly via direct files.
import { DramaSuki } from './DramaSuki';
// import { Einschalten } from './Einschalten'; // Disabled per user request
// import { Eurostreaming } from './Eurostreaming'; // Disabled per user request
// import { FilmpalastTO } from './FilmpalastTO'; // Disabled per user request
import { FourKHDHub } from './FourKHDHub';
// import { Frembed } from './Frembed'; // Disabled per user request
// import { FrenchCloud } from './FrenchCloud'; // Disabled per user request
// import { FreeMovies } from './FreeMovies'; // Disabled per user request
import { HDEncode } from './HDEncode';
import { HDHub4u } from './HDHub4u';
// import { HomeCine } from './HomeCine'; // Disabled per user request
import { ImdbSu } from './ImdbSu';
import { KatMovieHD } from './KatMovieHD';
import { Kayoanime } from './Kayoanime';
// import { KinoGer } from './KinoGer'; // Disabled per user request
import { KissAsian } from './KissAsian';
import { KissAsianTV } from './KissAsianTV';
import { LuciferDonghua } from './LuciferDonghua';
// import { KissKh } from './KissKh'; // Disabled: uses Puppeteer + a 6s sleep, takes 9-11s per
//   request and returns 0 results most of the time. It was the long pole that delayed every
//   stream response. DramaCoolg/KissAsianTV cover the same content without the delay.
import { Kitsu } from './Kitsu';
// import { Kokoshka } from './Kokoshka'; // Disabled per user request
import { Medeberiya } from './Medeberiya';
// import { MegaKino } from './MegaKino'; // Disabled per user request
// import { MeineCloud } from './MeineCloud'; // Disabled per user request
// import { MkvDrama } from './MkvDrama'; // Disabled: superseded by DramaDay (cleaner exe.io base64
//   decode, no Puppeteer/ouo/viewcrate chain). Keep the file for reference / future re-enable.
import { Miruro } from './Miruro';
import { MkvHub } from './MkvHub';
// import { MkvKing } from './MkvKing'; // Disabled: e.mkvking.dad no longer hosts the streams.iqsmartgames.com API and returns 403.
import { MisterDonghua } from './MisterDonghua';
import { MovieBox } from './MovieBox';
import { OneDDL } from './OneDDL';
// import { MostraGuarda } from './MostraGuarda'; // Disabled per user request
// import { Movix } from './Movix'; // Disabled per user request
// import { OlaMovies } from './OlaMovies';
import { PaheInk } from './PaheInk';
// import { RapidMoviez } from './RapidMoviez'; // Disabled per user request
import { SinFlix } from './SinFlix';
import { Source } from './Source';
import { SSRmovies } from './SSRmovies';
import { UHDMovies } from './UHDMovies';
import { Vadapav } from './Vadapav';
import { VidSrc } from './VidSrc';
import { VidVault } from './VidVault';
import { VixSrc } from './VixSrc';
import { WorldFree4u } from './WorldFree4u';
// import { XYZ111477 } from './XYZ111477'; // Disabled per user request

export * from './Source';

export const createSources = (fetcher: Fetcher): Source[] => {
  const disabledSources = envGet('DISABLED_SOURCES')?.split(',') ?? [];

  return [
    // Debrid sources (require AllDebrid / RealDebrid API key)
    new DDLValley(fetcher),
    new HDEncode(fetcher),
    // new RapidMoviez(fetcher), // Disabled per user request
    new OneDDL(fetcher),
    // multi
    new FourKHDHub(fetcher),
    new HDHub4u(fetcher),
    new VixSrc(fetcher),
    new VidSrc(),
    // new XYZ111477(fetcher), // Disabled per user request
    new Vadapav(fetcher),
    new VidVault(fetcher),
    // new Vidzee(fetcher), // Disabled per user request
    new MovieBox(fetcher),
    new DonghuaStream(fetcher),
    new MisterDonghua(fetcher),
    new LuciferDonghua(fetcher),
    new Animexin(fetcher),
    new PaheInk(fetcher),
    new Medeberiya(fetcher),
    // new OlaMovies(fetcher), // Disabled per user request
    new KissAsian(fetcher),
    new KissAsianTV(fetcher),
    new DramaCoolg(fetcher),
    // new DramaDay(fetcher), // Disabled: non-functional — its filecrypt container resolution is
    //   blocked by filecrypt's anti-scrape rendering (captures 0 hoster URLs), and its exe.io chain
    //   is unreliable. DramaSuki covers the same Asian drama/movies cleanly via direct files.
    new DramaSuki(fetcher),
    new SinFlix(fetcher),
    new SSRmovies(fetcher),
    new WorldFree4u(fetcher),
    new KatMovieHD(fetcher),
    new UHDMovies(fetcher),
    new Kayoanime(fetcher),
    new Animesalt(fetcher),
    new Anidap(fetcher),
    new ImdbSu(fetcher),
    new MkvHub(fetcher),
    // new MkvKing(fetcher), // Disabled: domain/site API dead, source returns 403/empty.
    new AcerMovies(fetcher),
    // new FreeMovies(fetcher), // Disabled per user request
    // new MkvDrama(fetcher), // Disabled: superseded by DramaSuki's cleaner direct-file approach.
    new Miruro(fetcher),
    // new KissKh(fetcher), // Disabled: Puppeteer + 6s sleep = 9-11s long pole; mostly returns 0.
    new Kitsu(fetcher),
    // AL
    // new Kokoshka(fetcher), // Disabled per user request
    // ES / MX
    // new CineHDPlus(fetcher), // Disabled per user request
    // new Cuevana(fetcher), // Disabled per user request
    // new HomeCine(fetcher), // Disabled per user request
    // new VerHdLink(fetcher), // Disabled per user request
    // DE
    // new Einschalten(fetcher), // Disabled per user request
    // new KinoGer(fetcher), // Disabled per user request
    // new MegaKino(fetcher), // Disabled per user request
    // new MeineCloud(fetcher), // Disabled per user request
    // new FilmpalastTO(fetcher), // Disabled per user request
    // FR
    // new Frembed(fetcher), // Disabled per user request
    // new FrenchCloud(fetcher), // Disabled per user request
    // new Movix(fetcher), // Disabled per user request
    // IT
    // new Eurostreaming(fetcher), // Disabled per user request
    // new MostraGuarda(fetcher), // Disabled per user request
  ].filter(source => !disabledSources.includes(source.id));
};
