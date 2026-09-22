import { Request } from 'express';

const DEFAULT_ENV: Record<string, string> = {
  TMDB_ACCESS_TOKEN:
    'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYzM0YTE5NDdjM2MyM2IzZmJiMjdmYzk3NTY5MWJjYyIsIm5iZiI6MTc4Mjg1NTMwOS4wMDg5OTk4LCJzdWIiOiI2YTQ0MzY4ZDg3ZTE0NzIwNjVlNzFjYTMiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.GT88mkp2fpG3BdD0NFlIvL9W-Jh75rCludxR4FadUC8',
};

export const envGet = (name: string): string | undefined => process.env[name] ?? DEFAULT_ENV[name];

export const envGetRequired = (name: string): string => {
  const value = envGet(name);
  if (!value) {
    throw new Error(`Environment variable "${name}" is not configured.`);
  }

  return value;
};

export const envGetAppId = (): string => process.env['MANIFEST_ID'] || 'aetheria-link';

export const envGetAppName = (): string => process.env['MANIFEST_NAME'] || 'Aetheria Link';

export const envIsProd = (): boolean => process.env['NODE_ENV'] === 'production';

export const envIsTest = (): boolean => process.env['NODE_ENV'] === 'test';

export const isElfHostedInstance = (req: Request): boolean => req.host.endsWith('elfhosted.com');
