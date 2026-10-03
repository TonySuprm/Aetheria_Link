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
exports.createExtractors = void 0;
const utils_1 = require("../utils");
const AllDebrid_1 = require("./AllDebrid");
const Buzzheavier_1 = require("./Buzzheavier");
const Dailymotion_1 = require("./Dailymotion");
const DoodStream_1 = require("./DoodStream");
const Dropload_1 = require("./Dropload");
const ExternalUrl_1 = require("./ExternalUrl");
const Fastream_1 = require("./Fastream");
const FileLions_1 = require("./FileLions");
const FileMoon_1 = require("./FileMoon");
const Fsst_1 = require("./Fsst");
const Gdflix_1 = require("./Gdflix");
const GDrivePlayer_1 = require("./GDrivePlayer");
const GoFile_1 = require("./GoFile");
const HBLinks_1 = require("./HBLinks");
const HDStream4U_1 = require("./HDStream4U");
const HubExtractor_1 = require("./HubExtractor");
const JustPlay_1 = require("./JustPlay");
const KinoGer_1 = require("./KinoGer");
const KrakenFiles_1 = require("./KrakenFiles");
const LuluStream_1 = require("./LuluStream");
const Mega_1 = require("./Mega");
const Mixdrop_1 = require("./Mixdrop");
const MkvKing_1 = require("./MkvKing");
const MovieBox_1 = require("./MovieBox");
const OkRu_1 = require("./OkRu");
const PixelDrain_1 = require("./PixelDrain");
const RealDebrid_1 = require("./RealDebrid");
const Rumble_1 = require("./Rumble");
const SaveFiles_1 = require("./SaveFiles");
const SendCm_1 = require("./SendCm");
const StrCloud_1 = require("./StrCloud");
const StreamEmbed_1 = require("./StreamEmbed");
const Streamtape_1 = require("./Streamtape");
const StreamWish_1 = require("./StreamWish");
const SuperVideo_1 = require("./SuperVideo");
const TransferIt_1 = require("./TransferIt");
const UHDMovies_1 = require("./UHDMovies");
const Uqload_1 = require("./Uqload");
const Vidara_1 = require("./Vidara");
const VidFast_1 = require("./VidFast");
const Vidmoly_1 = require("./Vidmoly");
const Vidoza_1 = require("./Vidoza");
const Vidsonic_1 = require("./Vidsonic");
const VidSrc_1 = require("./VidSrc");
const Vidzee_1 = require("./Vidzee");
const VixSrc_1 = require("./VixSrc");
const Voe_1 = require("./Voe");
const YouTube_1 = require("./YouTube");
__exportStar(require("./Extractor"), exports);
__exportStar(require("./ExtractorRegistry"), exports);
const createExtractors = (fetcher, logger) => {
    const disabledExtractors = (0, utils_1.envGet)('DISABLED_EXTRACTORS')?.split(',') ?? [];
    const hubExtractor = new HubExtractor_1.HubExtractor(fetcher, logger);
    return [
        // RealDebrid is placed before AllDebrid because its supported-hoster set is
        // broader (e.g. nitroflare, rapidrar.com, send.now). Placing it first lets
        // RealDebrid handle hosters AllDebrid does not support while still falling
        // back to AllDebrid for RealDebrid-unsupported hosts (supports() is gated
        // by the API key, so AllDebrid-only users simply skip RealDebrid).
        new RealDebrid_1.RealDebrid(fetcher, logger),
        new AllDebrid_1.AllDebrid(fetcher, logger),
        new Buzzheavier_1.Buzzheavier(fetcher, logger),
        new Dailymotion_1.Dailymotion(fetcher, logger),
        new DoodStream_1.DoodStream(fetcher, logger),
        new Dropload_1.Dropload(fetcher, logger),
        new Fastream_1.Fastream(fetcher, logger),
        new FileLions_1.FileLions(fetcher, logger),
        new FileMoon_1.FileMoon(fetcher, logger),
        new Fsst_1.Fsst(fetcher, logger),
        new GDrivePlayer_1.GDrivePlayer(fetcher, logger),
        new Gdflix_1.Gdflix(fetcher, logger),
        new GoFile_1.GoFile(fetcher, logger),
        new HBLinks_1.HBLinks(fetcher, logger, hubExtractor),
        new HDStream4U_1.HDStream4U(fetcher, logger),
        hubExtractor,
        new JustPlay_1.JustPlay(fetcher, logger),
        new KinoGer_1.KinoGer(fetcher, logger),
        new KrakenFiles_1.KrakenFiles(fetcher, logger),
        new LuluStream_1.LuluStream(fetcher, logger),
        new Mega_1.Mega(fetcher, logger),
        new Mixdrop_1.Mixdrop(fetcher, logger),
        new MovieBox_1.MovieBox(fetcher, logger),
        new OkRu_1.OkRu(fetcher, logger),
        new PixelDrain_1.PixelDrain(fetcher, logger),
        new Rumble_1.Rumble(fetcher, logger),
        new SaveFiles_1.SaveFiles(fetcher, logger),
        new SendCm_1.SendCm(fetcher, logger),
        new StreamEmbed_1.StreamEmbed(fetcher, logger),
        new Streamtape_1.Streamtape(fetcher, logger),
        new StreamWish_1.StreamWish(fetcher, logger),
        new StrCloud_1.StrCloud(fetcher, logger),
        new SuperVideo_1.SuperVideo(fetcher, logger),
        new TransferIt_1.TransferIt(fetcher, logger),
        new UHDMovies_1.UHDMovies(fetcher, logger),
        new Uqload_1.Uqload(fetcher, logger),
        new Vidara_1.Vidara(fetcher, logger),
        new VidFast_1.VidFast(fetcher, logger),
        new Vidmoly_1.Vidmoly(fetcher, logger),
        new Vidsonic_1.Vidsonic(fetcher, logger),
        new Vidzee_1.Vidzee(fetcher, logger),
        new VidSrc_1.VidSrc(fetcher, logger, [
            'vidsrcme.ru',
            'vidsrcme.su',
            'vidsrc-me.ru',
            'vidsrc-me.su',
            'vsembed.ru',
            'vsembed.su',
            'vsrc.su',
        ]),
        new Vidoza_1.Vidoza(fetcher, logger),
        new VixSrc_1.VixSrc(fetcher, logger),
        new Voe_1.Voe(fetcher, logger),
        new YouTube_1.YouTube(fetcher, logger),
        new MkvKing_1.MkvKing(fetcher, logger),
        new ExternalUrl_1.ExternalUrl(fetcher, logger), // fallback extractor which must come last
    ].filter(extractor => !disabledExtractors.includes(extractor.id));
};
exports.createExtractors = createExtractors;
