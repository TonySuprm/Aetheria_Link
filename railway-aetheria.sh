#!/bin/sh
# Railway/Docker entrypoint for Aetheria Link.
# Mirrors start-all.ps1 at runtime: apply env defaults, clear stale caches,
# rebuild from source, then start the Node addon. Sidecars (FlareSolverr and
# MediaFlow Proxy) are started by supervisord alongside this process.

PROJECT_DIR="${PROJECT_DIR:-/app}"

export TMDB_ACCESS_TOKEN="${TMDB_ACCESS_TOKEN:-eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYzM0YTE5NDdjM2MyM2IzZmJiMjdmYzk3NTY5MWJjYyIsIm5iZiI6MTc4Mjg1NTMwOS4wMDg5OTk4LCJzdWIiOiI2YTQ0MzY4ZDg3ZTE0NzIwNjVlNzFjYTMiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.GT88mkp2fpG3BdD0NFlIvL9W-Jh75rCludxR4FadUC8}"
export PORT="${PORT:-51546}"
# Do NOT export an empty HOST here. The app treats an empty string as a real
# value and tries to construct a URL from it, which crashes startup. Leave
# HOST unset so the app resolves the hostname from each incoming request.
export STREAM_MAX_MS="${STREAM_MAX_MS:-35000}"
export STREAM_BACKGROUND_MAX_MS="${STREAM_BACKGROUND_MAX_MS:-120000}"
export FLARESOLVERR_ENDPOINT="${FLARESOLVERR_ENDPOINT:-http://localhost:8191/v1}"
export MEDIA_FLOW_PROXY_URL="${MEDIA_FLOW_PROXY_URL:-http://127.0.0.1:8889}"
export MEDIA_FLOW_PROXY_PASSWORD="${MEDIA_FLOW_PROXY_PASSWORD:-aetheria-link-secret}"
export CONFIG_PATH="${CONFIG_PATH:-/app/mediaflow-config.toml}"
export PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-/usr/bin/chromium}"
export PUPPETEER_SKIP_DOWNLOAD="true"
export CACHE_FILES_DELETE_ON_START="true"

cd "$PROJECT_DIR"

echo "[aetheria] runtime env:"
echo "  PORT=$PORT"
echo "  STREAM_MAX_MS=$STREAM_MAX_MS"
echo "  STREAM_BACKGROUND_MAX_MS=$STREAM_BACKGROUND_MAX_MS"
echo "  FLARESOLVERR_ENDPOINT=$FLARESOLVERR_ENDPOINT"
echo "  MEDIA_FLOW_PROXY_URL=$MEDIA_FLOW_PROXY_URL"
echo "  TMDB_ACCESS_TOKEN=${TMDB_ACCESS_TOKEN:+set}"

echo "[aetheria] clearing stale SQLite caches..."
rm -f /tmp/aetheria-link-*.sqlite* /tmp/wsmbg_crash.log 2>/dev/null || true

echo "[aetheria] rebuilding addon from source..."
npm run build
BUILD_STATUS=$?
if [ "$BUILD_STATUS" -ne 0 ]; then
  echo "[aetheria] WARNING: runtime build failed (exit $BUILD_STATUS). Using prebuilt dist/ from image."
fi

if [ -z "${TMDB_ACCESS_TOKEN}" ]; then
  echo "[aetheria] WARNING: TMDB_ACCESS_TOKEN is not set. Most sources will not resolve IDs."
fi

echo "[aetheria] starting addon on port $PORT..."
exec npm start
