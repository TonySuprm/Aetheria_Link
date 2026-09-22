import { Request, Response } from 'express';
import { Context } from '../types';
import { envGet, getConfigWithEnvFallback } from './config';
import { getSyncedConfig } from './syncedConfig';

function readBeamupHost(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../../beamup-host.json') as { host?: string };
    /* istanbul ignore next */
    return config.host;
  } catch {
    /* istanbul ignore next */
    return undefined;
  }
}
const beamupHost: string | undefined = readBeamupHost();

function resolveHostUrl(req: Request): URL {
  const envHost = envGet('HOST') ?? envGet('BEAMUP_HOST') ?? beamupHost;
  const hostname = envHost ? envHost.replace(/^\/\//, '') : /* istanbul ignore next */ req.host;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProto === 'string'
    ? (forwardedProto.split(',')[0]?.trim() || req.protocol)
    : req.protocol;
  return new URL(`${protocol}://${hostname}`);
}

export const contextFromRequestAndResponse = (req: Request, res: Response): Context => {
  const urlConfig = req.params['config']
    ? (() => {
        try {
          return JSON.parse(req.params['config'] as string);
        } catch {
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
  const syncedConfig = getSyncedConfig();
  const synced = syncedConfig && typeof syncedConfig === 'object' && Object.keys(syncedConfig).length > 0
    ? syncedConfig
    : undefined;
  const effectiveConfig = (synced || urlConfig)
    ? { ...(synced ?? {}), ...(urlConfig ?? {}) }
    : undefined;

  return {
    hostUrl: resolveHostUrl(req),
    id: res.getHeader('X-Request-ID') as string,
    ...(req.ip && { ip: req.ip }),
    config: getConfigWithEnvFallback(effectiveConfig),
  };
};
