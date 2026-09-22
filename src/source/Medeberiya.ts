import bytes from 'bytes';
import * as cheerio from 'cheerio';
import { ContentType } from 'stremio-addon-sdk';
import winston from 'winston';
import { Context, CountryCode, Meta } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { getClosestResolution } from '../utils/resolution';
import { Source, SourceResult } from './Source';

// Medeberiya (medeberiya1.com) — Ethiopian/global movie/series WordPress aggregator.
//
// The live WordPress origin is aggressively Cloudflare-protected, so the source no longer
// scrapes the site directly. Instead it queries the site's Jetpack-backed WordPress.com
// mirror via the public WordPress.com REST API:
//
//   https://public-api.wordpress.com/rest/v1.1/sites/248167167/posts?search=<title>&number=50
//
// This endpoint returns the rendered post/page HTML (including the blocked show pages) and
// does not sit behind Cloudflare, so it works from datacenter IPs. The HTML is parsed with
// cheerio; links whose surrounding block matches the requested episode are emitted as
// SourceResults and routed through the extractor registry (Mega, PixelDrain, GDFlix,
// ExternalUrl for direct .mkv links, etc.).

const WPCOM_API = 'https://public-api.wordpress.com/rest/v1.1/sites/248167167';
const BASE_ORIGIN = 'https://medeberiya1.com';
const BASE_HOSTNAME = 'medeberiya1.com';

const SIZE_RE = /\[?\s*([\d.]+)\s*(GB|MB)\s*\]?/i;
const YEAR_RE = /\b(19[89]\d|20\d{2})\b/g;
const SPINOFF_KEYWORDS = ['challenge', 'conversation', 'story', 'inconversation'];

const JUNK_HOSTS = new Set([
  'cloudflare.com',
  'gravatar.com',
  'wp.com',
  'wordpress.com',
  'facebook.com',
  'fb.me',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  't.me',
  'telegram.me',
  'google.com',
  'goo.gl',
  'bit.ly',
  'tinyurl.com',
  'web.archive.org',
]);

const clean = (str: string): string => str
  .toLowerCase()
  .replace(/\s*&\s*/g, 'and')
  .replace(/[^a-z0-9]/g, '');

const compareMedia = (resultTitle: string, wantedTitle: string, year: number | undefined, type: ContentType): boolean => {
  const normalizedResult = clean(resultTitle);
  const normalizedWanted = clean(wantedTitle);

  if (!normalizedResult.includes(normalizedWanted) && !normalizedWanted.includes(normalizedResult)) {
    return false;
  }

  const wantedLower = wantedTitle.toLowerCase();
  if (SPINOFF_KEYWORDS.some(kw => normalizedResult.includes(clean(kw)) && !wantedLower.includes(kw))) {
    return false;
  }

  const hasSeasonMarker = /\bseason\s*\d+|\bs\d+e\d+|\bepisode\s*\d+/i.test(resultTitle);
  if (type === 'movie' && hasSeasonMarker) {
    return false;
  }
  if (type === 'series' && /\bmovie\s+only\b/i.test(resultTitle)) {
    return false;
  }

  if (year) {
    const years = (resultTitle.match(YEAR_RE) ?? []).map(y => parseInt(y, 10));
    const hasMatchingYear = years.length === 0 || years.some(y => Math.abs(y - year) <= 1);
    if (!hasMatchingYear) return false;
  }

  return true;
};

const parseHeight = (text: string): number => {
  if (/2160p|4k/i.test(text)) return 2160;
  if (/1080p/i.test(text)) return 1080;
  if (/720p/i.test(text)) return 720;
  if (/480p/i.test(text)) return 480;
  return 0;
};

const parseSize = (text: string): number | undefined => {
  const m = text.match(SIZE_RE);
  if (!m) return undefined;
  return bytes.parse(`${m[1]} ${m[2]}`) as number | undefined;
};

const matchesEpisode = (text: string, season: number, episode: number): boolean => {
  const t = text.toUpperCase();
  const s = season.toString().padStart(2, '0');
  const e = episode.toString().padStart(2, '0');

  // Exact SxxEyy.
  if (new RegExp(`\\bS${s}E${e}\\b`).test(t)) return true;

  // "Season N ... Episode M".
  if (new RegExp(`\\bSEASON\\s*0*${season}\\b`, 'i').test(text)
    && new RegExp(`\\bEPISODE\\s*0*${episode}\\b`, 'i').test(text)) {
    return true;
  }

  // Range batches like S05E01-04, S01E02-04, S05E01-E04, S02E01 - S02E04.
  const range = text.match(/S(\d+)E(\d+)\s*[-–~]\s*(?:S(\d+)E?)?(\d+)/i);
  if (range) {
    const rangeSeason = parseInt(range[1] ?? '', 10);
    const start = parseInt(range[2] ?? '', 10);
    const end = parseInt(range[4] ?? '', 10);
    if (rangeSeason === season && episode >= start && episode <= end) return true;
  }

  // "Ep.02-04" / "Episode 2 - Episode 4" ranges when a season label is present nearby.
  const epRange = text.match(/(?:EP|EPISODE)\.?\s*(\d+)\s*[-–~]\s*(?:EP|EPISODE)?\.?\s*(\d+)/i);
  if (epRange) {
    const start = parseInt(epRange[1] ?? '', 10);
    const end = parseInt(epRange[2] ?? '', 10);
    if (episode >= start && episode <= end
      && new RegExp(`\\bSEASON\\s*0*${season}\\b`, 'i').test(text)) {
      return true;
    }
  }

  return false;
};

interface WpApiPost {
  ID: number;
  type: string;
  title: string;
  slug: string;
  content: string;
  URL: string;
}

interface CandidateLink {
  href: string;
  text: string;
  blockText: string;
}

export class Medeberiya extends Source {
  public readonly id = 'medeberiya';
  public readonly label = 'Medeberiya';
  public readonly contentTypes: ContentType[] = ['movie', 'series'];
  public readonly countryCodes: CountryCode[] = [CountryCode.multi];
  public readonly isAdult = false;

  public readonly baseUrl = BASE_ORIGIN;
  public override readonly priority = 0;

  private readonly fetcher: Fetcher;

  private get logger(): winston.Logger {
    return this.fetcher.getLogger();
  }

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  protected async handleInternal(ctx: Context, type: ContentType, id: Id): Promise<SourceResult[]> {
    if (type !== 'movie' && type !== 'series') return [];

    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);
    if (!name) return [];

    this.logger.info(`Medeberiya: resolving "${name}" (${year ?? 'no year'}) via WordPress.com API`, ctx);

    const posts = await this.searchWpApi(ctx, name);
    if (posts.length === 0) {
      this.logger.info(`Medeberiya: no WordPress.com posts for "${name}"`, ctx);
      return [];
    }

    const matchedPosts = posts.filter(p => compareMedia(p.title, name, year, type));
    if (matchedPosts.length === 0) {
      this.logger.info(`Medeberiya: no WordPress.com post title matched "${name}"`, ctx);
      return [];
    }

    const resultsByUrl = new Map<string, SourceResult>();

    for (const post of matchedPosts) {
      this.logger.info(`Medeberiya: scanning WordPress.com post "${post.title}" (${post.slug})`, ctx);
      const links = this.parseContentLinks(post.content, type, id);
      for (const link of links) {
        const result = this.buildSourceResult(ctx, link, name);
        const existing = resultsByUrl.get(result.url.href);
        if (!existing) {
          resultsByUrl.set(result.url.href, result);
          continue;
        }
        const mergedMeta: Meta = { ...existing.meta };
        if (result.meta.height && !mergedMeta.height) mergedMeta.height = result.meta.height;
        if (result.meta.bytes && !mergedMeta.bytes) mergedMeta.bytes = result.meta.bytes;
        if (result.meta.height || result.meta.bytes) {
          mergedMeta.title = result.meta.title;
        }
        resultsByUrl.set(result.url.href, { ...existing, meta: mergedMeta });
      }
    }

    const results = Array.from(resultsByUrl.values());
    if (results.length === 0) {
      this.logger.info(`Medeberiya: no usable links found for "${name}"`, ctx);
    } else {
      this.logger.info(`Medeberiya: returning ${results.length} link(s) for "${name}"`, ctx);
    }

    return results;
  }

  private async searchWpApi(ctx: Context, name: string): Promise<WpApiPost[]> {
    const encoded = encodeURIComponent(name);
    const postUrl = new URL(`${WPCOM_API}/posts?search=${encoded}&number=50`);
    const pageUrl = new URL(`${WPCOM_API}/posts?type=page&search=${encoded}&number=50`);

    const [postRes, pageRes] = await Promise.all([
      this.fetcher.json(ctx, postUrl) as Promise<unknown>,
      this.fetcher.json(ctx, pageUrl) as Promise<unknown>,
    ]);

    const posts = this.asWpPosts(postRes);
    const pages = this.asWpPosts(pageRes);

    const byId = new Map<number, WpApiPost>();
    for (const p of [...posts, ...pages]) {
      byId.set(p.ID, p);
    }

    return Array.from(byId.values());
  }

  private asWpPosts(response: unknown): WpApiPost[] {
    if (!response || typeof response !== 'object') return [];
    const posts = (response as Record<string, unknown>)['posts'];
    if (!Array.isArray(posts)) return [];
    return posts.filter((p: unknown) => {
      if (!p || typeof p !== 'object') return false;
      const item = p as Record<string, unknown>;
      return typeof item['ID'] === 'number'
        && typeof item['title'] === 'string'
        && typeof item['content'] === 'string'
        && typeof item['slug'] === 'string'
        && typeof item['URL'] === 'string';
    }) as WpApiPost[];
  }

  private parseContentLinks(html: string, type: ContentType, id: Id): CandidateLink[] {
    const $ = cheerio.load(html);
    const season = id.season ?? 0;
    const episode = id.episode ?? 0;

    const allLinks: CandidateLink[] = [];

    $('a').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      if (!href) return;

      let url: URL;
      try {
        url = new URL(href, BASE_ORIGIN);
      } catch {
        return;
      }

      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (url.hostname === BASE_HOSTNAME) return;

      const host = url.hostname.replace(/^www\./, '');
      if (JUNK_HOSTS.has(host)) return;

      const text = $el.text().trim();
      const title = $el.attr('title')?.trim() ?? '';
      const blockText = $el.closest('p, td, h6, li, tr, div, section, article').text().trim();

      if (type === 'series' && season > 0 && episode > 0) {
        if (!matchesEpisode(text, season, episode)
          && !matchesEpisode(title, season, episode)
          && !matchesEpisode(blockText, season, episode)) {
          return;
        }
      }

      allLinks.push({
        href: url.href,
        text: text || title,
        blockText,
      });
    });

    return allLinks;
  }

  private buildSourceResult(_ctx: Context, link: CandidateLink, titleName: string): SourceResult {
    const urlObj = new URL(link.href);
    const host = urlObj.hostname.replace(/^www\./, '');
    const combinedText = `${link.text} ${link.blockText}`;

    const height = parseHeight(link.text) || parseHeight(link.blockText);
    const size = parseSize(combinedText);

    const resLabel = height ? getClosestResolution(height) : '';

    let metaTitle = `[Medeberiya] ${host}`;
    if (resLabel) metaTitle += ` - ${resLabel}`;
    if (link.text && link.text.length > 0 && link.text !== 'Download' && link.text !== 'Link') {
      metaTitle += `\n${link.text}`;
    } else {
      metaTitle += `\n${titleName}`;
    }

    const meta: Meta = {
      title: metaTitle,
      sourceLabel: this.label,
      countryCodes: this.countryCodes,
      ...(height && { height }),
      ...(size && { bytes: size }),
    };

    return {
      url: urlObj,
      meta,
    };
  }
}
