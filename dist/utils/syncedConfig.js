"use strict";
// Shared mutable container for the last config synced from the webui's
// "Save & Apply". Isolated in its own module to avoid circular imports
// between index.ts (entry point) and context.ts (per-request helper).
//
// index.ts calls setSyncedConfig() whenever /app-sync POST fires (and on
// startup when loading the persisted config from disk). context.ts calls
// getSyncedConfig() to merge the webui toggles into every stream request's
// effective config so sources/extractors toggled OFF are actually skipped.
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSyncedConfig = exports.getSyncedConfig = void 0;
let _syncedConfig = null;
const getSyncedConfig = () => _syncedConfig;
exports.getSyncedConfig = getSyncedConfig;
const setSyncedConfig = (config) => {
    _syncedConfig = config;
};
exports.setSyncedConfig = setSyncedConfig;
