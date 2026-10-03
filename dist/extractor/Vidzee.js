"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vidzee = exports.apiKeyCache = void 0;
exports.decryptApiKey = decryptApiKey;
const node_crypto_1 = require("node:crypto");
const cacheable_1 = require("cacheable");
const types_1 = require("../types");
const utils_1 = require("../utils");
const Extractor_1 = require("./Extractor");
const API_KEY_URL = 'https://core.vidzee.wtf/api-key';
const SERVER_API_URL = 'https://player.vidzee.wtf/api/server';
const ENCRYPTION_KEY_SECRET = '4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c';
// Cache the decrypted API key for 1 hour
exports.apiKeyCache = new cacheable_1.Cacheable({
    primary: new cacheable_1.Keyv({ store: new cacheable_1.CacheableMemory({ lruSize: 10 }) }),
    ttl: 3600000,
});
/**
 * Decrypt the API key from the base64-encoded AES-GCM encrypted response.
 */
async function decryptApiKey(encryptedBase64) {
    const encrypted = Buffer.from(encryptedBase64, 'base64');
    if (encrypted.length <= 28) {
        throw new Error('Invalid API key response: too short');
    }
    const iv = encrypted.subarray(0, 12);
    const authTag = encrypted.subarray(12, 28);
    const ciphertext = encrypted.subarray(28);
    // Derive the key using SHA-256 of the secret
    const derivedKey = (0, node_crypto_1.createHash)('sha256').update(ENCRYPTION_KEY_SECRET).digest();
    const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', derivedKey, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}
/**
 * Decrypt a server URL link using AES-CBC.
 */
function decryptServerUrl(encryptedLink, apiKey) {
    try {
        const decoded = Buffer.from(encryptedLink, 'base64').toString('utf8');
        const colonIndex = decoded.indexOf(':');
        if (colonIndex === -1) {
            return '';
        }
        const ivBase64 = decoded.substring(0, colonIndex);
        const ciphertextBase64 = decoded.substring(colonIndex + 1);
        if (!ivBase64 || !ciphertextBase64) {
            return '';
        }
        const iv = Buffer.from(ivBase64, 'base64');
        const key = Buffer.alloc(32);
        key.write(apiKey, 'utf8');
        const ciphertext = Buffer.from(ciphertextBase64, 'base64');
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
    }
    catch {
        return '';
    }
}
class Vidzee extends Extractor_1.Extractor {
    id = 'vidzee';
    label = 'VidZee';
    ttl = 10800000; // 3h
    constructor(fetcher, logger) {
        super(fetcher, logger);
    }
    supports(_ctx, url) {
        return url.host === 'player.vidzee.wtf' || url.host.endsWith('.vidzee.wtf');
    }
    async extractInternal(ctx, url, meta) {
        // Parse the URL to extract TMDB ID, season, episode, and server
        const { tmdbId, season, episode, serverId } = this.parseUrl(url);
        if (!tmdbId) {
            return [];
        }
        // Fetch and decrypt the API key (cached)
        const apiKey = await this.getApiKey(ctx);
        if (!apiKey) {
            return [];
        }
        // Build the server API URL
        const apiUrl = new URL(SERVER_API_URL);
        apiUrl.searchParams.set('id', tmdbId);
        apiUrl.searchParams.set('sr', serverId);
        if (season) {
            apiUrl.searchParams.set('ss', season);
            apiUrl.searchParams.set('ep', episode ?? '1');
        }
        // Fetch server data
        const serverResponse = await this.fetcher.json(ctx, apiUrl);
        if (serverResponse.error || !serverResponse.url?.length) {
            return [];
        }
        // Decrypt and collect URLs
        const results = [];
        for (const stream of serverResponse.url) {
            const decryptedUrl = decryptServerUrl(stream.link, apiKey);
            if (!decryptedUrl) {
                continue;
            }
            const streamFormat = stream.type === 'hls' || decryptedUrl.includes('.m3u8')
                ? types_1.Format.hls
                : types_1.Format.mp4;
            const streamUrl = new URL(decryptedUrl);
            const result = {
                url: streamUrl,
                format: streamFormat,
                label: `${stream.name} (${stream.flag}) - ${stream.lang}`,
                requestHeaders: {
                    Referer: 'https://player.vidzee.wtf/',
                    ...(serverResponse.headers?.['User-Agent'] ? { 'User-Agent': serverResponse.headers['User-Agent'] } : {}),
                },
                meta: {
                    ...meta,
                    title: `${stream.name} - ${stream.lang}`,
                },
            };
            // Try to guess resolution for HLS streams
            if (streamFormat === types_1.Format.hls) {
                try {
                    const headers = {};
                    if (serverResponse.headers?.['User-Agent']) {
                        headers['User-Agent'] = serverResponse.headers['User-Agent'];
                    }
                    // istanbul ignore else -- meta is always set from spread above
                    if (result.meta) {
                        result.meta.height = await (0, utils_1.guessHeightFromPlaylist)(ctx, this.fetcher, streamUrl, { headers });
                    }
                }
                catch {
                    // ignore resolution detection errors
                }
            }
            results.push(result);
        }
        return results;
    }
    parseUrl(url) {
        const pathParts = url.pathname.split('/').filter(Boolean);
        let tmdbId = null;
        let season = null;
        let episode = null;
        const movieIndex = pathParts.indexOf('movie');
        const tvIndex = pathParts.indexOf('tv');
        if (movieIndex !== -1 && pathParts[movieIndex + 1]) {
            tmdbId = pathParts[movieIndex + 1];
        }
        else if (tvIndex !== -1 && pathParts[tvIndex + 1]) {
            tmdbId = pathParts[tvIndex + 1];
            season = pathParts[tvIndex + 2] ?? /* istanbul ignore next */ null;
            episode = pathParts[tvIndex + 3] ?? /* istanbul ignore next */ null;
        }
        const serverId = url.searchParams.get('sr') ?? '4'; // Default to Nflix
        return { tmdbId, season, episode, serverId };
    }
    async getApiKey(ctx) {
        const cached = await exports.apiKeyCache.get('vidzee-api-key');
        if (cached) {
            return cached;
        }
        try {
            const encryptedKey = await this.fetcher.text(ctx, new URL(API_KEY_URL));
            const decryptedKey = await decryptApiKey(encryptedKey);
            await exports.apiKeyCache.set('vidzee-api-key', decryptedKey);
            return decryptedKey;
        }
        catch {
            return null;
        }
    }
}
exports.Vidzee = Vidzee;
