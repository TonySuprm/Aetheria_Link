/* istanbul ignore file */
import fs from 'node:fs';
import * as os from 'node:os';
// eslint-disable-next-line import/no-named-as-default
import { KeyvCacheableMemory } from 'cacheable';
import { KeyvStoreAdapter } from 'keyv';
import winston from 'winston';
import { envGet, envIsTest } from './env';

/**
 * Native SQLite is optional: on hosts without a native toolchain (Android
 * on-device hosting, slim containers) the sqlite3 install is skipped via
 * optionalDependencies and the cache silently falls back to the pure-JS
 * in-memory store. Both modules are therefore loaded lazily.
 */
type KeyvSqliteLike = KeyvStoreAdapter & { opts: { db?: string } };
type Sqlite3Like = { Database: new (file: string) => {
  serialize: (fn: () => void) => void;
  run: (sql: string, cb: () => void) => void;
  close: () => void;
} };

const loadKeyvSqlite = (): (new (uri: string) => KeyvSqliteLike) | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@keyv/sqlite') as { default: new (uri: string) => KeyvSqliteLike };
    return mod.default || (mod as unknown as new (uri: string) => KeyvSqliteLike);
  } catch {
    return null;
  }
};

const loadSqlite3 = (): Sqlite3Like | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('sqlite3') as Sqlite3Like;
  } catch {
    return null;
  }
};

const getCacheDir = (): string => envGet('CACHE_DIR') ?? os.tmpdir();

const scheduleKeyvSqliteCleanup = (keyvSqlite: KeyvSqliteLike): void => {
  const sqlite3 = loadSqlite3();
  const filename = keyvSqlite.opts.db;
  if (envIsTest() || !filename || !sqlite3 || !fs.existsSync(filename)) {
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

export const createKeyvSqlite = (name: string): KeyvStoreAdapter => {
  const cacheDir = getCacheDir();
  const KeyvSqlite = loadKeyvSqlite();

  if (envIsTest() || !cacheDir || !KeyvSqlite) {
    // No native SQLite available (or tests): pure-JS in-memory cache.
    return new KeyvCacheableMemory();
  }

  const keyvSqlite = new KeyvSqlite(`sqlite://${cacheDir}/aetheria-link-${name}.sqlite`) as KeyvSqliteLike;

  scheduleKeyvSqliteCleanup(keyvSqlite);

  return keyvSqlite;
};

export const clearCache = async (logger: winston.Logger): Promise<void> => {
  const cacheDir = getCacheDir();
  // fs listing instead of glob@13: glob 13 requires Node >= 20 and the addon
  // must also boot on Node 18 runtimes (e.g. nodejs-mobile on-device hosting).
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(cacheDir).filter((entry) => entry.startsWith('aetheria-link'));
  } catch {
    return; // cache dir does not exist yet — nothing to clear
  }
  for (const entry of entries) {
    const file = `${cacheDir}/${entry}`;
    try {
      fs.rmSync(file);
      logger.info(`Delete cache file ${file}`);
    } catch (error) {
      // On Windows the SQLite caches are held open by this process's own KeyvSqlite connections
      // (opened at module load, before this runs), so rmSync can fail with EBUSY. Swallow
      // per-file errors so CACHE_FILES_DELETE_ON_START never aborts startup. To actually clear
      // the cache, delete the files before launch (e.g. start-all.ps1) while no node runs.
      logger.warn(`Could not delete cache file ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }
};
