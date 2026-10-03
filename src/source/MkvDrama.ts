// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- the Puppeteer page.evaluate callbacks execute in a browser context (document/window) which is not part of the Node tsconfig lib
import { createDecipheriv } from 'node:crypto';
import type { Browser } from '../utils/puppeteer';
import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { envGet, Fetcher, findHeight, getBrowser, getTmdbId, getTmdbNameAndYear, Id, stealthPage } from '../utils';
import { Source, SourceResult } from './Source';

/**
 * mkvdrama.net resolution chain (all verified working end-to-end on the host, no FlareSolverr):
 *
 *   1. Search mkvdrama.net (rendered — it's a JS SPA) → numeric drama slug (e.g. 788920)
 *   2. Render the drama page → `/_c/<token>` download links per quality, grouped by episode range
 *   3. Navigate each `/_c/<token>` in Puppeteer → it redirects to an ouo.io short link
 *   4. Drive ouo's interstitial (auto-submit #form-captcha then #form-go — mirrors the
 *      adLBypasser userscript in bypass_ouo.txt; Cloudflare Turnstile clears in headless) →
 *      viewcrate.cc/c/<hash>
 *   5. viewcrate chain (via the Fetcher's cookie jar):
 *        GET /c/<hash>          (acquires the vc_viewer session cookie)
 *        GET /c/<hash>/bootstrap → {k,i,c,r} JSON → AES-256-GCM decrypt → episode/host links
 *        GET /c/<hash>/open/<token> (cookie carried) → 307 → /get/<jwt> → 307 → filehoster URL
 *   6. Hand each filehoster URL (gofile/pixeldrain/send.now) to the ExtractorRegistry, whose
 *      GoFile/PixelDrain/SendCm extractors produce playable Stremio streams.
 *
 * The whole discovery path runs in a single stealth Puppeteer session (one tab) so Cloudflare
 * clearance and the drama-page session carry through to the `/_c/` → ouo hop.
 *
 * Reliable manual fallback: set `MKVDRAMA_VIEWCRATE_HASH=<hash>` to skip steps 1-4 entirely and
 * go straight to the viewcrate chain — useful when mkvdrama/ouo change their flow.
 */
const PUPPETEER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class MkvDrama extends Source {
  public readonly id = 'mkvdrama';
  public readonly label = 'MkvDrama';
  public readonly contentTypes: ContentType[] = ['movie', 'series'];
  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.ko];
  public readonly baseUrl = 'https://mkvdrama.net';

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  private get logger() {
    return this.fetcher.getLogger();
  }

  public async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const chromePath = envGet('PUPPETEER_EXECUTABLE_PATH');
    if (!chromePath) {
      this.logger.warn('MkvDrama requires PUPPETEER_EXECUTABLE_PATH (a Chrome path) which is not configured', ctx);
      return [];
    }

    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
    if (!name) {
      return [];
    }

    const label = tmdbId.season ? `${name} ${tmdbId.formatSeasonAndEpisode()}` : `${name} (${year})`;

    // --- viewcrate hash: auto-discover via mkvdrama→ouo, or use the manual override ---
    let hashes: { hash: string; quality: string; blockTitle: string }[];
    const manualHash = envGet('MKVDRAMA_VIEWCRATE_HASH');
    if (manualHash) {
      this.logger.info(`MkvDrama: using manual viewcrate hash override ${manualHash}`, ctx);
      hashes = [{ hash: manualHash, quality: '', blockTitle: '' }];
    } else {
      hashes = await this.discoverHashes(ctx, name, tmdbId).catch((error) => {
        this.logger.warn(`MkvDrama discovery failed: ${error}`, ctx);
        return [];
      });
    }

    if (hashes.length === 0) {
      return [];
    }

    // --- resolve each hash to file-hoster URLs via the cookie-aware viewcrate chain ---
    const sourceResults: SourceResult[] = [];
    for (const { hash, quality, blockTitle } of hashes) {
      const hosterUrls = await this.resolveViewcrate(ctx, hash, tmdbId.season, tmdbId.episode).catch((error) => {
        this.logger.warn(`MkvDrama viewcrate resolve failed for ${hash}: ${error}`, ctx);
        return [];
      });

      for (const hosterUrl of hosterUrls) {
        sourceResults.push({
          url: new URL(hosterUrl),
          meta: {
            title: [label, blockTitle, quality].filter(Boolean).join(' '),
            height: findHeight(quality),
            countryCodes: [CountryCode.ko, CountryCode.multi],
          },
        });
      }
    }

    this.logger.info(`MkvDrama returning ${sourceResults.length} hoster links for ${name}`, ctx);
    return sourceResults;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Steps 1-4: discover viewcrate hash(es) from the drama name
  // ─────────────────────────────────────────────────────────────────────────────
  private discoverHashes = async (ctx: Context, name: string, tmdbId: Id): Promise<{ hash: string; quality: string; blockTitle: string }[]> => {
    const browser = await getBrowser(this.logger);
    const tab = await browser.newPage();
    try {
      await stealthPage(tab);
      await tab.setUserAgent(PUPPETEER_UA);
      await tab.setExtraHTTPHeaders({ Accept: 'text/html,application/xhtml+xml' });

      // Step 1: search → drama slug
      const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(name)}`;
      await tab.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      const slug = await tab.evaluate((want) => {
        let best: { slug: string; d: number } | null = null;
        const w = want.toLowerCase();
        document.querySelectorAll('a').forEach((a) => {
          const m = a.href.match(/mkvdrama\.net\/(\d{3,})\/?$/);
          if (!m) return;
          const t = (a.getAttribute('title') || a.querySelector('h2,h3,.tt,b')?.textContent || a.textContent || '').trim().toLowerCase();
          if (!t) return;
          // exact-ish match: title starts with the query, or query starts with title
          const d = t.startsWith(w) || w.startsWith(t) ? 0 : Math.abs(t.length - w.length);
          if (!best || d < best.d) best = { slug: m[1], d };
        });
        return best?.slug ?? null;
      }, name).catch(() => null);

      if (!slug) {
        this.logger.info(`MkvDrama: no drama slug found for "${name}"`, ctx);
        return [];
      }

      // Step 2: render drama page → /_c/ quality links (episode-filtered)
      await tab.goto(`${this.baseUrl}/${slug}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await tab.waitForSelector('#mlx-root .soraddlx', { timeout: 30000 }).catch(() => undefined);

      const candidates = await tab.evaluate((ep) => {
        const blockCoversEpisode = (title: string, epN: number | undefined): boolean => {
          if (!epN) return true;
          const nums = (title.match(/\d+/g) ?? []).map(n => parseInt(n, 10));
          if (nums.length === 0) return true;
          if (nums.length === 1) return nums[0] === epN;
          return epN >= Math.min(...nums) && epN <= Math.max(...nums);
        };
        const out: { quality: string; blockTitle: string; link: string }[] = [];
        const seenQuality = new Set<string>();
        document.querySelectorAll('#mlx-root .soraddlx').forEach((block) => {
          const blockTitle = block.querySelector('.sorattlx h3, h3')?.textContent?.trim() ?? '';
          if (ep && !blockCoversEpisode(blockTitle, ep)) return;
          block.querySelectorAll('.soraurlx').forEach((group) => {
            const quality = group.querySelector('strong')?.textContent?.trim() ?? 'Unknown';
            if (seenQuality.has(quality)) return;
            const link = [...group.querySelectorAll('a')].map(a => (a).href).find(h => h.includes('/_c/'));
            if (link) {
              seenQuality.add(quality);
              out.push({ quality, blockTitle, link });
            }
          });
        });
        return out.slice(0, 6);
      }, tmdbId.episode).catch(() => []);

      this.logger.info(`MkvDrama: slug ${slug} → ${candidates.length} quality /_c/ candidates`, ctx);
      if (candidates.length === 0) {
        return [];
      }

      // Step 3-4: resolve a /_c/ link → ouo → bypass → viewcrate hash. A SINGLE viewcrate
      // container's bootstrap returns every episode AND every file-hoster for this title, so we
      // only need ONE hash. Race the candidates and take the first that yields a hash — this caps
      // the total time to ~one ouo-bypass cycle (~30s) instead of N× that.
      const racers = candidates.map(c => this.cLinkToViewcrateHash(ctx, browser, c.link).then((hash) => {
        if (!hash) throw new Error('no hash');
        return { hash, quality: c.quality, blockTitle: c.blockTitle };
      }));
      // Attach a no-op catch so losing/late rejections never surface as unhandled-rejection.
      const firstHash = await Promise.any(racers).catch(() => null);
      // Ensure any still-pending (losing) tabs resolve/clean up without surfacing errors.
      racers.forEach(p => p.catch(() => undefined));

      return firstHash ? [firstHash] : [];
    } finally {
      await tab.close().catch(() => undefined);
    }
  };

  // Navigate a /_c/ link in a fresh tab, then drive ouo's interstitial until we land on viewcrate.
  // Opens its own tab so it can run concurrently with other candidates. Hard-capped at ~35s.
  private cLinkToViewcrateHash = async (ctx: Context, browser: Browser, cLink: string): Promise<string | undefined> => {
    const tab = await browser.newPage();
    try {
      await stealthPage(tab);
      await tab.setUserAgent(PUPPETEER_UA);
      await tab.goto(cLink, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
      await new Promise(r => setTimeout(r, 1500));

      // The /_c/ page should have redirected to ouo.io. Drive the bypass (auto-submit forms).
      const deadline = Date.now() + 33000;
      while (Date.now() < deadline) {
        const url = tab.url();
        if (/viewcrate|viewvault/.test(url)) {
          return url.split('/c/')[1]?.split(/[/?#]/)[0];
        }
        if (/ouo\.(io|press)/.test(url)) {
          try {
            await tab.evaluate(() => {
              const path = location.pathname;
              const id = path.startsWith('/go') ? 'form-go' : 'form-captcha';
              const form = document.getElementById(id) as HTMLFormElement | null;
              if (form) form.submit();
            });
          } catch { /* page navigated between evaluate and here */ }
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      this.logger.info(`MkvDrama: /_c/ → ouo → viewcrate timed out (last url ${tab.url()})`, ctx);
      return undefined;
    } finally {
      await tab.close().catch(() => undefined);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 5: cookie-aware viewcrate → file-hoster chain (via the Fetcher's shared cookie jar)
  // ─────────────────────────────────────────────────────────────────────────────
  private resolveViewcrate = async (
    ctx: Context,
    hash: string,
    season: number | undefined,
    episode: number | undefined,
  ): Promise<string[]> => {
    const base = `https://viewcrate.cc/c/${hash}`;

    // Acquire the session cookie (vc_viewer) by loading the container page. The Fetcher's cookie
    // jar stores it and automatically attaches it to the bootstrap/open requests below.
    await this.fetcher.text(ctx, new URL(base), { headers: { Referer: this.baseUrl + '/' } }).catch(() => undefined);

    const bootstrap = await this.fetcher.json(ctx, new URL(`${base}/bootstrap`)).catch(() => null) as { k?: string; i?: string; c?: string; r?: string[] } | null;
    if (!bootstrap?.k || !bootstrap?.i || !bootstrap?.c) {
      return [];
    }

    const payload = this.decryptViewcrate(bootstrap.k, bootstrap.i, bootstrap.c);
    if (!payload?.d || !Array.isArray(payload.d)) {
      return [];
    }

    const allowedReferrers = (bootstrap.r ?? []).map(h => h.toLowerCase());

    // Select the episode group(s).
    let groups = payload.d;
    if (episode) {
      const wanted = `S${String(season ?? 1).padStart(2, '0')}E${String(episode).padStart(2, '0')}`.toLowerCase();
      const matching = groups.filter(g => typeof g.t === 'string' && g.t.toLowerCase().includes(wanted));
      if (matching.length > 0) {
        groups = matching;
      } else {
        const byNumber = groups.filter(g => typeof g.t === 'string' && new RegExp(`E0*${episode}\\b`, 'i').test(g.t));
        if (byNumber.length > 0) {
          groups = byNumber;
        }
      }
    }

    const links: { host: string; token: string }[] = [];
    for (const group of groups) {
      for (const link of (group.l ?? [])) {
        if (link?.h && link?.u) {
          links.push({ host: link.h, token: link.u });
        }
      }
    }

    const filehosterUrls: string[] = [];
    for (const link of links) {
      const privacy = allowedReferrers.includes(link.host.toLowerCase()) ? 'allow-referrer' : 'noreferrer';
      const openUrl = `${base}/open/${encodeURIComponent(link.token)}?privacy=${privacy}`;
      const finalUrl = await this.followOpenRedirect(ctx, openUrl).catch(() => undefined);
      if (finalUrl && this.isHosterUrl(finalUrl)) {
        filehosterUrls.push(finalUrl);
      }
    }

    return [...new Set(filehosterUrls)];
  };

  private decryptViewcrate = (k: string, i: string, c: string): { d?: { t?: string; l?: { n?: string; h?: string; u?: string }[] }[] } | null => {
    try {
      const key = Buffer.from(k, 'base64');
      const iv = Buffer.from(i, 'base64');
      const data = Buffer.from(c, 'base64');
      const tag = data.subarray(data.length - 16);
      const ct = data.subarray(0, data.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
      return JSON.parse(dec.toString());
    } catch (error) {
      this.logger.warn(`MkvDrama viewcrate decrypt failed: ${error}`);
      return null;
    }
  };

  // GET-based redirect follower — the viewcrate `open` endpoint 307-redirects only on GET
  // (HEAD returns 404), and the `/get/<jwt>` needs the session cookie the Fetcher jar now holds.
  private followOpenRedirect = async (ctx: Context, url: string): Promise<string | undefined> => {
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      const response = await this.fetcher.fetch(ctx, new URL(current), { method: 'GET', maxRedirects: 0 });
      const location = response.headers['location'];
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).href;
        continue;
      }
      return current;
    }
    return current;
  };

  private isHosterUrl = (url: string): boolean => {
    try {
      return /pixeldrain|gofile|send\.cm|sendcm|send\.now|vidmoly|mixdrop|doodstream|filemoon|streamtape|uqload|voe\.|vidoza|supervideo|fastream|lulustream|filelions|vidsonic|dropload|vidara|vidfast|krakenfiles|savefiles|fsst/.test(new URL(url).host);
    } catch {
      return false;
    }
  };
}
