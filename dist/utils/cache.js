"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCache = exports.createKeyvSqlite = void 0;
/* istanbul ignore file */
const node_fs_1 = __importDefault(require("node:fs"));
const os = __importStar(require("node:os"));
// eslint-disable-next-line import/no-named-as-default
const cacheable_1 = require("cacheable");
const env_1 = require("./env");
const loadKeyvSqlite = () => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('@keyv/sqlite');
        return mod.default || mod;
    }
    catch {
        return null;
    }
};
const loadSqlite3 = () => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('sqlite3');
    }
    catch {
        return null;
    }
};
const getCacheDir = () => (0, env_1.envGet)('CACHE_DIR') ?? os.tmpdir();
const scheduleKeyvSqliteCleanup = (keyvSqlite) => {
    const sqlite3 = loadSqlite3();
    const filename = keyvSqlite.opts.db;
    if ((0, env_1.envIsTest)() || !filename || !sqlite3 || !node_fs_1.default.existsSync(filename)) {
        return;
    }
    setInterval(() => {
        const db = new sqlite3.Database(filename);
        db.serialize(() => {
            db.run('DELETE FROM keyv WHERE json_extract(value, \'$.expires\') <= (strftime(\'%s\', \'now\') * 1000)', () => {
                db.close();
            });
        });
    }, 60 * 60 * 1000); // every hour
};
const createKeyvSqlite = (name) => {
    const cacheDir = getCacheDir();
    const KeyvSqlite = loadKeyvSqlite();
    if ((0, env_1.envIsTest)() || !cacheDir || !KeyvSqlite) {
        // No native SQLite available (or tests): pure-JS in-memory cache.
        return new cacheable_1.KeyvCacheableMemory();
    }
    const keyvSqlite = new KeyvSqlite(`sqlite://${cacheDir}/aetheria-link-${name}.sqlite`);
    scheduleKeyvSqliteCleanup(keyvSqlite);
    return keyvSqlite;
};
exports.createKeyvSqlite = createKeyvSqlite;
const clearCache = async (logger) => {
    const cacheDir = getCacheDir();
    // fs listing instead of glob@13: glob 13 requires Node >= 20 and the addon
    // must also boot on Node 18 runtimes (e.g. nodejs-mobile on-device hosting).
    let entries = [];
    try {
        entries = node_fs_1.default.readdirSync(cacheDir).filter((entry) => entry.startsWith('aetheria-link'));
    }
    catch {
        return; // cache dir does not exist yet — nothing to clear
    }
    for (const entry of entries) {
        const file = `${cacheDir}/${entry}`;
        try {
            node_fs_1.default.rmSync(file);
            logger.info(`Delete cache file ${file}`);
        }
        catch (error) {
            // On Windows the SQLite caches are held open by this process's own KeyvSqlite connections
            // (opened at module load, before this runs), so rmSync can fail with EBUSY. Swallow
            // per-file errors so CACHE_FILES_DELETE_ON_START never aborts startup. To actually clear
            // the cache, delete the files before launch (e.g. start-all.ps1) while no node runs.
            logger.warn(`Could not delete cache file ${file}: ${error instanceof Error ? error.message : error}`);
        }
    }
};
exports.clearCache = clearCache;
