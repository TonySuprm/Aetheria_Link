"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSources = void 0;
const utils_1 = require("../utils");
const AcerMovies_1 = require("./AcerMovies");
const Anidap_1 = require("./Anidap");
const Animesalt_1 = require("./Animesalt");
const Animexin_1 = require("./Animexin");
// import { CineHDPlus } from './CineHDPlus'; // Disabled per user request
// import { Cuevana } from './Cuevana'; // Disabled per user request
const DDLValley_1 = require("./DDLValley");
const DonghuaStream_1 = require("./DonghuaStream");
const DramaCoolg_1 = require("./DramaCoolg");
// import { DramaDay } from './DramaDay'; // Disabled: non-functional (filecrypt anti-scrape blocks
//   its hoster resolution). DramaSuki covers the same content cleanly via direct files.
const DramaSuki_1 = require("./DramaSuki");
// import { Einschalten } from './Einschalten'; // Disabled per user request
// import { Eurostreaming } from './Eurostreaming'; // Disabled per user request
// import { FilmpalastTO } from './FilmpalastTO'; // Disabled per user request
const FourKHDHub_1 = require("./FourKHDHub");
// import { Frembed } from './Frembed'; // Disabled per user request
// import { FrenchCloud } from './FrenchCloud'; // Disabled per user request
// import { FreeMovies } from './FreeMovies'; // Disabled per user request
const HDEncode_1 = require("./HDEncode");
const HDHub4u_1 = require("./HDHub4u");
// import { HomeCine } from './HomeCine'; // Disabled per user request
const ImdbSu_1 = require("./ImdbSu");
const KatMovieHD_1 = require("./KatMovieHD");
const Kayoanime_1 = require("./Kayoanime");
// import { KinoGer } from './KinoGer'; // Disabled per user request
const KissAsian_1 = require("./KissAsian");
const KissAsianTV_1 = require("./KissAsianTV");
const LuciferDonghua_1 = require("./LuciferDonghua");
// import { KissKh } from './KissKh'; // Disabled: uses Puppeteer + a 6s sleep, takes 9-11s per
//   request and returns 0 results most of the time. It was the long pole that delayed every
//   stream response. DramaCoolg/KissAsianTV cover the same content without the delay.
const Kitsu_1 = require("./Kitsu");
// import { Kokoshka } from './Kokoshka'; // Disabled per user request
const Medeberiya_1 = require("./Medeberiya");
// import { MegaKino } from './MegaKino'; // Disabled per user request
// import { MeineCloud } from './MeineCloud'; // Disabled per user request
// import { MkvDrama } from './MkvDrama'; // Disabled: superseded by DramaDay (cleaner exe.io base64
//   decode, no Puppeteer/ouo/viewcrate chain). Keep the file for reference / future re-enable.
const Miruro_1 = require("./Miruro");
const MkvHub_1 = require("./MkvHub");
// import { MkvKing } from './MkvKing'; // Disabled: e.mkvking.dad no longer hosts the streams.iqsmartgames.com API and returns 403.
const MisterDonghua_1 = require("./MisterDonghua");
const MovieBox_1 = require("./MovieBox");
const OneDDL_1 = require("./OneDDL");
// import { MostraGuarda } from './MostraGuarda'; // Disabled per user request
// import { Movix } from './Movix'; // Disabled per user request
// import { OlaMovies } from './OlaMovies';
const PaheInk_1 = require("./PaheInk");
// import { RapidMoviez } from './RapidMoviez'; // Disabled per user request
const SinFlix_1 = require("./SinFlix");
const SSRmovies_1 = require("./SSRmovies");
const UHDMovies_1 = require("./UHDMovies");
const Vadapav_1 = require("./Vadapav");
const VidSrc_1 = require("./VidSrc");
const VidVault_1 = require("./VidVault");
const VixSrc_1 = require("./VixSrc");
const WorldFree4u_1 = require("./WorldFree4u");
// import { XYZ111477 } from './XYZ111477'; // Disabled per user request
__exportStar(require("./Source"), exports);
const createSources = (fetcher) => {
    const disabledSources = (0, utils_1.envGet)('DISABLED_SOURCES')?.split(',') ?? [];
    return [
        // Debrid sources (require AllDebrid / RealDebrid API key)
        new DDLValley_1.DDLValley(fetcher),
        new HDEncode_1.HDEncode(fetcher),
        // new RapidMoviez(fetcher), // Disabled per user request
        new OneDDL_1.OneDDL(fetcher),
        // multi
        new FourKHDHub_1.FourKHDHub(fetcher),
        new HDHub4u_1.HDHub4u(fetcher),
        new VixSrc_1.VixSrc(fetcher),
        new VidSrc_1.VidSrc(),
        // new XYZ111477(fetcher), // Disabled per user request
        new Vadapav_1.Vadapav(fetcher),
        new VidVault_1.VidVault(fetcher),
        // new Vidzee(fetcher), // Disabled per user request
        new MovieBox_1.MovieBox(fetcher),
        new DonghuaStream_1.DonghuaStream(fetcher),
        new MisterDonghua_1.MisterDonghua(fetcher),
        new LuciferDonghua_1.LuciferDonghua(fetcher),
        new Animexin_1.Animexin(fetcher),
        new PaheInk_1.PaheInk(fetcher),
        new Medeberiya_1.Medeberiya(fetcher),
        // new OlaMovies(fetcher), // Disabled per user request
        new KissAsian_1.KissAsian(fetcher),
        new KissAsianTV_1.KissAsianTV(fetcher),
        new DramaCoolg_1.DramaCoolg(fetcher),
        // new DramaDay(fetcher), // Disabled: non-functional — its filecrypt container resolution is
        //   blocked by filecrypt's anti-scrape rendering (captures 0 hoster URLs), and its exe.io chain
        //   is unreliable. DramaSuki covers the same Asian drama/movies cleanly via direct files.
        new DramaSuki_1.DramaSuki(fetcher),
        new SinFlix_1.SinFlix(fetcher),
        new SSRmovies_1.SSRmovies(fetcher),
        new WorldFree4u_1.WorldFree4u(fetcher),
        new KatMovieHD_1.KatMovieHD(fetcher),
        new UHDMovies_1.UHDMovies(fetcher),
        new Kayoanime_1.Kayoanime(fetcher),
        new Animesalt_1.Animesalt(fetcher),
        new Anidap_1.Anidap(fetcher),
        new ImdbSu_1.ImdbSu(fetcher),
        new MkvHub_1.MkvHub(fetcher),
        // new MkvKing(fetcher), // Disabled: domain/site API dead, source returns 403/empty.
        new AcerMovies_1.AcerMovies(fetcher),
        // new FreeMovies(fetcher), // Disabled per user request
        // new MkvDrama(fetcher), // Disabled: superseded by DramaSuki's cleaner direct-file approach.
        new Miruro_1.Miruro(fetcher),
        // new KissKh(fetcher), // Disabled: Puppeteer + 6s sleep = 9-11s long pole; mostly returns 0.
        new Kitsu_1.Kitsu(fetcher),
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
exports.createSources = createSources;
