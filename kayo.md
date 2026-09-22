# Kayoanime — Source Integration Notes

## What this addon is (Aetheria Link)

A Stremio add-on (TypeScript/Node, Express) that aggregates movie & TV/anime streams from
third-party "scene" sites.

- **Sources** (`src/source/*.ts`) extend `Source`; each searches its site for a TMDB/IMDB id and
  returns `SourceResult[]` (`{ url: URL; meta: Meta }`).
- **Extractors** (`src/extractor/*.ts`) resolve a `SourceResult.url` into a playable
  `InternalUrlResult`; registered in `ExtractorRegistry`. `ExternalUrl` is the fallback extractor.
- **RelayController** (`/relay?url=&referer=`) fetches a host server-side and serves Range to
  Stremio. Allow-listed hosts only. Two profiles: plain-GET + local-slice (hosts that reject Range)
  and Range-forward pass-through (hosts that honor 206).
- FlareSolverr (via Fetcher) bypasses Cloudflare at runtime.
- `StreamResolver` runs all enabled sources in parallel, dedupes, sorts, and maps `UrlResult`s to
  Stremio `Stream` objects. `notWebReady:true` routes through Stremio's streaming server (ffmpeg),
  which can demux MKV / octet-stream (the inline Chromium player cannot).
- The source-result cache (`source-cache-v3` SQLite, 12h default TTL) survives restarts and can
  serve stale results; bust by stopping the addon and deleting `%TEMP%\aetheria-link-source-cache-v3.sqlite`.

Kayoanime (kayoanime.com) is a WordPress (TIELab/Jannah) anime site added as a new source.

> Env note: there is no `.env` — `envGet` reads `process.env` only (`src/utils/env.ts:3`). All
> runtime config is set in the launcher script `_run_addon.ps1` (`$env:VAR = '...'` then
> `node dist/index.js`, port 51546).

---

## Current task

Add `https://kayoanime.com/` as a new source. Status: **DONE — source + file-link support +
Private-Drive cookie auth + relay wiring + tests green.** Remaining = live verification (see bottom).

User asks addressed:
1. **The Boy and the Beast 1080p** — was a direct GDrive *file* link, previously skipped. **Fixed**:
   source now handles `/file/d/<id>/view` links (movie → used directly; HEAD-checked for access).
   Both 720p (folder) and 1080p (file) now returned when present.
2. **Show both qualities when available** — `chooseLinks` already picks **one link per height**, so
   720p + 1080p (and any other distinct qualities) are all returned.
3. **Private Drive folders** — previously server-side unresolvable. **Fixed**: optional `GDRIVE_COOKIE`
   env (a logged-in Google account's cookie string) lets the folder list and the file stream. With a
   throwaway Google account that has joined the relevant Google Group, private resources resolve.

---

## How Kayoanime works (the chain)

Kayoanime post pages link to **Google Drive** resources — either a **folder** (one per quality /
season, holding episode `.mkv` files) or a **direct file** link (a single file, common for movies).
Many links are "Private Drive" resources gated behind a Google Group join: with no credentials these
yield nothing; with a logged-in Google account's cookies (`GDRIVE_COOKIE`) the folder lists and the
file streams.

Resolution chain implemented in `src/source/Kayoanime.ts`:

1. **Search** — WP `?s=<name>` (punctuation stripped, same fix as WorldFree4u's colon bug).
2. **Match post** — by slug **contains** the cleaned TMDB name (kayoanime slugs prefix the Japanese
   title, e.g. `sousou-no-frieren-…-1080p-bluray-dual-audio`, so `startsWith` would miss — unlike
   WorldFree4u). Year ±1, season (handles `Season 1-2` ranges). Filters out per-episode "english
   subbed" posts and news posts via a quality-token slug check
   (`DOWNLOAD_SLUG_RE = 1080p|2160p|720p|…|bluray|dual-audio|hevc`).
3. **Post page** — collect `<a class="shortc-button">` Google-Drive links (folder **OR** file) +
   their labels (quality / season / private flags).
4. **Folder → files** — list a public/private folder via
   `https://drive.google.com/embeddedfolderview?id=<id>#list` (cookies sent if `GDRIVE_COOKIE` set).
   Returns clean `<a href="https://drive.google.com/file/d/<FILE_ID>/view">` with `.flip-entry-title`
   filenames. A private folder with no cookie returns a sign-in page (no `/file/d/` entries) → skipped.
5. **File link → used directly** (movie only; a single file carries no episode to match for series).
   HEAD-check confirms access (public, or private via cookie) and yields the size.
6. **Episode match** (series) — parse episode number from filename: `SxxExx` / `Episode N` / `E0N` /
   trailing ` - 01` (the common kayoanime `Show - NN.mkv` pattern). Movie → folder: first video file.
7. **File → stream** — build
   `https://drive.usercontent.google.com/download?id=<FILE_ID>&export=download&confirm=t` and route
   through the addon's `/relay`.

### Quality selection (both qualities shown)

`chooseLinks` groups applicable links (correct season, or season-generic) by **height** and keeps the
best-ranked one per height (rank prefers season-specific + public > season-specific + private >
generic + public > generic + private). Result: one stream per distinct quality → 720p and 1080p both
appear when the post offers both.

### Why `/relay` + range-forward (verified live)

`drive.usercontent.google.com` (the public/cookie download CDN) was tested live:
- `Range: bytes=0-1023` → **206 Partial Content**, `Accept-Ranges: bytes`,
  `Content-Range: bytes 0-1023/<total>`, `Access-Control-Allow-Origin: *`.
- Plain HEAD → 200 + full `Content-Length`.
- `Content-Disposition: attachment; filename="…mkv"`, `Content-Type: application/octet-stream`.

This host **honors Range** (unlike GDFlix's `video-downloads.googleusercontent.com` which 400s on
Range). So it uses the relay's **range-forward** profile: the player's Range is forwarded upstream
and the upstream 206 is passed through verbatim — fully seekable. The relay's browser UA
(`RELAY_UA`) + 403/429 retry budget absorbs Google's transient download-quota errors.

`ExternalUrl` (fallback extractor) recognises `/relay` URLs (`isProxyStream`) and serves them as
`Format.unknown` + `notWebReady:true` → Stremio streaming server (ffmpeg) fetches the same-origin
relay URL → relay → google → 206. No new extractor was needed.

### Private Drive cookie auth (`GDRIVE_COOKIE`)

- **Kayoanime source** — sends `Cookie: <GDRIVE_COOKIE>` on the `embeddedfolderview` folder listing
  and on the file-link HEAD probe (`src/source/Kayoanime.ts`, `gdriveCookie` getter).
- **RelayController** — forwards `Cookie: <GDRIVE_COOKIE>` on `drive.usercontent.google.com` download
  requests so the streamed bytes come from the authenticated session (`RelayController.ts:172-175`).
- Without the env set, private folders/files are silently skipped (as before); only public
  resources resolve.

---

## What's done

- **`src/source/Kayoanime.ts`** — the source (id `kayoanime`, `contentTypes: [movie, series]`,
  `countryCodes: [multi, en]`, ttl 6h). `findPost` (slug-contains + quality-token filter + season
  range), `collectDownloadLinks` (folder **and** file links, de-duped), `chooseLinks` (one per
  height; prefer public + season-specific), `listFolder` (embeddedfolderview, cookie-aware),
  `parseEpisode`, file-link HEAD probe (cookie-aware).
- **`src/source/Kayoanime.test.ts`** — 15 tests: series episode resolution → `/relay` usercontent
  stream; episode disambiguation; private-folder-skipped (no cookie); season-2 prefers
  season-specific folder; movie; movie with 720p folder + 1080p file link → **2 streams**;
  private 1080p file inaccessible without cookie → only 720p; **GDRIVE_COOKIE forwarded on folder
  listing**; findPost filters subbed/news posts; slug-prefix contains matching; episode-parse cases.
  All pass.
- **`src/controller/RelayController.ts`** — `drive.usercontent.google.com` in `ALLOWED_HOSTS` +
  `RANGE_FORWARD_ENTRIES`; `GDRIVE_COOKIE` forwarded on googleusercontent download requests.
- **`src/source/index.ts`** — registered `Kayoanime` after `WorldFree4u`.
- `npx tsc --noEmit` clean; eslint clean; jest: Kayoanime 15/15 + RelayController 9/9 pass
  (24/24 total). `dist` rebuilt.

---

## Remaining (to make it complete)

### 1. Live verification — The Boy and the Beast (public, no cookie needed)

Tests pass but the live path is not yet confirmed end-to-end:
- Rebuild: `npx tsc` (`npm run build` fails on Windows: `rm` not found).
- Stop addon → delete `%TEMP%\aetheria-link-source-cache-v3.sqlite` → restart via `_run_addon.ps1`
  (else stale cached `[]` masks the fix).
- Live test: `/stream/movie/<tmdb>.json` for The Boy and the Beast → expect **both** 720p (folder)
  and 1080p (file) streams. Verify `/relay?url=<usercontent>` → 206 +
  `video/x-matroska`/octet-stream.

### 2. Private Drive (Monster Musume) — needs the throwaway Google account cookie

`monster-musume-no-iru-nichijou-…-seasons-1-1080p-bluray-dual-audio-hevc/` has only one download
button: `1080p [Private Drive]` → private folder. The title match works (slug contains the English
name); the dead-end is the private-drive gate. **Now solvable** with `GDRIVE_COOKIE`.

Steps for the user:
1. In a browser, log into the throwaway Google account and join the Google Group kayoanime points to
   (so the private Drive folder is shared with the account).
2. Open DevTools → Application/Storage → Cookies for `https://drive.google.com` (and
   `https://accounts.google.com`). Copy the auth cookie pairs — the ones that matter are
   `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-1PSID`, `__Secure-3PSID` (and their `__Secure-*`
   companions). Format as a single `name=value; name=value; …` string.
3. Set it in the launcher: `$env:GDRIVE_COOKIE = '<that string>'` in `_run_addon.ps1` (a commented
   placeholder line is present). **Treat as a secret** — it is full-account login.
4. Restart addon (cache-bust the sqlite). Live test `/stream/series/<tmdb>:1:1.json` for Monster
   Musume → expect the 1080p stream.

Caveat: Google auth cookies expire / rotate; refresh the string when private streams start 403ing.
`SAPISID` lets the relay mint the `Authorization: SAPISIDHASH` Google APIs expect on some endpoints —
but `drive.usercontent.google.com/download` accepts the raw cookie pair, so the hash is not required
for the download path implemented here.

### 3. Cookie-rotation / hardening (optional, later)

- Cookies live only in `process.env` (never written to a file) — matches the addon's existing
  secret-handling convention (see `fixit.md`).
- If private-folder listing ever 403s despite the cookie (Google tightening), the fallback is the
  Drive API v3 `files.list` with an OAuth access token — larger change, not needed yet.

---

## Key host facts

| Host | Range | Path |
|------|-------|------|
| `drive.google.com/embeddedfolderview` | n/a (HTML listing) | lists folder files (id + name); private → sign-in page (or lists with `GDRIVE_COOKIE`) |
| `drive.usercontent.google.com/download?id=<FILE_ID>&export=download&confirm=t` | yes (206) | GDrive file direct stream; routed via `/relay` range-forward (browser UA + 403/429 retry + `GDRIVE_COOKIE` for private) |

## Relevant files
- `src/source/Kayoanime.ts` — the source.
- `src/source/Kayoanime.test.ts` — tests.
- `src/source/index.ts` — source registry.
- `src/controller/RelayController.ts` — `drive.usercontent.google.com` allow-listed (range-forward) + `GDRIVE_COOKIE` forwarded.
- `src/extractor/ExternalUrl.ts` — handles `/relay` URLs (`isProxyStream` → `notWebReady:true`).
- `_run_addon.ps1` — launcher; set `GDRIVE_COOKIE` here.
