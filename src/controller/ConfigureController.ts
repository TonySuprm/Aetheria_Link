import { Request, Response, Router } from 'express';
import { Extractor } from '../extractor';
import { landingTemplate } from '../landingTemplate';
import { Source } from '../source';
import { Config } from '../types';
import { buildManifest, getConfigWithEnvFallback, isElfHostedInstance } from '../utils';
import { lastSyncedConfig } from '../index';

export class ConfigureController {
  public readonly router: Router;

  private readonly sources: Source[];
  private readonly extractors: Extractor[];

  public constructor(sources: Source[], extractors: Extractor[]) {
    this.router = Router();

    this.sources = sources;
    this.extractors = extractors;

    this.router.get('/configure', this.getConfigure.bind(this));
    this.router.get('/:config/configure', this.getConfigure.bind(this));
  }

  private getConfigure(req: Request, res: Response) {
    let urlConfig: Config | undefined;
    if (req.params['config']) {
      try {
        urlConfig = JSON.parse(req.params['config'] as string);
      } catch {
        res.status(400).json({ error: 'Invalid config: malformed JSON' });
        return;
      }
    } else if (lastSyncedConfig && Object.keys(lastSyncedConfig).length > 0) {
      // If the URL has no payload but we hold a recently synced config in memory,
      // fallback to it so users don't see their toggles reset if they refresh
      // before Aetheria Prime's IPC poller manages to update the App URL.
      urlConfig = lastSyncedConfig;
    }

    const config = getConfigWithEnvFallback(urlConfig);

    // Convenience preset for ElfHosted Aetheria Link bundle including Media Flow Proxy
    if (!req.params['config'] && isElfHostedInstance(req)) {
      config.mediaFlowProxyUrl = `${req.protocol}://${req.host.replace('aetheria-link', 'mediaflow-proxy')}`;
    }

    const manifest = buildManifest(this.sources, this.extractors, config);
    manifest.logo = `${req.protocol}://${req.get('host')}/public/aetheria.png`;

    res.setHeader('content-type', 'text/html');
    res.send(landingTemplate(manifest, this.sources));
  };
}
