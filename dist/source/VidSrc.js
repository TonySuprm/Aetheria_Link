"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VidSrc = void 0;
const types_1 = require("../types");
const Source_1 = require("./Source");
class VidSrc extends Source_1.Source {
    id = 'vidsrc';
    label = 'VidSrc';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi];
    baseUrl = 'https://vsembed.ru';
    async handleInternal(_ctx, _type, id) {
        const url = id.season
            ? new URL(`/embed/${id.id}/${id.season}-${id.episode}`, this.baseUrl)
            : new URL(`/embed/${id.id}`, this.baseUrl);
        return [{ url, meta: { countryCodes: [types_1.CountryCode.multi] } }];
    }
    ;
}
exports.VidSrc = VidSrc;
