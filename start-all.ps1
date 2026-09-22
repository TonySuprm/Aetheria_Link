#!/usr/bin/env powershell
# Start MediaFlow Proxy, FlareSolverr, and Aetheria Link Addon

# Always resolve to the directory this script lives in so it runs the project
# it ships with, regardless of the current working directory.
$projectDir = $PSScriptRoot
$mediaflowDir = "$projectDir\mediaflow-proxy"

$flaresolverrContainerName = 'aetheria-flaresolverr'

# Stop processes by specific PID rather than by executable name, so unrelated
# Node/Docker services left by the user are not closed.
function Get-ProcessUsingPort {
    param([int]$Port)
    try {
        return (Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
    } catch {
        return $null
    }
}

function Test-PortAvailable {
    param([int]$Port)
    try {
        # Bind to 0.0.0.0 so we detect listeners on any interface, not just loopback.
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Stop-ServiceOnPort {
    param([int]$Port, [string]$ServiceName, [string]$ProcessNamePattern)
    $id = Get-ProcessUsingPort -Port $Port
    if (-not $id) { return }
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    $name = $proc.ProcessName
    if ($ProcessNamePattern -and $name -notmatch $ProcessNamePattern) {
        Write-Host "  port $Port held by unrelated process $name (PID $id); $ServiceName will use next free port." -ForegroundColor Yellow
        return
    }
    try {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        Write-Host "  freed $ServiceName port $Port (stopped $name PID $id)" -ForegroundColor Gray
        Start-Sleep -Seconds 1
    } catch {}
}

# Default addon port. We scan upward from here so another app on 51546 isn't killed.
$addonPreferredPort = 51546
if ($env:AETHERIA_PORT) {
    try { $addonPreferredPort = [int]$env:AETHERIA_PORT } catch {}
}

$addonPort = $null
for ($candidate = $addonPreferredPort; $candidate -lt $addonPreferredPort + 100; $candidate++) {
    if ((Get-ProcessUsingPort -Port $candidate)) {
        Write-Host "  port $candidate in use by another process, trying next..." -ForegroundColor Gray
        continue
    }
    if (Test-PortAvailable -Port $candidate) {
        $addonPort = $candidate
        if ($candidate -ne $addonPreferredPort) {
            Write-Host "Aetheria Link will use next free port $addonPort" -ForegroundColor Cyan
        }
        break
    }
}

if (-not $addonPort) {
    Write-Host "Could not find an available Aetheria Link port between $addonPreferredPort and ($addonPreferredPort + 99)." -ForegroundColor Red
    exit 1
}

Write-Host "Aetheria Link will use port $addonPort" -ForegroundColor Cyan

# Clear the aetheria-link SQLite caches (source/extractor/lazy) so stale URLs are never served
# from the secondary cache after a restart (e.g. old /relay 111477 links). If another addon is
# still running, some SQLite files may remain open; those are skipped and the running process
# retains its cache (the addon's own CACHE_FILES_DELETE_ON_START cannot delete its own open
# files on Windows because of EBUSY).
$cacheDir = $env:CACHE_DIR; if (-not $cacheDir) { $cacheDir = $env:TEMP }
Get-ChildItem -Path $cacheDir -Filter "aetheria-link*.sqlite*" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  clearing cache: $($_.Name)" -ForegroundColor Gray
    Remove-Item -Force -ErrorAction SilentlyContinue $_.FullName
}

# TMDB API Token - Get from https://www.themoviedb.org/settings/api (Read Access Token)
# Without this, sources won't be able to resolve IMDB/TMDB IDs
$env:TMDB_ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYzM0YTE5NDdjM2MyM2IzZmJiMjdmYzk3NTY5MWJjYyIsIm5iZiI6MTc4Mjg1NTMwOS4wMDg5OTk4LCJzdWIiOiI2YTQ0MzY4ZDg3ZTE0NzIwNjVlNzFjYTMiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.GT88mkp2fpG3BdD0NFlIvL9W-Jh75rCludxR4FadUC8"

function Test-DockerAvailable {
    param([int]$TimeoutSec = 10, [int]$MaxAttempts = 3)
    $outFile = "$env:TEMP\docker-version-out.txt"
    $errFile = "$env:TEMP\docker-version-err.txt"
    for ($attempt = 0; $attempt -lt $MaxAttempts; $attempt++) {
        Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
        try {
            $proc = Start-Process -FilePath "docker" -ArgumentList "version","--format","{{.Server.Version}}" -PassThru -WindowStyle Hidden -RedirectStandardOutput $outFile -RedirectStandardError $errFile
            if ($proc.WaitForExit($TimeoutSec * 1000)) {
                $exit = $proc.ExitCode
                $output = if (Test-Path $outFile) { (Get-Content $outFile -Raw).Trim() } else { '' }
                # Docker sometimes returns an empty exit code but prints the server version.
                # Treat any non-empty version response as success.
                if ($output -and $output -match '^\d') {
                    return $true
                }
                if ($exit -eq 0) {
                    return $true
                }
            } else {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        } catch {
            # docker command not found or other error
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

# Start FlareSolverr (for Cloudflare-protected sites: FreeMovies, MkvDrama, AllManga)
Write-Host "Starting FlareSolverr..." -ForegroundColor Green

if (-not (Test-DockerAvailable -TimeoutSec 5)) {
    Write-Host "  Docker is not available or not responding. Skipping FlareSolverr." -ForegroundColor Yellow
    Write-Host "  Cloudflare-protected sources (FreeMovies, MkvDrama, AllManga) may not work." -ForegroundColor Yellow
} else {

# Stop/remove any existing container so docker run doesn't fail with a name conflict.
# Errors here are expected when no container exists yet; still surface them for debugging.
$existing = docker ps -aq -f name="^/$flaresolverrContainerName$" 2>&1
if ($existing) {
    Write-Host "  stopping existing $flaresolverrContainerName container" -ForegroundColor Gray
    docker stop $flaresolverrContainerName 2>&1 | Out-Null
    docker rm $flaresolverrContainerName 2>&1 | Out-Null
}

# If a previous FlareSolverr process (not the Docker container above) is still holding 8191,
# stop only that specific process. We deliberately avoid killing Docker's own proxy processes.
Stop-ServiceOnPort -Port 8191 -ServiceName 'FlareSolverr' -ProcessNamePattern 'python|flaresolverr|flaresolver'

# Pull latest so an old cached 'latest' tag doesn't keep serving a broken build. Surface errors.
Write-Host "  pulling FlareSolverr image..." -ForegroundColor Gray
$pullOutput = docker pull ghcr.io/flaresolverr/flaresolverr:latest 2>&1
$pullOk = $?
if (-not $pullOk) {
    Write-Host "FlareSolverr: FAILED to pull image. Check Docker / internet." -ForegroundColor Red
    Write-Host "  $pullOutput" -ForegroundColor Red
    Write-Host "  Cloudflare-protected sources (FreeMovies, MkvDrama, AllManga) may not work." -ForegroundColor Yellow
} else {
    $containerId = docker run -d --name $flaresolverrContainerName -p 8191:8191 -e LOG_LEVEL=info -e LOG_HTML=0 ghcr.io/flaresolverr/flaresolverr:latest 2>&1
    $runOk = $?
    if (-not $runOk -or [string]::IsNullOrWhiteSpace($containerId)) {
        Write-Host "FlareSolverr: FAILED to start container." -ForegroundColor Red
        Write-Host "  $containerId" -ForegroundColor Red
        Write-Host "  Cloudflare-protected sources (FreeMovies, MkvDrama, AllManga) may not work." -ForegroundColor Yellow
    } else {
        Write-Host "  container started: $containerId" -ForegroundColor Gray

        # Verify FlareSolverr: a real challenge request is more reliable than sessions.list.
        $flaresolverrReady = $false
        for ($i = 0; $i -lt 30; $i++) {
            try {
                $fsHealth = Invoke-RestMethod -Uri "http://127.0.0.1:8191/v1" -Method Post -Body '{"cmd":"sessions.list"}' -ContentType "application/json" -TimeoutSec 5
                if ($fsHealth.status -eq 'ok') {
                    $flaresolverrReady = $true
                    break
                }
            } catch {
                # not ready yet
            }
            Start-Sleep 2
        }

        if ($flaresolverrReady) {
            Write-Host "FlareSolverr: OK (port 8191)" -ForegroundColor Green
            $env:FLARESOLVERR_ENDPOINT = "http://127.0.0.1:8191/v1"
        } else {
            Write-Host "FlareSolverr: FAILED health check - printing last 20 log lines:" -ForegroundColor Yellow
            docker logs --tail 20 $flaresolverrContainerName 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
            Write-Host "  Cloudflare-protected sources (FreeMovies, MkvDrama, AllManga) may not work." -ForegroundColor Yellow
        }
    }
}
}

# Determine the MediaFlow Proxy port from mediaflow-config.toml, falling back
# dynamically if Windows has reserved it or another process is already using it.
$configTomlPath = "$projectDir\mediaflow-config.toml"
$preferredPort = 7000
if (Test-Path $configTomlPath) {
    $portMatch = Get-Content $configTomlPath | Select-String '^\s*port\s*=\s*(\d+)'
    if ($portMatch) {
        $preferredPort = [int]$portMatch.Matches[0].Groups[1].Value
    }
}

# If a previous MediaFlow Proxy process owns the configured port, stop only that process.
# Unrelated processes are left alone; the loop below will fall back to the next free port.
Stop-ServiceOnPort -Port $preferredPort -ServiceName 'MediaFlow Proxy' -ProcessNamePattern 'mediaflow-proxy'

$mediaflowPort = $null
$maxAttempts = 100
$envForcePort = $env:MEDIAFLOW_PROXY_PORT

if ($envForcePort) {
    try {
        $forcedPort = [int]$envForcePort
        if (Test-PortAvailable -Port $forcedPort) {
            $mediaflowPort = $forcedPort
            Write-Host "MediaFlow Proxy will use forced port $mediaflowPort from `$env:MEDIAFLOW_PROXY_PORT" -ForegroundColor Cyan
        } else {
            Write-Host "Forced port $forcedPort from `$env:MEDIAFLOW_PROXY_PORT is unavailable; scanning for next free port..." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Invalid `$env:MEDIAFLOW_PROXY_PORT value '$envForcePort'; scanning for free port..." -ForegroundColor Yellow
    }
}

if (-not $mediaflowPort) {
    for ($candidate = $preferredPort; $candidate -lt $preferredPort + $maxAttempts; $candidate++) {
        if (Test-PortAvailable -Port $candidate) {
            $mediaflowPort = $candidate
            if ($candidate -ne $preferredPort) {
                Write-Host "Port $preferredPort is unavailable; MediaFlow Proxy will use next free port $mediaflowPort" -ForegroundColor Cyan
            }
            break
        } else {
            Write-Host "  port $candidate unavailable, trying next..." -ForegroundColor Gray
        }
    }
}

if (-not $mediaflowPort) {
    Write-Host "Could not find an available MediaFlow Proxy port between $preferredPort and ($preferredPort + $maxAttempts - 1)." -ForegroundColor Red
    exit 1
}

if ($mediaflowPort -eq $preferredPort) {
    Write-Host "MediaFlow Proxy will use port $mediaflowPort" -ForegroundColor Cyan
}

# Start MediaFlow Proxy
Write-Host "Starting MediaFlow Proxy..." -ForegroundColor Green
$env:CONFIG_PATH = $configTomlPath
$env:APP__SERVER__HOST = "0.0.0.0"
$env:APP__SERVER__PORT = "$mediaflowPort"
$mediaflowProcess = Start-Process -FilePath "$mediaflowDir\mediaflow-proxy.exe" -WorkingDirectory $mediaflowDir -WindowStyle Hidden -PassThru
Start-Sleep 3

# Verify MediaFlow Proxy
$mediaflowHealthUrl = "http://127.0.0.1:$mediaflowPort/health"
try {
    $health = Invoke-RestMethod -Uri $mediaflowHealthUrl -Method Get
    Write-Host "MediaFlow Proxy: OK (port $mediaflowPort)" -ForegroundColor Green
}
catch {
    Write-Host "MediaFlow Proxy: FAILED (no response on $mediaflowHealthUrl)" -ForegroundColor Red
    exit 1
}

# Start Aetheria Link
Write-Host "Starting Aetheria Link..." -ForegroundColor Green
$env:MEDIA_FLOW_PROXY_URL = "http://127.0.0.1:$mediaflowPort"
$env:MEDIA_FLOW_PROXY_PASSWORD = "aetheria-link-secret"
$env:PORT = "$addonPort"
$env:PUPPETEER_EXECUTABLE_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
# Allow Cloudflare-protected sources (e.g. FreeMovies) more time to finish FlareSolverr challenges
# in the background after the 18s stream response is sent. They warm the cookie cache so the next
# Stremio request returns the source results instead of 0 streams.
$env:STREAM_BACKGROUND_MAX_MS = "120000"
# Absinth Streamer Cursor waits up to 35 s per stream request, while Aetheria's default deadline is
# 18 s. For items where the useful sources take longer than 18 s, the first request returns an
# incomplete/empty list and the user sees no links. Raise the main response deadline to match
# Absinth's timeout so results have time to resolve on the first call.
$env:STREAM_MAX_MS = "35000"
# Persist addon logs to disk so we can inspect them after requests (e.g. dead-link filter output).
$env:WSMBG_LOG_FILE = "$env:TEMP\aetheria-addon.log"
# Kayoanime Private Drive access: a logged-in throwaway Google account's cookie string
# (SID=...; HSID=...; __Secure-1PSID=...; ...). Enables private Google-Group-gated folders/files.
# Leave commented to resolve public resources only. Treat as a full-account-login secret.
# $env:GDRIVE_COOKIE = ""

# Build the addon (compile TypeScript) so dist/ reflects the latest source edits before launch.
# Without this, node dist/index.js would run whatever was last built - silently ignoring any code
# changes (e.g. new sources, extractor fixes, the /relay endpoint).
Write-Host "Building addon (compiling TypeScript src -> dist)..." -ForegroundColor Green
if (Test-Path "$projectDir\dist") {
    Remove-Item -Recurse -Force "$projectDir\dist"
}
Push-Location $projectDir
try {
    $tscPath = Resolve-Path ".\node_modules\.bin\tsc.cmd"
    & $tscPath 2>&1 | Out-Host
    $buildExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}
if ($buildExitCode -ne 0) {
    Write-Host "Build FAILED (tsc exit $buildExitCode). Aborting so you don't run a stale/broken build." -ForegroundColor Red
    exit 1
}
Write-Host "Build: OK (dist/ updated with latest edits)" -ForegroundColor Green

# Run in a separate window so the addon logs are visible and do not fight with this script for the
# same console buffer (which can make output appear to freeze or show only partial results).
$addonProcess = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -WorkingDirectory $projectDir -PassThru

# Verify Aetheria Link (prewarm can take ~60s before the server listens, so poll)
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep 1
    try {
        $manifest = Invoke-RestMethod -Uri "http://127.0.0.1:$addonPort/manifest.json" -Method Get
        $ready = $true
        break
    } catch {
        Write-Host "  waiting for addon to finish pre-warming... ($i s)" -ForegroundColor Gray
    }
}
if ($ready) {
    Write-Host "Aetheria Link: OK (port $addonPort)" -ForegroundColor Green
} else {
    Write-Host "Aetheria Link: FAILED (no manifest after 90s - check the addon window for errors)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "All services started successfully!" -ForegroundColor Cyan
Write-Host "Manifest: http://127.0.0.1:$addonPort/manifest.json"
Write-Host "Configure: http://127.0.0.1:$addonPort/configure"
Write-Host "MediaFlow UI: http://127.0.0.1:$mediaflowPort"
Write-Host "FlareSolverr: http://127.0.0.1:8191/v1"
Write-Host ""
Write-Host "Add to Stremio: http://127.0.0.1:$addonPort/manifest.json" -ForegroundColor Yellow
Write-Host "(MediaFlow proxy + FlareSolverr auto-configured via server env vars)" -ForegroundColor Gray
Write-Host ""
Write-Host "For Animexin (Chinese donghua):" -ForegroundColor Cyan
Write-Host "  1. Open http://127.0.0.1:$addonPort/configure" -ForegroundColor Gray
Write-Host "  2. Enable 'Japanese [JP] (Animexin)' and 'Multi [ALL]'" -ForegroundColor Gray
Write-Host "  3. Enable 'Include external URLs in results' for animexin streams" -ForegroundColor Gray
Write-Host ""
Write-Host "For MkvDrama/AllManga (Korean drama/Anime):" -ForegroundColor Cyan
Write-Host "  - Requires FlareSolverr (auto-started above)" -ForegroundColor Gray
Write-Host "  - Enable 'Korean [KR] (MkvDrama)' and/or 'Japanese [JP] (AllManga)' in configure" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop all services"

# Keep script running
try {
    while ($true) { Start-Sleep 10 }
}
finally {
    Write-Host "Stopping services..." -ForegroundColor Yellow
    if ($mediaflowProcess -and (Get-Process -Id $mediaflowProcess.Id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $mediaflowProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($addonProcess -and (Get-Process -Id $addonProcess.Id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $addonProcess.Id -Force -ErrorAction SilentlyContinue
    }
    docker stop $flaresolverrContainerName 2>$null
    docker rm $flaresolverrContainerName 2>$null
}