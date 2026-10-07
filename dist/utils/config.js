"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isResolutionExcluded = exports.excludeResolutionConfigKey = exports.isSourceDisabled = exports.disableSourceConfigKey = exports.isExtractorDisabled = exports.disableExtractorConfigKey = exports.getDebridSuffix = exports.hasDebrid = exports.hasMultiEnabled = exports.showExternalUrls = exports.showErrors = exports.getConfigWithEnvFallback = exports.forceEmbeddedMediaFlow = exports.embeddedMediaFlowAvailable = exports.EMBEDDED_MEDIAFLOW_URL = exports.getDefaultConfig = exports.DEFAULT_DISABLED_SOURCE_IDS = exports.envGet = void 0;
const env_1 = require("./env");
Object.defineProperty(exports, "envGet", { enumerable: true, get: function () { return env_1.envGet; } });
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
/**
 * Sources turned OFF by default for fresh installs (no saved config). The user can still
 * re-enable them from the configure page; once enabled (key removed from the config URL)
 * the choice persists across visits because their saved config no longer matches the default.
 * Empty by default — 111477.xyz's workers.dev per-worker 429 throttle is bypassed by the
 * relay's worker rotation (RelayController), so it ships enabled.
 */
exports.DEFAULT_DISABLED_SOURCE_IDS = [];
const getDefaultConfig = () => {
    return {
        multi: 'on',
        en: 'on',
        ...Object.fromEntries(exports.DEFAULT_DISABLED_SOURCE_IDS.map(id => [`disableSource_${id}`, 'on'])),
    };
};
exports.getDefaultConfig = getDefaultConfig;
exports.EMBEDDED_MEDIAFLOW_URL = 'http://127.0.0.1:8889';
/**
 * [halcyon patch] True when this instance co-runs the bundled MediaFlow Proxy
 * sidecar (libmediaflow.so shipped via Halcyon jniLibs). When true, the
 * sidecar is the ONLY valid MediaFlow for dailymotion (the manifest sec=
 * token is IP-bound to the fetcher) — every config layer must resolve to it.
 */
const embeddedMediaFlowAvailable = () => {
    const nativeBinDir = (0, env_1.envGet)('AETH_NATIVE_BIN_DIR') || process.env['AETH_NATIVE_BIN_DIR'];
    return Boolean(nativeBinDir && (0, node_fs_1.existsSync)(node_path_1.default.join(nativeBinDir, 'libmediaflow.so')));
};
exports.embeddedMediaFlowAvailable = embeddedMediaFlowAvailable;
/**
 * [halcyon patch] Force the embedded sidecar URL onto a config object.
 * Used on every config WRITE path (app-sync persistence, boot migration) so a
 * stale remote MediaFlow URL — e.g. re-saved from the webui's localStorage —
 * can never be persisted again on-device.
 */
const forceEmbeddedMediaFlow = (config) => {
    if ((0, exports.embeddedMediaFlowAvailable)()) {
        config.mediaFlowProxyUrl = exports.EMBEDDED_MEDIAFLOW_URL;
        if (!config.mediaFlowProxyPassword)
            config.mediaFlowProxyPassword = 'aetheria-link-secret';
    }
    return config;
};
exports.forceEmbeddedMediaFlow = forceEmbeddedMediaFlow;
const getConfigWithEnvFallback = (urlConfig) => {
    const baseConfig = urlConfig ?? (0, exports.getDefaultConfig)();
    const envMediaFlowProxyUrl = (0, env_1.envGet)('MEDIA_FLOW_PROXY_URL');
    const envMediaFlowProxyPassword = (0, env_1.envGet)('MEDIA_FLOW_PROXY_PASSWORD');
    const envAlldebridApiKey = (0, env_1.envGet)('ALLDEBRID_API_KEY');
    const envRealdebridApiKey = (0, env_1.envGet)('REALDEBRID_API_KEY');
    const resolved = {
        ...baseConfig,
        ...(envMediaFlowProxyUrl && !baseConfig.mediaFlowProxyUrl && { mediaFlowProxyUrl: envMediaFlowProxyUrl }),
        ...(envMediaFlowProxyPassword && !baseConfig.mediaFlowProxyPassword && { mediaFlowProxyPassword: envMediaFlowProxyPassword }),
        ...(envAlldebridApiKey && !baseConfig.alldebridApiKey && { alldebridApiKey: envAlldebridApiKey }),
        ...(envRealdebridApiKey && !baseConfig.realdebridApiKey && { realdebridApiKey: envRealdebridApiKey }),
    };
    // [halcyon patch] on-device embedded sidecar WINS over every config layer
    // (webui-saved config AND the per-request URL config segment): the
    // Dailymotion manifest sec= token is bound to the fetching IP, so a remote
    // MFP can never serve it — the co-located sidecar (same device/network) is
    // the only valid MediaFlow for this deployment shape.
    return (0, exports.forceEmbeddedMediaFlow)(resolved);
};
exports.getConfigWithEnvFallback = getConfigWithEnvFallback;
const showErrors = (config) => 'showErrors' in config;
exports.showErrors = showErrors;
const showExternalUrls = (config) => 'includeExternalUrls' in config;
exports.showExternalUrls = showExternalUrls;
const hasMultiEnabled = (config) => 'multi' in config;
exports.hasMultiEnabled = hasMultiEnabled;
const hasDebrid = (config) => Boolean(config.alldebridApiKey?.trim()) || Boolean(config.realdebridApiKey?.trim());
exports.hasDebrid = hasDebrid;
const getDebridSuffix = (config) => {
    const parts = [];
    if (config.alldebridApiKey?.trim())
        parts.push('AD+');
    if (config.realdebridApiKey?.trim())
        parts.push('RD+');
    return parts.length ? ` ${parts.join('')}` : '';
};
exports.getDebridSuffix = getDebridSuffix;
const disableExtractorConfigKey = (extractor) => `disableExtractor_${extractor.id}`;
exports.disableExtractorConfigKey = disableExtractorConfigKey;
const isExtractorDisabled = (config, extractor) => (0, exports.disableExtractorConfigKey)(extractor) in config;
exports.isExtractorDisabled = isExtractorDisabled;
const disableSourceConfigKey = (source) => `disableSource_${source.id}`;
exports.disableSourceConfigKey = disableSourceConfigKey;
const isSourceDisabled = (config, source) => (0, exports.disableSourceConfigKey)(source) in config;
exports.isSourceDisabled = isSourceDisabled;
const excludeResolutionConfigKey = (resolution) => `excludeResolution_${resolution}`;
exports.excludeResolutionConfigKey = excludeResolutionConfigKey;
const isResolutionExcluded = (config, resolution) => (0, exports.excludeResolutionConfigKey)(resolution) in config;
exports.isResolutionExcluded = isResolutionExcluded;
