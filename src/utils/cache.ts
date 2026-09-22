/* istanbul ignore file */
import fs from 'node:fs';
import * as os from 'node:os';
// eslint-disable-next-line import/no-named-as-default
import KeyvSqlite from '@keyv/sqlite';
import { KeyvCacheableMemory } from 'cacheable';
import { glob } from 'glob';
import { KeyvStoreAdapter } from 'keyv';
import * as sqlite3 from 'sqlite3';
import winston from 'winston';
import { envGet, envIsTest } from './env';

const getCacheDir = (): string => envGet('CACHE_DIR') ?? os.tmpdir();

const scheduleKeyvSqliteCleanup = (keyvSqlite: KeyvSqlite): void => {
  const filename = keyvSqlite.opts.db;
  if (envIsTest() || !filename || !fs.existsSync(filename)) {
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

  if (envIsTest() || !cacheDir) {
    return new KeyvCacheableMemory();
  }

  const keyvSqlite = new KeyvSqlite(`sqlite://${cacheDir}/aetheria-link-${name}.sqlite`);

  scheduleKeyvSqliteCleanup(keyvSqlite);

  return keyvSqlite;
};

export const clearCache = async (logger: winston.Logger): Promise<void> => {
  for (const file of await glob(`${getCacheDir()}/aetheria-link*`)) {
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
