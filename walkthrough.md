# Walkthrough: Fixing DonghuaStream & LuciferDonghua Playback Issues

I've investigated and fixed the playback issues affecting Dailymotion and Rumble links on `DonghuaStream` and `LuciferDonghua`.

## 1. Dailymotion Fix (Stuck at 0:00)
**The Issue:**
Dailymotion links were getting stuck at `0:00` because the addon was extracting and forwarding `geo.dailymotion.com/player/...` URLs to the frontend. These are HTML webplayer pages, not raw media streams, which meant `mpv` and `hls.js` couldn't demux them.

**The Fix:**
- I updated the extraction blocks in both the Stremio extractor (`src/extractor/Dailymotion.ts`) and the Native Endpoint (`src/index.ts`).
- Now, when a `geo.dailymotion.com` iframe is encountered, the system extracts the Video ID and reconstructs the canonical `www.dailymotion.com/video/[ID]` link.
- `mpv` (the underlying player for Aetheria Prime) has a built-in integration with `yt-dlp` (`ytdl=yes`). By passing the canonical URL, `yt-dlp` handles the heavy lifting, effortlessly bypassing Dailymotion's Cloudflare checks and fetching the stream natively without getting stuck.

## 2. Rumble Fix (Failed to Play)
**The Issue:**
The addon *was* successfully finding and extracting Rumble's `.m3u8` playlist files. However, Rumble's manifests are somewhat non-standard—they point directly to standalone `.mp4` segments rather than standard `.ts` segments, which confused the player and caused playback to fail.

**The Fix:**
- Inside the Rumble embed HTML, Rumble actually exposes the direct CDN links for their `MP4` streams.
- I modified the Regex extraction logic in `src/index.ts` and `src/extractor/Rumble.ts` to **prioritize the `.mp4` links** over the `.m3u8` playlists.
- The `.mp4` links (e.g. `hugh.cdn.rumble.cloud/video/...`) are unauthenticated and play universally across all players, guaranteeing instant startup.

## Testing Verification
Both fixes were explicitly tested against **Gu An - Episode 7**:
- **DonghuaStream**: Extracted Dailymotion canonical links and Rumble MP4 files properly.
- **LuciferDonghua**: Scraped the `/v/N/` subpages, bypassing iframe obfuscation, and retrieved playable Rumble/Dailymotion streams successfully.

The addon has been re-built with `npm run build` and is ready for use.
