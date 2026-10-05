"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEmbeddedMediaFlowProxy = exports.probePort = exports.parseLoopbackProxyTarget = exports.buildMediaFlowProxyStreamUrl = exports.buildMediaFlowProxyHlsUrl = exports.buildMediaFlowProxyExtractorStreamUrl = exports.buildMediaFlowProxyExtractorRedirectUrl = exports.isEmbeddedMediaFlowProxy = exports.supportsMediaFlowProxy = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_net_1 = require("node:net");
const node_path_1 = __importDefault(require("node:path"));
const env_1 = require("./env");
const supportsMediaFlowProxy = (ctx) => !!ctx.config['mediaFlowProxyUrl'];
exports.supportsMediaFlowProxy = supportsMediaFlowProxy;
const stripProtocol = (value) => value.replace(/^https?:\/\//i, '');
const configProtocol = (value) => value.toLowerCase().startsWith('https://') ? 'https:' : 'http:';
const LOOPBACK_PROXY_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);
/**
 * True when the configured MediaFlow Proxy is the embedded, co-running instance
 * (Railway/docker-compose/sidecar on loopback). Such a proxy has no address
 * reachable by Stremio players, so client-facing URLs must be exposed through
 * the add-on's own public host (relayed by MediaFlowProxyController).
 */
const isEmbeddedMediaFlowProxy = (value) => {
    if (!value)
        return false;
    const hostPart = stripProtocol(value).split('/')[0] ?? '';
    // Bracketed IPv6 ([::1]:8889) must be captured before any ':' split —
    // splitting the raw host on '[' or ':' mangles it into an empty string.
    const bracketed = hostPart.match(/^\[([^\]]+)\]/);
    const host = (bracketed ? bracketed[1] : hostPart.split(':')[0])?.trim().toLowerCase();
    return host ? LOOPBACK_PROXY_HOSTS.has(host) : false;
};
exports.isEmbeddedMediaFlowProxy = isEmbeddedMediaFlowProxy;
/**
 * Base URL for requests issued BY THE ADDON (server-side fetches such as
 * `/extractor/video` resolution): always the configured proxy (loopback when
 * co-running). Never the public host — the add-on must reach the proxy
 * directly to avoid a public round-trip.
 */
const serverBase = (ctx) => {
    const cfg = ctx.config.mediaFlowProxyUrl ?? '';
    return new URL(`${configProtocol(cfg)}//${stripProtocol(cfg)}`);
};
/**
 * Base URL for stream URLs HANDED TO THE PLAYER. For an external (public)
 * proxy configuration that is the proxy itself; for the embedded loopback
 * proxy it is the add-on's public host, because the add-on relays the
 * `/proxy/*` and `/extractor/*` paths to the co-running proxy.
 */
const publicBase = (ctx) => {
    const cfg = ctx.config.mediaFlowProxyUrl;
    if (cfg && !(0, exports.isEmbeddedMediaFlowProxy)(cfg))
        return serverBase(ctx);
    return ctx.hostUrl;
};
const addExtractorParams = (mediaFlowProxyUrl, host, url, ctx, headers) => {
    mediaFlowProxyUrl.searchParams.append('host', host);
    if (ctx.config.mediaFlowProxyPassword) {
        mediaFlowProxyUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
    }
    mediaFlowProxyUrl.searchParams.append('d', url.href);
    for (const headerKey in headers) {
        mediaFlowProxyUrl.searchParams.set('h_' + headerKey.toLowerCase(), headers[headerKey]);
    }
};
const buildMediaFlowProxyExtractorUrl = (ctx, host, url, headers, base) => {
    const mediaFlowProxyUrl = new URL('/extractor/video', base);
    addExtractorParams(mediaFlowProxyUrl, host, url, ctx, headers);
    return mediaFlowProxyUrl;
};
const buildMediaFlowProxyExtractorRedirectUrl = (ctx, host, url, headers = {}) => {
    const mediaFlowProxyUrl = buildMediaFlowProxyExtractorUrl(ctx, host, url, headers, publicBase(ctx));
    mediaFlowProxyUrl.searchParams.append('redirect_stream', 'true');
    return mediaFlowProxyUrl;
};
exports.buildMediaFlowProxyExtractorRedirectUrl = buildMediaFlowProxyExtractorRedirectUrl;
const buildMediaFlowProxyExtractorStreamUrl = async (ctx, fetcher, host, url, headers) => {
    const mediaFlowProxyUrl = buildMediaFlowProxyExtractorUrl(ctx, host, url, headers, serverBase(ctx));
    const extractResult = await fetcher.json(ctx, mediaFlowProxyUrl, { queueLimit: 4, queueTimeout: 10000, timeout: 20000 });
    const streamUrl = new URL(extractResult.mediaflow_proxy_url);
    // The proxy reports its own host; for the embedded proxy that is loopback,
    // which is unreachable by players. Re-base onto the public host.
    if ((0, exports.isEmbeddedMediaFlowProxy)(extractResult.mediaflow_proxy_url)) {
        streamUrl.protocol = publicBase(ctx).protocol;
        streamUrl.host = publicBase(ctx).host;
    }
    for (const queryParamsKey in extractResult.query_params) {
        streamUrl.searchParams.append(queryParamsKey, extractResult.query_params[queryParamsKey]);
    }
    for (const requestHeadersKey in extractResult.request_headers) {
        streamUrl.searchParams.append(`h_${requestHeadersKey}`, extractResult.request_headers[requestHeadersKey]);
    }
    streamUrl.searchParams.append('d', extractResult.destination_url);
    return streamUrl;
};
exports.buildMediaFlowProxyExtractorStreamUrl = buildMediaFlowProxyExtractorStreamUrl;
const buildMediaFlowProxyHlsUrl = (ctx, m3u8Url, headers = {}, proxySegments = false) => {
    const mediaFlowProxyUrl = new URL('/proxy/hls/manifest.m3u8', publicBase(ctx));
    if (ctx.config.mediaFlowProxyPassword) {
        mediaFlowProxyUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
    }
    mediaFlowProxyUrl.searchParams.append('d', m3u8Url.href);
    if (proxySegments)
        mediaFlowProxyUrl.searchParams.append('force_playlist_proxy', 'true');
    for (const headerKey in headers) {
        mediaFlowProxyUrl.searchParams.set('h_' + headerKey.toLowerCase(), headers[headerKey]);
    }
    return mediaFlowProxyUrl;
};
exports.buildMediaFlowProxyHlsUrl = buildMediaFlowProxyHlsUrl;
const buildMediaFlowProxyStreamUrl = (ctx, url, headers = {}) => {
    const mediaFlowProxyUrl = new URL('/proxy/stream', publicBase(ctx));
    if (ctx.config.mediaFlowProxyPassword) {
        mediaFlowProxyUrl.searchParams.append('api_password', ctx.config.mediaFlowProxyPassword);
    }
    mediaFlowProxyUrl.searchParams.append('d', url.href);
    for (const headerKey in headers) {
        mediaFlowProxyUrl.searchParams.set('h_' + headerKey.toLowerCase(), headers[headerKey]);
    }
    return mediaFlowProxyUrl;
};
exports.buildMediaFlowProxyStreamUrl = buildMediaFlowProxyStreamUrl;
// ── Embedded MediaFlow Proxy sidecar ──────────────────────────────────────
// In the bundled Railway image the proxy co-runs on loopback and
// railway-aetheria.sh (via supervisord) starts it before `npm start`. But a
// Procfile/service start-command override makes Railway run a bare
// `npm start` instead, skipping supervisord entirely — every /proxy/*
// playback then dies with ECONNREFUSED. As a safety net the add-on probes
// the configured loopback proxy at startup and spawns the bundled binary
// itself when nothing is listening (no-op when it is already running).
const MFP_DEFAULT_URL = 'http://127.0.0.1:8889';
const MFP_BINARY_CANDIDATES = ['/usr/local/bin/mediaflow-proxy-light', '/app/mediaflow-proxy-light'];
// [halcyon patch] musl static binaries cannot resolve DNS on Android (no
// /etc/resolv.conf; the loopback fallback hits nothing). This CONNECT +
// absolute-URI proxy runs inside the add-on (node resolves via the system)
// and MFP's reqwest tunnels every upstream fetch through it via PROXY_URL.
let sidecarProxyPort;
const ensureSidecarDnsProxy = async (logger) => {
    if (sidecarProxyPort)
        return sidecarProxyPort;
    const srv = (0, node_net_1.createServer)((client) => {
        client.once('data', (first) => {
            const head = first.toString('latin1');
            const connectMatch = head.match(/^CONNECT ([^:\s]+):(\d+)/);
            const getMatch = head.match(/^([A-Z]+) (https?:\/\/)([^:\/\s]+)(?::(\d+))?(\/\S*) (HTTP\/[\d.]+)\r\n/);
            if (connectMatch) {
                client.pause();
                const up = (0, node_net_1.createConnection)({ host: connectMatch[1], port: Number(connectMatch[2]) }, () => {
                    client.write('HTTP/1.1 200 Connection established\r\n\r\n', () => {
                        const idx = first.indexOf('\r\n\r\n');
                        const rest = idx >= 0 ? first.subarray(idx + 4) : null;
                        if (rest && rest.length)
                            up.write(rest);
                        client.on('data', (b) => up.write(b));
                        up.on('data', (b) => client.write(b));
                        client.resume();
                    });
                });
                up.on('error', () => { try {
                    client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                }
                catch { /* ignore */ } });
                client.on('error', () => { try {
                    up.destroy();
                }
                catch { /* ignore */ } });
            }
            else if (getMatch) {
                const up = (0, node_net_1.createConnection)({ host: getMatch[3], port: Number(getMatch[4] || (getMatch[2] === 'https:' ? 443 : 80)) }, () => {
                    const firstLineEnd = first.indexOf('\r\n');
                    up.write(getMatch[1] + ' ' + getMatch[5] + ' ' + getMatch[6] + '\r\n' + first.subarray(firstLineEnd + 2).toString('latin1'));
                    client.on('data', (b) => up.write(b));
                    up.on('data', (b) => client.write(b));
                });
                up.on('error', () => { try {
                    client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                }
                catch { /* ignore */ } });
                client.on('error', () => { try {
                    up.destroy();
                }
                catch { /* ignore */ } });
            }
            else {
                try {
                    client.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n');
                }
                catch { /* ignore */ }
            }
        });
    });
    await new Promise((ok, err) => {
        srv.once('error', err);
        srv.listen(0, '127.0.0.1', ok);
    });
    sidecarProxyPort = srv.address().port;
    logger.info('[mfp] dns-bypass proxy on 127.0.0.1:' + sidecarProxyPort);
    return sidecarProxyPort;
};
// [halcyon patch] on-device (Halcyon) deployments: the musl static android
// build ships via jniLibs exec-safe trick (like libffmpeg/libcloudflared) —
// resolved at runtime from the worker-injected native bin dir.
const MFP_NATIVE_CANDIDATE = () => {
    const nativeBinDir = process.env['AETH_NATIVE_BIN_DIR'];
    if (!nativeBinDir)
        return undefined;
    return node_path_1.default.join(nativeBinDir, 'libmediaflow.so');
};
const MFP_PROBE_TIMEOUT_MS = 750;
const MFP_READY_TIMEOUT_MS = 15_000;
const MFP_MAX_RESTARTS = 5;
const MFP_RESTART_DELAY_MS = 2_000;
const MFP_STABLE_UPTIME_MS = 60_000;
/**
 * Resolves the probe/spawn target for an embedded (loopback) proxy URL.
 * Returns null for external proxies and empty values — those are somebody
 * else's process to keep alive.
 */
const parseLoopbackProxyTarget = (value) => {
    const trimmed = value.trim();
    if (!trimmed || !(0, exports.isEmbeddedMediaFlowProxy)(trimmed))
        return null;
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const url = new URL(normalized);
        const host = url.hostname.replace(/^\[|\]$/g, '').replace(/^0\.0\.0\.0$/, '127.0.0.1');
        if (!host)
            return null;
        return { host, port: url.port ? parseInt(url.port, 10) : 8889 };
    }
    catch {
        return null;
    }
};
exports.parseLoopbackProxyTarget = parseLoopbackProxyTarget;
/** True when something already accepts TCP connections on host:port. */
const probePort = (host, port, timeoutMs = MFP_PROBE_TIMEOUT_MS) => new Promise((resolve) => {
    const socket = (0, node_net_1.createConnection)({ host, port });
    const settle = (result) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
});
exports.probePort = probePort;
let supervisedChild;
let supervisionShuttingDown = false;
let exitHookRegistered = false;
const pipeSidecarOutput = (logger, stream, level) => {
    if (!stream)
        return;
    let carry = '';
    stream.on('data', (chunk) => {
        carry += chunk.toString('utf8');
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed)
                logger[level](`[mfp] ${trimmed}`);
        }
    });
};
const spawnSupervisedProxy = (logger, binary, host, port, attempt, dnsProxyPort) => {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined)
            continue;
        // The binary's Python-compat layer maps bare PORT/HOST onto its bind
        // address (config.rs compat_pairs). Those hold the ADDON's values here
        // and would repoint the sidecar onto the addon's own port — EADDRINUSE
        // on Linux, wrong port everywhere else.
        if (key === 'PORT' || key === 'HOST')
            continue;
        env[key] = value;
    }
    // Pin the bind address to exactly the probed loopback target: the APP__*
    // form wins over both the config file and the compat env vars.
    env['APP__SERVER__HOST'] = host === 'localhost' ? '127.0.0.1' : host;
    // [halcyon patch] route upstream fetches through the dns-bypass proxy
    const proxyPort = dnsProxyPort;
    if (proxyPort) {
        const proxyUrl = 'http://127.0.0.1:' + proxyPort;
        env['PROXY_URL'] = proxyUrl;
        env['HTTP_PROXY'] = proxyUrl;
        env['HTTPS_PROXY'] = proxyUrl;
        // all_proxy=true activates proxy.proxy_url for ALL destinations in MFP's
        // ProxyRouter (otherwise the default proxy is ignored entirely)
        env['ALL_PROXY'] = 'true';
    }
    // [halcyon patch] auth parity: MFP must run with the SAME api_password the
    // relay sends, and with it set the _token_ encrypted-URI scheme activates
    if (!env['API_PASSWORD'])
        env['API_PASSWORD'] = (0, env_1.envGet)('MEDIA_FLOW_PROXY_PASSWORD') || 'aetheria-link-secret';
    env['APP__SERVER__PORT'] = String(port);
    if (!env['CONFIG_PATH'] && (0, node_fs_1.existsSync)('/app/mediaflow-config.toml'))
        env['CONFIG_PATH'] = '/app/mediaflow-config.toml';
    env['RUST_LOG'] = env['RUST_LOG'] ?? 'info';
    const child = (0, node_child_process_1.spawn)(binary, [], { stdio: ['ignore', 'pipe', 'pipe'], env });
    supervisedChild = child;
    const startedAt = Date.now();
    pipeSidecarOutput(logger, child.stdout, 'info');
    pipeSidecarOutput(logger, child.stderr, 'warn');
    logger.info(`[mfp] spawned ${binary} (pid ${child.pid ?? '?'}) for ${host}:${port}`);
    child.once('exit', (code, signal) => {
        if (supervisedChild === child)
            supervisedChild = undefined;
        if (supervisionShuttingDown)
            return;
        // A child that stayed up for a while gets a fresh restart budget; one
        // that keeps dying within seconds burns it.
        const nextAttempt = Date.now() - startedAt >= MFP_STABLE_UPTIME_MS ? 1 : attempt + 1;
        if (nextAttempt > MFP_MAX_RESTARTS) {
            logger.error(`[mfp] exited (code=${code ?? '?'} signal=${signal ?? '?'}) and the restart budget is exhausted — MediaFlow Proxy streams will fail until the container restarts.`);
            return;
        }
        logger.warn(`[mfp] exited (code=${code ?? '?'} signal=${signal ?? '?'}); restart ${nextAttempt}/${MFP_MAX_RESTARTS} in ${MFP_RESTART_DELAY_MS / 1000}s`);
        setTimeout(() => {
            if (!supervisionShuttingDown) {
                ensureSidecarDnsProxy(logger).then((dnsPort) => spawnSupervisedProxy(logger, binary, host, port, nextAttempt, dnsPort)).catch(() => { });
            }
        }, MFP_RESTART_DELAY_MS).unref();
    });
};
/**
 * Ensures the embedded loopback MediaFlow Proxy is running before the first
 * /proxy/* playback request arrives. Returns true once the port accepts
 * connections. Safe to call in any deployment shape: external proxies,
 * missing binaries and already-running instances are all detected and
 * skipped.
 */
const ensureEmbeddedMediaFlowProxy = async (logger) => {
    const target = (0, exports.parseLoopbackProxyTarget)((0, env_1.envGet)('MEDIA_FLOW_PROXY_URL') ?? MFP_DEFAULT_URL);
    if (!target)
        return false; // external proxy or none configured: not ours to start
    const { host, port } = target;
    if (await (0, exports.probePort)(host, port)) {
        logger.info(`MediaFlow Proxy already listening on ${host}:${port}.`);
        return true;
    }
    const binary = (0, env_1.envGet)('MEDIA_FLOW_PROXY_BIN')
        ?? (MFP_NATIVE_CANDIDATE() && (0, node_fs_1.existsSync)(MFP_NATIVE_CANDIDATE()) ? MFP_NATIVE_CANDIDATE() : undefined)
        ?? MFP_BINARY_CANDIDATES.find(candidate => (0, node_fs_1.existsSync)(candidate));
    if (!binary) {
        logger.warn(`MediaFlow Proxy is not listening on ${host}:${port} and no bundled binary was found — MediaFlow Proxy streams (dailymotion, ok.ru, rumble, ...) will fail with 502. Deploy via the Dockerfile (supervisord) or start the proxy with start-all.ps1.`);
        return false;
    }
    if (!exitHookRegistered) {
        exitHookRegistered = true;
        process.on('exit', () => {
            supervisionShuttingDown = true;
            supervisedChild?.kill();
        });
    }
    logger.info(`MediaFlow Proxy not reachable on ${host}:${port} — starting bundled binary ${binary}.`);
    spawnSupervisedProxy(logger, binary, host, port, 1, await ensureSidecarDnsProxy(logger));
    const deadline = Date.now() + MFP_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250));
        if (await (0, exports.probePort)(host, port)) {
            logger.info(`MediaFlow Proxy is ready on ${host}:${port}.`);
            return true;
        }
    }
    logger.warn(`MediaFlow Proxy did not accept connections on ${host}:${port} within ${MFP_READY_TIMEOUT_MS / 1000}s — see the [mfp] log lines above.`);
    return false;
};
exports.ensureEmbeddedMediaFlowProxy = ensureEmbeddedMediaFlowProxy;
