import winston from 'winston';
import { NotFoundError } from '../error';
import { Context, Format, InternalUrlResult, Meta, UrlResult } from '../types';
import { Fetcher } from '../utils';

export abstract class Extractor {
  public abstract readonly id: string;

  public abstract readonly label: string;

  public readonly ttl: number = 900000; // 15m

  public readonly cacheVersion: number | undefined = undefined;

  public readonly lazyExtract: boolean = false;

  // When true (and lazyExtract is true), the registry fires the real extraction in the background
  // at stream-list time (fire-and-forget) so the urlResultCache is warm by the time the user hits
  // play. Intended for lazy extractors whose chain is slow (e.g. GDFlix's FlareSolverr CF-bypass)
  // — without it, the first play blocks for the full chain duration. The play-time ExtractController
  // either finds the warm cache (instant) or awaits the shared in-flight pre-warm (no duplicate work).
  public readonly prewarmLazy: boolean = false;

  public readonly viaMediaFlowProxy: boolean = false;

  protected readonly fetcher: Fetcher;

  protected readonly logger: winston.Logger;

  public constructor(fetcher: Fetcher, logger: winston.Logger) {
    this.fetcher = fetcher;
    this.logger = logger;
  }

  public abstract supports(ctx: Context, url: URL): boolean;

  public normalize(url: URL): URL {
    return url;
  };

  // Async normalization for cache key only; original URL still passed to extractInternal()
  public async normalizeAsync(_ctx: Context, url: URL): Promise<URL> {
    return url;
  }

  protected abstract extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]>;

  public async extract(ctx: Context, url: URL, meta: Meta): Promise<UrlResult[]> {
    try {
      return (await this.extractInternal(ctx, url, meta)).map(
        urlResult => ({
          ...urlResult,
          label: this.formatLabel(urlResult.label ?? this.label),
          ttl: urlResult.ttl ?? this.ttl,

        }),
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }

      return [
        {
          url,
          format: Format.unknown,
          isExternal: true,
          error,
          label: this.formatLabel(this.label),
          ttl: 0,
          meta,
        },
      ];
    }
  };

  private formatLabel(label: string): string {
    return this.viaMediaFlowProxy ? `${label} (MFP)` : label;
  }
}
