import { Extractor } from '../extractor';
import { Source } from '../source';
import { Config } from '../types';
import { envGet } from './env';

export { envGet };

/**
 * Sources turned OFF by default for fresh installs (no saved config). The user can still
 * re-enable them from the configure page; once enabled (key removed from the config URL)
 * the choice persists across visits because their saved config no longer matches the default.
 * Empty by default — 111477.xyz's workers.dev per-worker 429 throttle is bypassed by the
 * relay's worker rotation (RelayController), so it ships enabled.
 */
export const DEFAULT_DISABLED_SOURCE_IDS: string[] = [];

export const getDefaultConfig = (): Config => {
  return {
    multi: 'on',
    en: 'on',
    ...Object.fromEntries(DEFAULT_DISABLED_SOURCE_IDS.map(id => [`disableSource_${id}`, 'on'])),
  } as Config;
};

export const getConfigWithEnvFallback = (urlConfig?: Config): Config => {
  const baseConfig = urlConfig ?? getDefaultConfig();

  const envMediaFlowProxyUrl = envGet('MEDIA_FLOW_PROXY_URL');
  const envMediaFlowProxyPassword = envGet('MEDIA_FLOW_PROXY_PASSWORD');
  const envAlldebridApiKey = envGet('ALLDEBRID_API_KEY');
  const envRealdebridApiKey = envGet('REALDEBRID_API_KEY');

  return {
    ...baseConfig,
    ...(envMediaFlowProxyUrl && !baseConfig.mediaFlowProxyUrl && { mediaFlowProxyUrl: envMediaFlowProxyUrl }),
    ...(envMediaFlowProxyPassword && !baseConfig.mediaFlowProxyPassword && { mediaFlowProxyPassword: envMediaFlowProxyPassword }),
    ...(envAlldebridApiKey && !baseConfig.alldebridApiKey && { alldebridApiKey: envAlldebridApiKey }),
    ...(envRealdebridApiKey && !baseConfig.realdebridApiKey && { realdebridApiKey: envRealdebridApiKey }),
  };
};

export const showErrors = (config: Config): boolean => 'showErrors' in config;

export const showExternalUrls = (config: Config): boolean => 'includeExternalUrls' in config;

export const hasMultiEnabled = (config: Config): boolean => 'multi' in config;

export const hasDebrid = (config: Config): boolean =>
  Boolean(config.alldebridApiKey?.trim()) || Boolean(config.realdebridApiKey?.trim());

export const getDebridSuffix = (config: Config): string => {
  const parts: string[] = [];
  if (config.alldebridApiKey?.trim()) parts.push('AD+');
  if (config.realdebridApiKey?.trim()) parts.push('RD+');
  return parts.length ? ` ${parts.join('')}` : '';
};

export const disableExtractorConfigKey = (extractor: Extractor): string => `disableExtractor_${extractor.id}`;

export const isExtractorDisabled = (config: Config, extractor: Extractor): boolean => disableExtractorConfigKey(extractor) in config;

export const disableSourceConfigKey = (source: Source): string => `disableSource_${source.id}`;

export const isSourceDisabled = (config: Config, source: Source): boolean => disableSourceConfigKey(source) in config;

export const excludeResolutionConfigKey = (resolution: string): string => `excludeResolution_${resolution}`;

export const isResolutionExcluded = (config: Config, resolution: string): boolean => excludeResolutionConfigKey(resolution) in config;
