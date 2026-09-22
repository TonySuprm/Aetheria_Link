# Railway / single-container Docker image for Aetheria Link.
# Bundles FlareSolverr, MediaFlow Proxy Light, and the Node addon so the
# service starts with "everything" using supervisord.

# ---------------------------------------------------------------------------
# Stage 1: Pull the pre-built MediaFlow Proxy binary image.
# This avoids compiling the heavy Rust/BoringSSL stack on every deploy.
# Image built from: ./mediaflow-proxy/Dockerfile
# ---------------------------------------------------------------------------
FROM tonysupr/mediaflow-proxy-light:latest AS mediaflow

# ---------------------------------------------------------------------------
# Stage 2: Final image based on the official FlareSolverr image.
# FlareSolverr already ships Python, Chromium, xvfb, and its source under /app.
# ---------------------------------------------------------------------------
FROM ghcr.io/flaresolverr/flaresolverr:latest

USER root
WORKDIR /app

# Install Node.js 22, npm, supervisor, plus build tools for native npm modules.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    python3 \
    make \
    g++ \
    supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy the MediaFlow Proxy binary and project runtime config.
COPY --from=mediaflow /app/mediaflow-proxy-light /usr/local/bin/mediaflow-proxy-light
RUN chmod +x /usr/local/bin/mediaflow-proxy-light
COPY mediaflow-config.toml /app/mediaflow-config.toml

# Copy and install the Node addon.
# Skip Puppeteer's bundled Chrome download; the FlareSolverr image already
# provides Chromium at /usr/bin/chromium (see PUPPETEER_EXECUTABLE_PATH below).
COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci

COPY . .
RUN npm run build

# Copy the supervisord config and the wrapper that polls sidecars before start.
COPY railway-supervisord.conf /etc/supervisor/conf.d/aetheria.conf
COPY railway-aetheria.sh /app/railway-aetheria.sh
RUN chmod +x /app/railway-aetheria.sh

# Default environment. Railway can override $PORT and other variables.
# HOST is intentionally NOT defaulted so Express resolves the public hostname
# from the incoming request headers (needed for Railway's reverse proxy).
ENV NODE_ENV=production \
    PORT=51546 \
    TMDB_ACCESS_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYzM0YTE5NDdjM2MyM2IzZmJiMjdmYzk3NTY5MWJjYyIsIm5iZiI6MTc4Mjg1NTMwOS4wMDg5OTk4LCJzdWIiOiI2YTQ0MzY4ZDg3ZTE0NzIwNjVlNzFjYTMiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.GT88mkp2fpG3BdD0NFlIvL9W-Jh75rCludxR4FadUC8 \
    FLARESOLVERR_ENDPOINT=http://localhost:8191/v1 \
    MEDIA_FLOW_PROXY_URL=http://localhost:8889 \
    MEDIA_FLOW_PROXY_PASSWORD=aetheria-link-secret \
    CONFIG_PATH=/app/mediaflow-config.toml \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    STREAM_MAX_MS=35000 \
    STREAM_BACKGROUND_MAX_MS=120000 \
    CACHE_FILES_DELETE_ON_START=true

EXPOSE 51546 8889 8191

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/aetheria.conf"]
