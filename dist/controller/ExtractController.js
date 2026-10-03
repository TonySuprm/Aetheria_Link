"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtractController = void 0;
const async_mutex_1 = require("async-mutex");
const express_1 = require("express");
const utils_1 = require("../utils");
const EXTRACT_TIMEOUT_MS = 30_000;
class ExtractController {
    router;
    logger;
    extractorRegistry;
    locks = new Map();
    constructor(logger, _fetcher, extractorRegistry) {
        this.router = (0, express_1.Router)();
        this.logger = logger;
        this.extractorRegistry = extractorRegistry;
        this.router.get('/extract', this.extract.bind(this));
        this.router.get('/:config/extract', this.extract.bind(this));
    }
    async extract(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.status(405).send('Method Not Allowed');
            return;
        }
        let ctx;
        try {
            ctx = (0, utils_1.contextFromRequestAndResponse)(req, res);
        }
        catch (error) {
            res.status(400).json({ error: error.message });
            return;
        }
        const rawUrl = req.query['url'];
        const rawIndex = req.query['index'];
        if (!rawUrl || !rawIndex) {
            res.status(400).json({ error: 'Missing url or index parameter' });
            return;
        }
        let url;
        try {
            url = new URL(rawUrl);
        }
        catch {
            res.status(400).json({ error: 'Invalid url parameter' });
            return;
        }
        const index = parseInt(rawIndex);
        if (isNaN(index)) {
            res.status(400).json({ error: 'Invalid index parameter' });
            return;
        }
        this.logger.info(`Lazy extract index ${index} of URL ${url} for ip ${ctx.ip}`, ctx);
        let mutex = this.locks.get(url.href);
        if (!mutex) {
            mutex = new async_mutex_1.Mutex();
            this.locks.set(url.href, mutex);
        }
        let timedOut = false;
        const extraction = mutex.runExclusive(async () => {
            const meta = {};
            const season = req.query['season'];
            const episode = req.query['episode'];
            if (season)
                meta['season'] = parseInt(season, 10);
            if (episode)
                meta['episode'] = parseInt(episode, 10);
            const urlResults = await this.extractorRegistry.handle(ctx, url, meta);
            if (timedOut) {
                this.logger.info(`Lazy extract completed after client timeout — result cached for URL ${url}`, ctx);
                return;
            }
            const urlResult = urlResults[index];
            if (!urlResult || urlResult.error) {
                this.logger.warn(`Lazy extract failed for URL ${url} (index ${index}): ${urlResult?.error ?? 'no result'}`, ctx);
                res.status(503).send('Service Unavailable');
                return;
            }
            this.logger.info(`Lazy extract redirecting to ${urlResult.url.href} for URL ${url}`, ctx);
            res.redirect(urlResult.url.href);
        });
        const timeout = new Promise((resolve) => {
            setTimeout(() => {
                if (!res.headersSent) {
                    timedOut = true;
                    this.logger.warn(`Lazy extract timed out after ${EXTRACT_TIMEOUT_MS}ms for URL ${url}`, ctx);
                    res.status(504).send('Gateway Timeout');
                }
                resolve();
            }, EXTRACT_TIMEOUT_MS);
        });
        await Promise.race([extraction, timeout]);
        if (!mutex.isLocked()) {
            this.locks.delete(url.href);
        }
    }
    ;
}
exports.ExtractController = ExtractController;
