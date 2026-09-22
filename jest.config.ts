import type { Config } from 'jest';

const config: Config = {
  automock: false,
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/index.ts',
    '!<rootDir>/src/**/types.ts',
    '!<rootDir>/src/landingTemplate.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coveragePathIgnorePatterns: [
    '/src/controller/',
    '/src/utils/dispatcher.ts',
  ],
  coverageProvider: 'babel',
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  resetModules: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'node',
  testEnvironmentOptions: {
    globalsCleanup: 'on',
  },
  transform: {
    '^.+.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.dev.json',
    }],
  },
  // `puppeteer-core` ships ESM (`export * from './index.js'`) that ts-jest's CommonJS
  // transform cannot load, which breaks the whole `utils` barrel (Fetcher -> puppeteer) and
  // prevents any extractor/source test from running. Puppeteer is only used as a live
  // Cloudflare-bypass fallback in Fetcher; unit tests never invoke it, so stub it out.
  moduleNameMapper: {
    '^puppeteer$': '<rootDir>/src/test/puppeteer-core.stub.ts',
    '^puppeteer-core$': '<rootDir>/src/test/puppeteer-core.stub.ts',
  },
  modulePathIgnorePatterns: [
    '<rootDir>/dist',
    '<rootDir>/backup 1',
  ],
};

export default config;
