"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HUBCLOUD_CACHE_TTL = exports.HUB_HOST_PATTERN = exports.DEAD_HUBCLOUD_HOSTS = void 0;
exports.DEAD_HUBCLOUD_HOSTS = new Set([
    'hubcloud.ink',
    'hubcloud.co',
    'hubcloud.cc',
    'hubcloud.me',
    'hubcloud.xyz',
]);
exports.HUB_HOST_PATTERN = /hubcdn|hubcloud|hubdrive/;
exports.HUBCLOUD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
