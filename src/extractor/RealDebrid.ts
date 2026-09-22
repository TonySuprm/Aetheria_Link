import winston from 'winston';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher, isRealDebridHoster, mergeDebridMeta, unrestrictRealDebrid } from '../utils';
import { Extractor } from './Extractor';

/**
 * RealDebrid extractor — resolves NitroFlare / Rapidgator / RapidRAR / ClicknUpload
 * (and any other debrid-supported hoster) URLs into premium direct-download links
 * via the RealDebrid REST API. Only matches when a RealDebrid API token is configured
 * in the user's add-on config (`realdebridApiKey`).
 *
 * Eager: the debrid API is called at stream-list time so Stremio receives direct,
 * short CDN URLs instead of long `/extract/` proxy URLs. Cached (10m TTL).
 */
export class RealDebrid extends Extractor {
  public readonly id = 'realdebrid';

  public readonly label = 'RealDebrid';

  public override readonly ttl = 600000; // 10m

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public supports(ctx: Context, url: URL): boolean {
    if (!ctx.config.realdebridApiKey) return false;
    return isRealDebridHoster(url.host);
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const apiToken = ctx.config.realdebridApiKey;
    if (!apiToken) return [];
    this.logger.info(`RealDebrid: unrestricting ${url.host} link`, ctx);

    const result = await unrestrictRealDebrid(ctx, this.fetcher, apiToken, url);
    const mergedMeta = mergeDebridMeta(meta, result);

    return [
      {
        url: result.url,
        format: Format.unknown,
        isExternal: false,
        notWebReady: true,
        label: this.label,
        meta: mergedMeta,
      },
    ];
  }
}
