"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextFromRequestAndResponse = void 0;
const config_1 = require("./config");
const syncedConfig_1 = require("./syncedConfig");
function readBeamupHost() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const config = require('../../beamup-host.json');
        /* istanbul ignore next */
        return config.host;
    }
    catch {
        /* istanbul ignore next */
        return undefined;
    }
}
const beamupHost = readBeamupHost();
function resolveHostUrl(req) {
    const envHost = (0, config_1.envGet)('HOST') ?? (0, config_1.envGet)('BEAMUP_HOST') ?? beamupHost;
    const hostname = envHost ? envHost.replace(/^\/\//, '') : /* istanbul ignore next */ req.host;
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string'
        ? (forwardedProto.split(',')[0]?.trim() || req.protocol)
        : req.protocol;
    return new URL(`${protocol}://${hostname}`);
}
const contextFromRequestAndResponse = (req, res) => {
    const urlConfig = req.params['config']
        ? (() => {
            try {
                return JSON.parse(req.params['config']);
            }
            catch {
                throw new Error('Invalid config: malformed JSON');
            }
        })()
        : undefined;
    // Merge the webui-saved config (lastSyncedConfig) as the BASE layer, then
    // overlay the per-request URL config on top. This guarantees that sources /
    // extractors / resolutions toggled OFF in the webui's "Save & Apply" are
    // actually skipped during stream resolution — even when Aetheria Prime's
    // stream URL carries a stale or partial config segment from its own settings
    // panel. Without this merge, the URL config (or getDefaultConfig() when no
    // URL config is present) would override the webui toggles and disabled
    // sources would still be scraped.
    const syncedConfig = (0, syncedConfig_1.getSyncedConfig)();
    const synced = syncedConfig && typeof syncedConfig === 'object' && Object.keys(syncedConfig).length > 0
        ? syncedConfig
        : undefined;
    const effectiveConfig = (synced || urlConfig)
        ? { ...(synced ?? {}), ...(urlConfig ?? {}) }
        : undefined;
    return {
        hostUrl: resolveHostUrl(req),
        id: res.getHeader('X-Request-ID'),
        ...(req.ip && { ip: req.ip }),
        config: (0, config_1.getConfigWithEnvFallback)(effectiveConfig),
    };
};
exports.contextFromRequestAndResponse = contextFromRequestAndResponse;
