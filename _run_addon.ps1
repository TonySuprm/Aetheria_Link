$env:TMDB_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiYzM0YTE5NDdjM2MyM2IzZmJiMjdmYzk3NTY5MWJjYyIsIm5iZiI6MTc4Mjg1NTMwOS4wMDg5OTk4LCJzdWIiOiI2YTQ0MzY4ZDg3ZTE0NzIwNjVlNzFjYTMiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.GT88mkp2fpG3BdD0NFlIvL9W-Jh75rCludxR4FadUC8'
$env:FLARESOLVERR_ENDPOINT = 'http://127.0.0.1:8191/v1'
$env:MEDIA_FLOW_PROXY_URL = 'http://127.0.0.1:8156'
$env:MEDIA_FLOW_PROXY_PASSWORD = 'aetheria-link-secret'
$env:PORT = '51546'
$env:PUPPETEER_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
# Kayoanime Private Drive access: a logged-in throwaway Google account's cookie string
# (SID=...; HSID=...; __Secure-1PSID=...; ...). Enables private Google-Group-gated folders/files.
# Leave commented to resolve public resources only. Treat as a full-account-login secret.
# $env:GDRIVE_COOKIE = ''
# Write logs straight to disk (unbuffered). Piping stdout through Tee-Object block-buffers it,
# so logs appear to freeze partway through a request. The Console transport still prints to the
# terminal live (it's a TTY, so it's line-buffered); this file always holds the complete sequence.
$env:WSMBG_LOG_FILE = 'E:\New Coding Projects\Aetheia link\addon_live.log'
node dist/index.js
