"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigureController = void 0;
const express_1 = require("express");
const landingTemplate_1 = require("../landingTemplate");
const utils_1 = require("../utils");
const index_1 = require("../index");
class ConfigureController {
    router;
    sources;
    extractors;
    constructor(sources, extractors) {
        this.router = (0, express_1.Router)();
        this.sources = sources;
        this.extractors = extractors;
        this.router.get('/configure', this.getConfigure.bind(this));
        this.router.get('/:config/configure', this.getConfigure.bind(this));
    }
    getConfigure(req, res) {
        let urlConfig;
        if (req.params['config']) {
            try {
                urlConfig = JSON.parse(req.params['config']);
            }
            catch {
                res.status(400).json({ error: 'Invalid config: malformed JSON' });
                return;
            }
        }
        else if (index_1.lastSyncedConfig && Object.keys(index_1.lastSyncedConfig).length > 0) {
            // If the URL has no payload but we hold a recently synced config in memory,
            // fallback to it so users don't see their toggles reset if they refresh
            // before Aetheria Prime's IPC poller manages to update the App URL.
            urlConfig = index_1.lastSyncedConfig;
        }
        const config = (0, utils_1.getConfigWithEnvFallback)(urlConfig);
        // Convenience preset for ElfHosted Aetheria Link bundle including Media Flow Proxy
        if (!req.params['config'] && (0, utils_1.isElfHostedInstance)(req)) {
            config.mediaFlowProxyUrl = `${req.protocol}://${req.host.replace('aetheria-link', 'mediaflow-proxy')}`;
        }
        const manifest = (0, utils_1.buildManifest)(this.sources, this.extractors, config);
        manifest.logo = `${req.protocol}://${req.get('host')}/public/aetheria.png`;
        res.setHeader('content-type', 'text/html');
        res.send((0, landingTemplate_1.landingTemplate)(manifest, this.sources));
    }
    ;
}
exports.ConfigureController = ConfigureController;
