"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vidzee = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
const VIDZEE_SERVERS = [
    { sr: '3', flag: 'US', name: 'Achilles', countryCode: types_1.CountryCode.en },
    { sr: '5', flag: 'US', name: 'Drag', countryCode: types_1.CountryCode.en },
    { sr: '6', flag: 'VN', name: 'Viet', countryCode: types_1.CountryCode.vi },
    { sr: '7', flag: 'IN', name: 'Hindi', countryCode: types_1.CountryCode.hi },
    { sr: '8', flag: 'IN', name: 'Bengali', countryCode: types_1.CountryCode.hi },
    { sr: '9', flag: 'IN', name: 'Tamil', countryCode: types_1.CountryCode.ta },
    { sr: '10', flag: 'IN', name: 'Telugu', countryCode: types_1.CountryCode.te },
    { sr: '11', flag: 'IN', name: 'Malayalam', countryCode: types_1.CountryCode.ml },
];
class Vidzee extends Source_1.Source {
    id = 'vidzee';
    label = 'VidZee';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi];
    baseUrl = 'https://player.vidzee.wtf';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, _type, id) {
        const tmdbId = await (0, utils_1.getTmdbId)(ctx, this.fetcher, id);
        const servers = VIDZEE_SERVERS.filter(server => server.countryCode === types_1.CountryCode.en || server.countryCode === types_1.CountryCode.multi);
        return servers.map((server) => {
            let url;
            if (tmdbId.season) {
                url = new URL(`/v2/embed/tv/${tmdbId.id}/${tmdbId.season}/${tmdbId.episode}`, this.baseUrl);
            }
            else {
                url = new URL(`/v2/embed/movie/${tmdbId.id}`, this.baseUrl);
            }
            url.searchParams.set('sr', server.sr);
            return {
                url,
                meta: {
                    countryCodes: [server.countryCode],
                    title: `${server.name} (${server.flag})`,
                },
            };
        });
    }
}
exports.Vidzee = Vidzee;
