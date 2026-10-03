"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImdbSu = void 0;
const types_1 = require("../types");
const utils_1 = require("../utils");
const Source_1 = require("./Source");
class ImdbSu extends Source_1.Source {
    id = 'imdbsu';
    label = 'ImdbSu';
    contentTypes = ['movie', 'series'];
    countryCodes = [types_1.CountryCode.multi];
    baseUrl = 'https://imdb.su';
    fetcher;
    constructor(fetcher) {
        super();
        this.fetcher = fetcher;
    }
    async handleInternal(ctx, type, id) {
        const results = [];
        const isTv = type === 'series';
        const queryId = String(id.id);
        // 1) Load the imdb.su player embed page. It contains an iframe that points to the
        // actual nextgen player (e.g. nextgencloudfabric.com). That page exposes a CONFIG
        // object with the real streamDataApiUrl and anti-abuse playToken.
        let embedUrl;
        if (isTv && id.season !== undefined && id.episode !== undefined) {
            embedUrl = `https://player.imdb.su/embed/tv/${encodeURIComponent(queryId)}/${id.season}/${id.episode}`;
        }
        else {
            embedUrl = `https://player.imdb.su/embed/movie/${encodeURIComponent(queryId)}`;
        }
        let embedHtml;
        try {
            embedHtml = await this.fetcher.text(ctx, new URL(embedUrl), {
                headers: { Referer: this.baseUrl },
                timeout: 8000,
            });
        }
        catch (err) {
            this.fetcher.getLogger().warn(`ImdbSu: failed to load embed page ${embedUrl}: ${err}`, ctx);
            return [];
        }
        // Extract the nextgen iframe src from the player page.
        const iframeMatch = embedHtml.match(/<iframe[^>]+src\s*=\s*"(https:\/\/[^"]+)"/i);
        if (!iframeMatch?.[1]) {
            this.fetcher.getLogger().info(`ImdbSu: no player iframe found in ${embedUrl}`, ctx);
            return [];
        }
        const playerUrl = new URL(iframeMatch[1]);
        // 2) Load the nextgen player page so we can read CONFIG.
        let playerHtml;
        try {
            playerHtml = await this.fetcher.text(ctx, playerUrl, {
                headers: { Referer: embedUrl },
                timeout: 8000,
            });
        }
        catch (err) {
            this.fetcher.getLogger().warn(`ImdbSu: failed to load player page ${playerUrl.href}: ${err}`, ctx);
            return [];
        }
        const config = this.parseConfig(playerHtml);
        if (!config?.streamDataApiUrl || !config.mediaId) {
            this.fetcher.getLogger().info(`ImdbSu: no CONFIG found in ${playerUrl.href}`, ctx);
            return [];
        }
        // 3) Hit the streamData API with the correct referer. The API expects the id
        // in the query string (imdb=... or tmdb=...) plus type and, for TV, season/episode.
        const streamDataUrl = new URL(config.streamDataApiUrl);
        streamDataUrl.searchParams.set(config.idType === 'tmdb' ? 'tmdb' : 'imdb', config.mediaId);
        streamDataUrl.searchParams.set('type', isTv ? 'tv' : 'movie');
        if (isTv && config.season != null && config.episode != null) {
            streamDataUrl.searchParams.set('season', String(config.season));
            streamDataUrl.searchParams.set('episode', String(config.episode));
        }
        streamDataUrl.searchParams.set('_', Date.now().toString());
        let dataText;
        try {
            dataText = await this.fetcher.text(ctx, streamDataUrl, {
                headers: { Referer: `${playerUrl.origin}/` },
                timeout: 8000,
            });
        }
        catch (err) {
            this.fetcher.getLogger().warn(`ImdbSu: streamData API error: ${err}`, ctx);
            return [];
        }
        if (!dataText)
            return [];
        let data;
        try {
            data = JSON.parse(dataText);
        }
        catch {
            this.fetcher.getLogger().info(`ImdbSu: invalid JSON from streamData API`, ctx);
            return [];
        }
        const statusCode = data.status_code;
        if ((statusCode !== '200' && statusCode !== 200) || !data.data || !data.data.stream_urls) {
            return [];
        }
        const streamUrls = data.data.stream_urls;
        if (!streamUrls || streamUrls.length === 0)
            return [];
        // Prefer master.m3u8 mirrors; fall back to any m3u8 if none contain "master".
        const masterUrlStr = streamUrls.find(u => u.includes('master.m3u8'))
            ?? streamUrls.find(u => u.includes('.m3u8'))
            ?? streamUrls[0];
        if (!masterUrlStr)
            return [];
        const masterUrl = new URL(masterUrlStr);
        let masterM3u8;
        try {
            masterM3u8 = await this.fetcher.text(ctx, masterUrl, { timeout: 5000 });
        }
        catch {
            return [];
        }
        // Parse resolutions and extract ALL available tracks
        const lines = masterM3u8.split('\n');
        const streamsAdded = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]?.trim();
            if (!line)
                continue;
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
                let height = resMatch ? parseInt(resMatch[1], 10) : 0;
                let streamUrl = '';
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j] && !lines[j].trim().startsWith('#')) {
                        streamUrl = lines[j].trim();
                        break;
                    }
                }
                if (streamUrl) {
                    if (!height)
                        height = (0, utils_1.findHeight)(streamUrl) || (0, utils_1.findHeight)(data.data.file_name || '') || 1080;
                    let finalStreamUrl = streamUrl;
                    if (!streamUrl.startsWith('http')) {
                        finalStreamUrl = streamUrl.startsWith('/')
                            ? masterUrl.origin + streamUrl
                            : masterUrlStr.substring(0, masterUrlStr.lastIndexOf('/') + 1) + streamUrl;
                    }
                    streamsAdded.push({
                        url: new URL(finalStreamUrl),
                        meta: {
                            title: `[ImdbSu] ${height >= 2160 ? '[4K]' : height >= 1080 ? '[1080p]' : `[${height}p]`}`,
                            bytes: 0,
                            height,
                            countryCodes: this.countryCodes,
                            season: id.season,
                            episode: id.episode,
                        }
                    });
                }
            }
        }
        // Fallback to the master M3U8 if parsing yields zero mapped chunks (e.g. standard Direct Index)
        if (streamsAdded.length === 0) {
            const fallbackHeight = (0, utils_1.findHeight)(data.data.file_name || '') || 1080;
            streamsAdded.push({
                url: new URL(masterUrlStr),
                meta: {
                    title: `[ImdbSu] Auto-Select ${fallbackHeight >= 2160 ? '[4K]' : fallbackHeight >= 1080 ? '[1080p]' : `[${fallbackHeight}p]`}`,
                    bytes: 0,
                    height: fallbackHeight,
                    countryCodes: this.countryCodes,
                    season: id.season,
                    episode: id.episode,
                }
            });
        }
        results.push(...streamsAdded);
        return results;
    }
    parseConfig(html) {
        const match = html.match(/const\s+CONFIG\s*=\s*({[\s\S]*?});/);
        if (!match?.[1])
            return undefined;
        try {
            return JSON.parse(match[1]);
        }
        catch {
            return undefined;
        }
    }
}
exports.ImdbSu = ImdbSu;
