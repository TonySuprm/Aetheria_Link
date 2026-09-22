import winston from 'winston';
import { NotFoundError } from '../error';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Fetcher, isAllDebridHoster, mergeDebridMeta, unrestrictAllDebrid } from '../utils';
import { Extractor } from './Extractor';

/**
 * AllDebrid extractor — resolves NitroFlare / Rapidgator / RapidRAR / ClicknUpload
 * (and any other debrid-supported hoster) URLs into premium direct-download links
 * via the AllDebrid v4 API. Only matches when an AllDebrid API key is configured
 * in the user's add-on config (`alldebridApiKey`).
 *
 * Eager: the debrid API is called at stream-list time so Stremio receives direct,
 * short CDN URLs (e.g. `https://alldebrid.com/dl/.../<filename>.mkv`) instead of
 * long `/extract/` proxy URLs. The resolved CDN URL is cached (10m TTL) so repeated
 * requests don't re-hit the API.
 */
export class AllDebrid extends Extractor {
  public readonly id = 'alldebrid';

  public readonly label = 'AllDebrid';

  public override readonly ttl = 600000; // 10m — debrid links stay valid but refresh reasonably

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    super(fetcher, logger);
  }

  public supports(ctx: Context, url: URL): boolean {
    if (!ctx.config.alldebridApiKey) return false;
    return isAllDebridHoster(url.host);
  }

  public override normalize(url: URL): URL {
    // Some DDL sites append `.html` to the file ID (e.g. usersdrive.com/abc123.html).
    // AllDebrid's host regex and the hoster's own canonical page expect the bare ID,
    // so strip the extension before unrestricting.
    if (/\.html?$/i.test(url.pathname)) {
      const normalized = new URL(url.href);
      normalized.pathname = url.pathname.replace(/\.html?$/i, '');
      return normalized;
    }
    return url;
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const apiKey = ctx.config.alldebridApiKey;
    if (!apiKey) return [];
    this.logger.info(`AllDebrid: unrestricting ${url.host} link`, ctx);

    let result;
    try {
      result = await unrestrictAllDebrid(ctx, this.fetcher, apiKey, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Dead hoster links or unsupported hosts should silently drop the result instead
      // of emitting a broken error stream.
      if (/LINK_DOWN|LINK_HOST_NOT_SUPPORTED|LINK_PASSWORD_REQUIRED|LINK_NEED_WAIT/i.test(message)) {
        throw new NotFoundError(message);
      }
      throw error;
    }

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
