# Source-fix session summary

## Request
- Fix `start-all.ps1` startup and add a time-bounded dead-link filter for 4KHDHub/HDHub/hub-style hosters.
- Countercheck VidSrc.
- Fix `e.mkvking.dad` / MkvKing.
- Fix Anidap links that get stuck at `0:00`.

## Changes made

### `start-all.ps1` — fixed
- Removed the interactive `Read-Host` port prompt; MediaFlow and addon ports now auto-scan to the next free port (with optional `MEDIAFLOW_PROXY_PORT` env override).
- Cleaned up startup/teardown:
  - Only kills the specific `node.exe` / `mediaflow-proxy.exe` PIDs the script starts.
  - Renamed the FlareSolverr container to `aetheria-flaresolverr` and only stops/removes that container.
  - FlareSolverr now kills any stray process on port `8191` before starting a fresh container.
- Fixed `Test-DockerAvailable`: `docker version --format` exits `0` with empty output, so the check now validates the printed version string and retries.
- Added `WSMBG_LOG_FILE="$env:TEMP\aetheria-addon.log"` so addon logs are persisted.

### MediaFlow port
- Changed from `8061` to `8156` because `8061` is inside a Windows reserved port range.
- Updated `mediaflow-config.toml` and `_run_addon.ps1`; the currently running instance uses `8158` because `msedgewebview2` is holding `8156`.

### Dead-link filter (`src/utils/StreamResolver.ts`)
- Reserves the last 5 seconds of the stream-response window so filtering no longer gets skipped on a first-try cold cache.
- HubDrive/HubCloud/hubcdn links are checked with the real extractor (these sites return `200` for dead files).
- Non-hub links use fast `HEAD` with a `Range` fallback on `405`.
- Per-probe timeout is 3 s with a budget of `remainingMs - 500 ms`.
- Protected links (403/401) and network/timeouts are kept visible.
- Added/updated `src/utils/StreamResolver.deadlink.test.ts` (12 tests passing).
- Live test on a cold cache for `FROM S01E01` (`tt9813792:1:1`) dropped 3 dead `hubdrive.tips` links from 4KHDHub/HDHub4u on the first request.

### VidSrc (`src/source/VidSrc.ts` + `src/extractor/VidSrc.ts`)
- Source already pointed at `vsembed.ru` from a previous fix; the extractor now handles the current CloudStream player flow:
  - Parses the `var master_urls = "<url> or <fallback>"` block.
  - Selects the first URL and replaces `__TOKEN__` by calling `https://<host>/generate.php`.
  - Adds `meta.referer` (the player page URL) so Stremio sends the required Referer header.
- Updated `src/extractor/__snapshots__/VidSrc.test.ts.snap`; extractor tests pass (8/8).
- Live check for `tt0133093` returns a valid `zealotsofzenith.site` HLS master with a fresh token and responds 200.

### MkvKing (`src/source/MkvKing.ts`)
- Disabled in `src/source/index.ts`:
  - `e.mkvking.dad` no longer hosts the `streams.iqsmartgames.com` API (the site is now a generic Muvipro theme).
  - The API endpoint returns 403, which was causing expensive FlareSolverr attempts and no streams.
  - Removing it from the active source list prevents wasted requests until a working endpoint/domain is available.

### Anidap (`src/source/Anidap.ts`)
- Added an HLS playlist probe for providers whose source URL is not already classifiable:
  - Fetches the master playlist, picks the first variant, and inspects the first ~30 segment URLs.
  - Returns `false` if every segment is on a known bad/ad host (`ibyteimg.com`, `ad-site-i18n`, `vivibebe.*`, `kotocdn.*`).
  - Returns `true` if at least one segment looks like a real video segment.
  - Timeouts/4xx probe failures return `null` so the candidate is kept.
- Extended the instant host heuristic to block `vivibebe` and `kotocdn` master-host providers without needing a full probe.
- Result: Anidap no longer selects `megap.kotocdn.site` providers whose manifests are full of `p16-ad-sg.ibyteimg.com` image segments (the cause of the `0:00` stall) and instead selects playable providers such as `playeng.animeapps.top` or `vault-*.owocdn.top`.

## Verification

- `npx jest src/extractor/VidSrc.test.ts --runInBand` — 8 tests passed, snapshots updated.
- `npx tsc --noEmit` for changed files (`Anidap.ts`, `VidSrc.ts`, `source/index.ts`) — no errors.
- Clean build: `Remove-Item dist; npx tsc` succeeded.
- Addon restarted via `start-all.ps1`; `http://127.0.0.1:51546/manifest.json` responds.
- Live checks:
  - `VidSrc` (`tt0133093`) returns a tokenized HLS master that HEAD-checks 200.
  - `Anidap` (`tt0245429`) resolves to playable `playeng.animeapps.top` / `vault-*.owocdn.top` streams instead of `megap.kotocdn.site`.
  - No new `iqsmartgames.com` requests after disabling MkvKing.

## Remaining / follow-up
- Monitor long-tail Anidap titles; if a new provider starts serving image-obfuscated segments and isn't covered by the current host/probe list, add it.
- MkvKing: keep an eye on whether a new official domain/API endpoint appears; re-enable or rewrite when one works.
- Address unrelated pre-existing test failures (MovieBox/Vidara fixtures, `media-flow-proxy.test.ts`, etc.) separately if desired.
