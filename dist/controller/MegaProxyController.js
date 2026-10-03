"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MegaProxyController = void 0;
const express_1 = require("express");
const megajs_1 = require("megajs");
class MegaProxyController {
    router;
    logger;
    constructor(logger) {
        this.router = (0, express_1.Router)();
        this.logger = logger;
        this.router.get('/mega-proxy', this.proxy.bind(this));
    }
    async proxy(req, res) {
        const rawUrl = req.query['url'];
        if (!rawUrl) {
            res.status(400).json({ error: 'Missing url parameter' });
            return;
        }
        try {
            this.logger.info(`MegaProxy hit for ${rawUrl}`);
            const file = megajs_1.File.fromURL(rawUrl);
            await file.loadAttributes();
            // Range support for ExoPlayer/VLC
            const range = req.headers.range;
            const fileSize = file.size ?? 0;
            let start = 0;
            let end = Math.max(0, fileSize - 1);
            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const partialstart = parts[0];
                const partialend = parts[1];
                if (partialstart)
                    start = parseInt(partialstart, 10);
                if (partialend)
                    end = parseInt(partialend, 10);
            }
            const chunksize = (end - start) + 1;
            res.writeHead(range ? 206 : 200, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
            });
            const stream = file.download({ start, end });
            stream.pipe(res);
            req.on('close', () => {
                stream.destroy();
            });
        }
        catch (error) {
            this.logger.error(`MegaProxy extraction failed: ${error.message}`);
            if (!res.headersSent) {
                res.status(500).send('Internal Server Error');
            }
        }
    }
}
exports.MegaProxyController = MegaProxyController;
