// Test stub for `puppeteer-core`.
//
// The real `puppeteer-core` package ships ESM that ts-jest's CommonJS transform cannot load,
// which breaks the entire `utils` barrel (Fetcher -> puppeteer) under jest and prevents any
// extractor/source test from running. Puppeteer is only used as a live Cloudflare-bypass
// fallback at runtime; unit tests never invoke it, so we export a stub whose methods throw if
// ever reached — surfacing a clear error instead of a silent misconfiguration.

const notAvailable = (): never => {
  throw new Error('puppeteer-core is stubbed in tests; the live Puppeteer fallback is not available.');
};

export default {
  launch: notAvailable,
};

export const launch = notAvailable;
