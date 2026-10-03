"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.landingTemplate = landingTemplate;
function landingTemplate(manifest, sources) {
    const logo = manifest.logo || '/public/aetheria.png';
    const shortDesc = 'High-velocity streaming endpoint resolution subsystem. Seamless network linkage to remote media arrays.';
    const MISC_KEYS = ['showErrors', 'includeExternalUrls', 'mediaFlowProxyUrl', 'mediaFlowProxyPassword', 'alldebridApiKey', 'realdebridApiKey'];
    const languageConfigs = manifest.config.filter(c => !c.key.startsWith('excludeResolution_')
        && !c.key.startsWith('disableExtractor_')
        && !c.key.startsWith('disableSource_')
        && !MISC_KEYS.includes(c.key));
    const resolutionConfigs = manifest.config.filter(c => c.key.startsWith('excludeResolution_'));
    const extractorConfigs = manifest.config.filter(c => c.key.startsWith('disableExtractor_'));
    const allSourceConfigs = manifest.config.filter(c => c.key.startsWith('disableSource_'));
    const optionConfigs = manifest.config.filter(c => ['showErrors', 'includeExternalUrls'].includes(c.key));
    const proxyConfigs = manifest.config.filter(c => ['mediaFlowProxyUrl', 'mediaFlowProxyPassword'].includes(c.key));
    const debridKeyConfigs = manifest.config.filter(c => ['alldebridApiKey', 'realdebridApiKey'].includes(c.key));
    // Build a category map from the live sources array so we can group toggles.
    const sourceCategoryMap = new Map();
    sources.forEach(s => sourceCategoryMap.set(s.id, s.category));
    const sourceIdFromKey = (key) => key.replace('disableSource_', '');
    const debridSourceConfigs = allSourceConfigs.filter(c => sourceCategoryMap.get(sourceIdFromKey(c.key)) === 'debrid');
    const hollywoodSourceConfigs = allSourceConfigs.filter(c => sourceCategoryMap.get(sourceIdFromKey(c.key)) === 'hollywood');
    const asiandramaSourceConfigs = allSourceConfigs.filter(c => sourceCategoryMap.get(sourceIdFromKey(c.key)) === 'asiandrama');
    const animeSourceConfigs = allSourceConfigs.filter(c => sourceCategoryMap.get(sourceIdFromKey(c.key)) === 'anime');
    const donghuaSourceConfigs = allSourceConfigs.filter(c => sourceCategoryMap.get(sourceIdFromKey(c.key)) === 'donghua');
    const langChips = languageConfigs.map((c) => {
        const checked = c.default === 'checked' ? ' checked' : '';
        const shortTitle = (c.title ?? '').replace(/\s*\(.*\)$/, '').trim();
        const search = shortTitle.toLowerCase().replace(/[^\w ]/g, '');
        return `<label class="hud-chip lang-chip" data-s="${search}"><input type="checkbox" name="${c.key}"${checked}><span class="hud-chip-inner">${shortTitle}</span></label>`;
    }).join('');
    const buildSrcChips = (configs) => configs.map((c) => {
        const isOff = c.default === 'checked';
        const label = (c.title ?? '').replace('Disable source ', '');
        return `<div class="hud-toggle src-toggle${isOff ? ' sys-offline' : ''}" data-key="${c.key}"><div class="status-indicator"></div><span class="label-text">${label}</span></div>`;
    }).join('');
    const debridSrcChips = buildSrcChips(debridSourceConfigs);
    const hollywoodSrcChips = buildSrcChips(hollywoodSourceConfigs);
    const asiandramaSrcChips = buildSrcChips(asiandramaSourceConfigs);
    const animeSrcChips = buildSrcChips(animeSourceConfigs);
    const donghuaSrcChips = buildSrcChips(donghuaSourceConfigs);
    const extChips = extractorConfigs.map((c) => {
        const isOff = c.default === 'checked';
        const label = (c.title ?? '').replace('Disable extractor ', '');
        return `<div class="hud-toggle ext-toggle${isOff ? ' sys-offline' : ''}" data-key="${c.key}"><div class="status-indicator"></div><span class="label-text">${label}</span></div>`;
    }).join('');
    const resChips = resolutionConfigs.map((c) => {
        const isOff = c.default === 'checked';
        const label = (c.title ?? '').replace('Exclude resolution ', '');
        return `<div class="hud-toggle res-toggle${isOff ? ' sys-offline' : ''}" data-key="${c.key}"><div class="status-indicator"></div><span class="label-text">${label}</span></div>`;
    }).join('');
    const proxyFields = proxyConfigs.map((c) => {
        const val = c.default ? ` value="${c.default}"` : '';
        const type = c.type === 'password' ? 'password' : 'text';
        const ph = type === 'password' ? '' : 'tcp://secure-gateway...';
        return `
      <div class="hud-field">
        <label class="hud-label">[ ${(c.title ?? '').toUpperCase()} ]</label>
        <input type="${type}" name="${c.key}" class="hud-input"${val} placeholder="${ph}" autocomplete="off">
      </div>`;
    }).join('');
    const debridFields = debridKeyConfigs.map((c) => {
        const val = c.default ? ` value="${c.default}"` : '';
        const type = c.type === 'password' ? 'password' : 'text';
        return `
      <div class="hud-field">
        <div style="display:flex;align-items:flex-end;gap:0.6rem;">
          <div style="flex:1;">
            <label class="hud-label">[ ${(c.title ?? '').toUpperCase()} ]</label>
            <input type="${type}" name="${c.key}" class="hud-input"${val} placeholder="" autocomplete="off">
          </div>
          <button type="button" class="btn-save" data-save-key="${c.key}">💾 Save</button>
        </div>
      </div>`;
    }).join('');
    const optFields = optionConfigs.map((c) => {
        const checked = c.default === 'checked' ? ' checked' : '';
        return `<label class="hud-checkbox"><input type="checkbox" name="${c.key}"${checked}><span class="hud-check-box"></span><span class="hud-check-label">${c.title ?? ''}</span></label>`;
    }).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AethLink // Addon Configuration</title>
<link rel="icon" href="${logo}">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Share+Tech+Mono&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg-core: #031210;
  --bg-panel: rgba(8, 28, 24, 0.62);
  --neon-cyan: #01CDFE;
  --neon-magenta: #FF71CE;
  --neon-purple: #B967FF;
  --neon-green: #00FF66;
  --neon-amber: #FFBF00;
  --neon-red: #FF3366;
  --text-main: #E2F0EC;
  --text-muted: #6B9A8E;
  --grid-line: rgba(0, 200, 160, 0.04);
  --border-cyan: rgba(1, 205, 254, 0.3);
  --border-magenta: rgba(255, 113, 206, 0.3);
  --border-amber: rgba(255, 191, 0, 0.3);
}

#hexbg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -2;
  pointer-events: none;
}

html {
  min-height: 100%;
  background: var(--bg-core);
  font-family: 'Inter', sans-serif;
  color: var(--text-main);
}

body {
  display: flex;
  justify-content: center;
  padding: 3rem 1.5rem 8rem;
  min-height: 100dvh;
  position: relative;
  overflow-x: hidden;
}

/* Glowing volumetric background elements */
.flare {
  position: fixed;
  border-radius: 50%;
  filter: blur(140px);
  z-index: -1;
  pointer-events: none;
  opacity: 0.15;
}
.flare-1 { top: 10%; right: 5%; width: 40vw; height: 40vw; background: var(--neon-cyan); }
.flare-2 { bottom: 10%; left: 0%; width: 50vw; height: 50vw; background: #00B894; }

.hud-container {
  width: 100%;
  max-width: 840px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* System Header */
.system-header {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 1.5rem;
  background: linear-gradient(90deg, rgba(1, 205, 254, 0.1), transparent);
  border-left: 4px solid var(--neon-cyan);
  border-radius: 4px 16px 16px 4px;
  position: relative;
  overflow: hidden;
  box-shadow: inset 0 0 20px rgba(1, 205, 254, 0.05);
  animation: scanline 4s linear infinite;
}

.system-header::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, var(--neon-cyan), transparent);
  opacity: 0.5;
}

.system-logo {
  width: 90px;
  height: 90px;
  flex-shrink: 0;
  border: 1px solid var(--neon-cyan);
  border-radius: 12px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.5);
  box-shadow: 0 0 15px rgba(1, 205, 254, 0.2);
}
.system-logo img {
  width: 100%; height: 100%; object-fit: cover; border-radius: 8px; filter: grayscale(20%) contrast(120%);
}

.system-info {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.system-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: 0.02em;
  color: #fff;
  text-shadow: 0 0 10px rgba(1, 205, 254, 0.5);
  text-transform: uppercase;
}
.system-title b { color: var(--neon-cyan); font-weight: 700; }

.system-meta {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.85rem;
  color: var(--neon-cyan);
}

.sys-badge {
  background: rgba(1, 205, 254, 0.15);
  border: 1px solid var(--border-cyan);
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.system-desc {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin-top: 0.3rem;
}

/* Glass Panels (Cards) */
.hud-panel {
  background: var(--bg-panel);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  padding: 1.75rem;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  position: relative;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  transition: border-color 0.3s;
}

.hud-panel:hover {
  border-color: rgba(255, 255, 255, 0.1);
}

.panel-header {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.panel-header::before {
  content: '';
  display: block;
  width: 12px;
  height: 12px;
  background: transparent;
  border: 2px solid var(--neon-magenta);
  box-shadow: 0 0 10px var(--neon-magenta);
  transform: rotate(45deg);
}
.panel-header.cyan::before { border-color: var(--neon-cyan); box-shadow: 0 0 10px var(--neon-cyan); }
.panel-header.green::before { border-color: var(--neon-green); box-shadow: 0 0 10px var(--neon-green); }
.panel-header.amber::before { border-color: var(--neon-amber); box-shadow: 0 0 10px var(--neon-amber); }

/* Toggle-all & Save buttons */
.cat-toggle-all {
  margin-left: auto;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0.3rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--border-amber);
  background: rgba(255, 191, 0, 0.06);
  color: var(--neon-amber);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.cat-toggle-all:hover { background: rgba(255, 191, 0, 0.15); color: #fff; }

.btn-save {
  margin-left: auto;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0.3rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--border-magenta);
  background: rgba(255, 113, 206, 0.06);
  color: var(--neon-magenta);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.btn-save:hover { background: rgba(255, 113, 206, 0.15); color: #fff; }
.btn-save.saved { background: rgba(0, 200, 160, 0.15); border-color: #00C8A0; color: #00C8A0; }

/* Input Filter */
.hud-search {
  width: 100%;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border-cyan);
  border-radius: 8px;
  color: var(--neon-cyan);
  font-family: 'Share Tech Mono', monospace;
  font-size: 1rem;
  padding: 0.8rem 1.2rem;
  outline: none;
  margin-bottom: 1.25rem;
  transition: all 0.3s ease;
  box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.5);
}
.hud-search::placeholder { color: rgba(1, 205, 254, 0.3); }
.hud-search:focus {
  background: rgba(1, 205, 254, 0.05);
  box-shadow: 0 0 15px rgba(1, 205, 254, 0.15), inset 0 2px 10px rgba(0, 0, 0, 0.5);
}

/* Grid Layouts */
.hud-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}
.hud-grid-dense {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 0.6rem;
}

/* Language Chips - Checkbox Based */
.hud-chip { cursor: pointer; user-select: none; position: relative; }
.hud-chip input { position: absolute; opacity: 0; pointer-events: none; }
.hud-chip-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.6rem 0.5rem;
  border-radius: 8px;
  font-family: 'Inter', sans-serif;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  text-align: center;
}
.hud-chip:hover .hud-chip-inner {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}
.hud-chip input:checked ~ .hud-chip-inner {
  color: var(--neon-cyan);
  background: rgba(1, 205, 254, 0.1);
  border-color: var(--neon-cyan);
  box-shadow: 0 0 12px rgba(1, 205, 254, 0.2);
}
.hud-chip.hidden { display: none; }

/* Toggle Elements (Sources, Extractors) */
.hud-toggle {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.9rem;
  border-radius: 8px;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.9rem;
  color: #fff;
  background: rgba(0, 255, 102, 0.08);
  border: 1px solid rgba(0, 255, 102, 0.3);
  transition: all 0.2s ease;
}

.status-indicator {
  width: 8px;
  height: 8px;
  background: var(--neon-green);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--neon-green);
  flex-shrink: 0;
  transition: all 0.3s;
}

.hud-toggle:hover { background: rgba(0, 255, 102, 0.15); }

/* Scraper source toggles — amber theme */
.hud-toggle.src-toggle {
  background: rgba(255, 191, 0, 0.08);
  border-color: var(--border-amber);
}
.hud-toggle.src-toggle .status-indicator {
  background: var(--neon-amber);
  box-shadow: 0 0 8px var(--neon-amber);
}
.hud-toggle.src-toggle:hover { background: rgba(255, 191, 0, 0.15); }

/* Offline State (Disabled Source/Extractor) */
.hud-toggle.sys-offline {
  background: rgba(255, 51, 102, 0.05);
  border-color: rgba(255, 51, 102, 0.2);
  color: var(--text-muted);
}
.hud-toggle.sys-offline .status-indicator {
  background: var(--neon-red);
  box-shadow: 0 0 8px var(--neon-red);
}
.hud-toggle.sys-offline .label-text { text-decoration: line-through; opacity: 0.7; }
.hud-toggle.sys-offline:hover { background: rgba(255, 51, 102, 0.1); border-color: rgba(255, 51, 102, 0.4); }

/* Resolutions (Cyan theme) */
.hud-toggle.res-toggle {
  background: rgba(1, 205, 254, 0.08);
  border-color: rgba(1, 205, 254, 0.3);
}
.hud-toggle.res-toggle .status-indicator { background: var(--neon-cyan); box-shadow: 0 0 8px var(--neon-cyan); }
.hud-toggle.res-toggle:hover { background: rgba(1, 205, 254, 0.15); }

.hud-toggle.res-toggle.sys-offline {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--text-muted);
}
.hud-toggle.res-toggle.sys-offline .status-indicator { background: #555; box-shadow: none; }
.hud-toggle.res-toggle.sys-offline:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.2); }

/* Form Fields */
.hud-field { margin-bottom: 1.5rem; }
.hud-label {
  display: block;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.8rem;
  color: var(--neon-purple);
  margin-bottom: 0.5rem;
  letter-spacing: 0.05em;
}
.hud-input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border-magenta);
  border-radius: 8px;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 1rem;
  padding: 0.9rem 1.2rem;
  outline: none;
  transition: all 0.3s;
}
.hud-input:focus {
  border-color: var(--neon-magenta);
  background: rgba(255, 113, 206, 0.05);
  box-shadow: 0 0 15px rgba(255, 113, 206, 0.15);
}

/* Checkboxes */
.hud-checkbox {
  display: flex;
  align-items: center;
  gap: 1rem;
  cursor: pointer;
  padding: 0.5rem 0;
}
.hud-checkbox input { position: absolute; opacity: 0; }
.hud-check-box {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border-cyan);
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  position: relative;
}
.hud-checkbox input:checked ~ .hud-check-box {
  background: rgba(1, 205, 254, 0.2);
  border-color: var(--neon-cyan);
  box-shadow: 0 0 10px rgba(1, 205, 254, 0.4);
}
.hud-checkbox input:checked ~ .hud-check-box::after {
  content: '';
  width: 10px; height: 10px;
  background: var(--neon-cyan);
  border-radius: 2px;
  box-shadow: 0 0 8px var(--neon-cyan);
}
.hud-check-label {
  font-family: 'Share Tech Mono', monospace;
  font-size: 1rem;
  color: var(--text-main);
}

/* Accordion */
.adv-btn {
  background: none;
  border: none;
  color: var(--neon-purple);
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  width: 100%;
  padding: 1rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  margin-top: 1rem;
  transition: color 0.3s;
}
.adv-btn:hover { color: #fff; }
.adv-btn .chevron { transition: transform 0.3s; }
.adv-btn.open .chevron { transform: rotate(180deg); }
.adv-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  opacity: 0;
}
.adv-body.open { grid-template-rows: 1fr; opacity: 1; margin-top: 1rem; }
.adv-content { overflow: hidden; }

/* Install Bar */
.action-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  padding: 1.5rem;
  background: linear-gradient(to top, rgba(5, 5, 10, 0.98) 60%, transparent);
  border-top: 1px solid rgba(1, 205, 254, 0.1);
  z-index: 100;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1rem;
  backdrop-filter: blur(12px);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--neon-cyan);
  color: #000;
  text-decoration: none;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  padding: 0.9rem 3.5rem;
  border-radius: 8px;
  box-shadow: 0 0 20px rgba(1, 205, 254, 0.4);
  transition: all 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  clip-path: polygon(15px 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%, 0 15px);
}
.btn-primary:hover {
  background: #fff;
  box-shadow: 0 0 30px rgba(1, 205, 254, 0.6);
  transform: translateY(-2px);
}
.btn-primary:active { transform: translateY(0); }

.btn-secondary {
  display: inline-flex;
  align-items: center;
  background: rgba(1, 205, 254, 0.05);
  border: 1px solid var(--border-cyan);
  color: var(--neon-cyan);
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.9rem;
  padding: 0 1.5rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  text-transform: uppercase;
}
.btn-secondary:hover {
  background: rgba(1, 205, 254, 0.15);
  color: #fff;
}
.btn-secondary.copied {
  background: rgba(0, 255, 102, 0.15);
  border-color: var(--neon-green);
  color: var(--neon-green);
  box-shadow: 0 0 15px rgba(0, 255, 102, 0.2);
}

/* Warning Box */
.glitch-box {
  background: rgba(255, 51, 102, 0.05);
  border-left: 4px solid var(--neon-red);
  padding: 1.5rem;
  border-radius: 0 8px 8px 0;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.95rem;
  color: #fff;
  line-height: 1.6;
  margin-top: 1rem;
}
.glitch-box a {
  color: var(--neon-red);
  text-decoration: none;
  border-bottom: 1px dashed var(--neon-red);
  font-weight: bold;
}
.glitch-box a:hover { color: #fff; border-color: #fff; }

@media (max-width: 650px) {
  .system-header { flex-direction: column; text-align: center; border-left: none; border-top: 4px solid var(--neon-cyan); }
  .system-meta { justify-content: center; flex-wrap: wrap; }
  .action-bar { flex-direction: column; padding: 1rem; }
  .btn-primary { width: 100%; padding: 1rem; }
  .btn-secondary { width: 100%; padding: 1rem; justify-content: center; }
  .hud-grid { grid-template-columns: 1fr; }
  .hud-grid-dense { grid-template-columns: repeat(2, 1fr); }
}

@keyframes scanline {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}

</style>
</head>
<body>
<canvas id="hexbg"></canvas>
<div class="flare flare-1"></div>
<div class="flare flare-2"></div>

<div class="hud-container">
  <div class="system-header">
    <div class="system-logo"><img src="${logo}" alt="Logo"></div>
    <div class="system-info">
      <div class="system-title"><b>Aetheria</b> LINK</div>
      <div class="system-meta">
        <span class="sys-badge">v${manifest.version || '1.0.0'}</span>
        <span>STATUS: ONLINE</span>
        <span>LATENCY: ~14ms</span>
      </div>
      <div class="system-desc">${shortDesc}</div>
    </div>
  </div>

  <form id="mainForm">

    <div class="hud-panel">
      <div class="panel-header cyan">Optimization Advisory</div>
      <p style="font-family:'Share Tech Mono',monospace;font-size:0.85rem;color:var(--text-main);line-height:1.65;">Every enabled source is scraped in parallel against an 18-second deadline. Disabling categories or individual sources you do not need reduces contention and produces faster stream lists. Use the <b>Toggle All</b> buttons to quickly turn off whole groups.</p>
    </div>

    ${debridSourceConfigs.length
        ? `
    <div class="hud-panel" data-cat="debrid">
      <div class="panel-header" style="color: var(--neon-magenta); border-color: var(--neon-magenta);">Debrid Services<button type="button" class="cat-toggle-all" data-cat="debrid">Toggle All</button></div>
      <p style="font-family:'Share Tech Mono',monospace;font-size:0.82rem;color:var(--text-muted);margin-bottom:1.25rem;line-height:1.6;">Configure a Debrid service to resolve NitroFlare / Rapidgator / RapidRAR links from the sources below into premium direct-download streams. Enter your API key to activate.</p>
      ${debridFields}
      ${debridSrcChips ? `<div style="margin-top:1rem;"><div style="font-family:'Share Tech Mono',monospace;font-size:0.78rem;color:var(--neon-magenta);margin-bottom:0.5rem;letter-spacing:0.05em;">DEBRID SOURCES</div><div class="hud-grid">${debridSrcChips}</div></div>` : ''}
    </div>`
        : ''}

    ${hollywoodSourceConfigs.length
        ? `
    <div class="hud-panel" data-cat="hollywood">
      <div class="panel-header amber">Scrapers — Hollywood Movies<button type="button" class="cat-toggle-all" data-cat="hollywood">Toggle All</button></div>
      <div class="hud-grid">${hollywoodSrcChips}</div>
    </div>`
        : ''}

    ${asiandramaSourceConfigs.length
        ? `
    <div class="hud-panel" data-cat="asiandrama">
      <div class="panel-header amber">Scrapers — Asian Drama<button type="button" class="cat-toggle-all" data-cat="asiandrama">Toggle All</button></div>
      <div class="hud-grid">${asiandramaSrcChips}</div>
    </div>`
        : ''}

    ${animeSourceConfigs.length
        ? `
    <div class="hud-panel" data-cat="anime">
      <div class="panel-header amber">Scrapers — Anime<button type="button" class="cat-toggle-all" data-cat="anime">Toggle All</button></div>
      <div class="hud-grid">${animeSrcChips}</div>
    </div>`
        : ''}

    ${donghuaSourceConfigs.length
        ? `
    <div class="hud-panel" data-cat="donghua">
      <div class="panel-header amber">Scrapers — Donghua<button type="button" class="cat-toggle-all" data-cat="donghua">Toggle All</button></div>
      <div class="hud-grid">${donghuaSrcChips}</div>
    </div>`
        : ''}

    ${languageConfigs.length
        ? `
    <div class="hud-panel">
      <div class="panel-header cyan">Localization Nodes</div>
      <input type="text" class="hud-search" id="ls" placeholder="// FILTER REGIONS..." autocomplete="off">
      <div class="hud-grid-dense" id="lgrid">${langChips}</div>
    </div>`
        : ''}

    ${resolutionConfigs.length
        ? `
    <div class="hud-panel">
      <div class="panel-header cyan">Transcode Filters</div>
      <div class="hud-grid">${resChips}</div>
    </div>`
        : ''}

    ${proxyConfigs.length
        ? `
    <div class="hud-panel">
      <div class="panel-header magenta" style="color: var(--neon-magenta); border-color: var(--neon-magenta);">Network Proxy</div>
      ${proxyFields}
    </div>`
        : ''}

    ${(optionConfigs.length || extractorConfigs.length)
        ? `
    <div class="hud-panel" style="padding-bottom: 0.5rem;">
      <button type="button" class="adv-btn" id="ab">
        [ SYSTEM OVERRIDES ] <span class="chevron">▼</span>
      </button>
      <div class="adv-body" id="abody">
        <div class="adv-content" style="padding-bottom: 1rem;">
          ${optFields ? `<div style="margin-bottom: 1.5rem;">${optFields}</div>` : ''}
          ${extractorConfigs.length ? `<div class="panel-header">Algorithm Overrides</div><div class="hud-grid">${extChips}</div>` : ''}
        </div>
      </div>
    </div>`
        : ''}

  </form>

  <div class="glitch-box">
    <b>NOTICE:</b> Aetheria Link scrapes public sources in parallel and returns whatever resolves within an 18-second deadline. Slower sources keep warming the cache in the background, so a second request for the same title often shows more streams. For the most reliable playback, enable and configure a Debrid service above; public HTTP hosters are intended as a fallback.
  </div>
</div>

<div class="action-bar">
  <button type="button" id="saveApplyBtn" class="btn-primary">💾 Save &amp; Apply</button>
  <button type="button" id="copyStremioBtn" class="btn-secondary">🔗 Copy Stremio</button>
  <button type="button" id="copyHttpBtn" class="btn-secondary">📋 Copy URL</button>
  <button type="button" id="btnAddToStremio" class="btn-secondary">⚡ Add to Stremio</button>
  <button type="button" id="btnStremioWeb" class="btn-secondary">🌐 Open in Stremio Web</button>
</div>

<script>
const form = document.getElementById('mainForm');
const ilink = document.getElementById('installLink');
const ls = document.getElementById('ls');
const ab = document.getElementById('ab');
const abody = document.getElementById('abody');

if (ls) {
  ls.addEventListener('input', () => {
    const q = ls.value.toLowerCase().trim();
    document.querySelectorAll('.lang-chip').forEach(c => {
      c.classList.toggle('hidden', q.length > 0 && !(c.dataset.s || '').includes(q));
    });
  });
}

if (ab) {
  ab.addEventListener('click', () => {
    ab.classList.toggle('open');
    abody.classList.toggle('open');
  });
}

const getConfigPath = () => {
  const data = new FormData(form);
  const config = Object.fromEntries([...data.entries()].filter(([, v]) => v !== ''));
  if (config.mediaFlowProxyUrl) {
    config.mediaFlowProxyUrl = config.mediaFlowProxyUrl.replace(/^https?:\\/\\//, '');
  }
  return encodeURIComponent(JSON.stringify(config)) + '/manifest.json';
};

const getStremioUrl = () => 'stremio://' + window.location.host + '/' + getConfigPath();
const getHttpUrl  = () => window.location.protocol + '//' + window.location.host + '/' + getConfigPath();
// The URI that is copied / used to add to Stremio is always HTTPS, so it is a
// valid addon URL in Stremio (HTTPS only) on every deployment regardless of
// whether this page was opened over http (local dev) or https (hosted).
const getHttpsUrl = () => 'https://' + window.location.host + '/' + getConfigPath();

const manifestUrlDisplay = document.getElementById('manifestUrlDisplay');
const updateManifestUrl = () => { if (manifestUrlDisplay) manifestUrlDisplay.value = getHttpsUrl(); };

// Kept as the single refresh hook so every toggle / save handler below keeps
// the manifest URI in sync as the user edits the configuration.
const updateLink = () => updateManifestUrl();

let manifestTimer = null;
const scheduleManifestUrl = () => { clearTimeout(manifestTimer); manifestTimer = setTimeout(updateManifestUrl, 80); };
if (form) { form.addEventListener('input', scheduleManifestUrl); form.addEventListener('change', scheduleManifestUrl); }
updateManifestUrl();

function mountToggles(selector) {
  document.querySelectorAll(selector).forEach(chip => {
    if (chip.classList.contains('sys-offline')) {
      const ex = document.getElementById('hx_' + chip.dataset.key);
      if (!ex) {
        const inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = chip.dataset.key; inp.value = 'on'; inp.id = 'hx_' + chip.dataset.key;
        form.appendChild(inp);
      }
    }
    
    chip.addEventListener('click', () => {
      chip.classList.toggle('sys-offline');
      const key = chip.dataset.key;
      const ex = document.getElementById('hx_' + key);
      
      if (chip.classList.contains('sys-offline')) {
        if (!ex) {
          const inp = document.createElement('input');
          inp.type = 'hidden'; inp.name = key; inp.value = 'on'; inp.id = 'hx_' + key;
          form.appendChild(inp);
        }
      } else {
        if (ex) ex.remove();
      }
      updateLink();
    });
  });
}

mountToggles('.hud-toggle');

/* === Restore full configuration from localStorage === */
/* Re-applies every saved toggle/checkbox/input so the form reflects the
   user's last "Save & Apply" even after a full app restart. The server also
   persists the config to disk and feeds it back via lastSyncedConfig, but
   this client-side restore guarantees the visual state is correct the
   instant the page paints, with no flicker back to defaults. */
(function restoreFullConfig() {
  var saved;
  try { saved = JSON.parse(localStorage.getItem('aetheria_link_full_config') || '{}'); } catch (e) { saved = {}; }
  if (!saved || Object.keys(saved).length === 0) return;

  /* Source / extractor / resolution toggles: key presence = OFF */
  document.querySelectorAll('.hud-toggle').forEach(function(chip) {
    var key = chip.dataset.key;
    if (!key) return;
    var shouldBeOff = key in saved;
    var isOff = chip.classList.contains('sys-offline');
    if (shouldBeOff && !isOff) {
      chip.classList.add('sys-offline');
      if (!document.getElementById('hx_' + key)) {
        var inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = key; inp.value = 'on'; inp.id = 'hx_' + key;
        form.appendChild(inp);
      }
    } else if (!shouldBeOff && isOff) {
      chip.classList.remove('sys-offline');
      var ex = document.getElementById('hx_' + key);
      if (ex) ex.remove();
    }
  });

  /* Language chips + option checkboxes: key presence = checked */
  document.querySelectorAll('input[type="checkbox"][name]').forEach(function(cb) {
    cb.checked = cb.name in saved;
  });

  /* Text inputs: proxy + debrid keys */
  ['mediaFlowProxyUrl', 'mediaFlowProxyPassword', 'alldebridApiKey', 'realdebridApiKey'].forEach(function(k) {
    if (saved[k]) {
      var inp = form.querySelector('[name="' + k + '"]');
      if (inp) inp.value = saved[k];
    }
  });
})();

function flashCopy(btn, label, url) {
  navigator.clipboard.writeText(url).then(() => {
    btn.innerHTML = '✓ Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = label; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    btn.innerHTML = '✗ Failed'; setTimeout(() => { btn.innerHTML = label; }, 1500);
  });
}

/* === Save & Apply button — persists config and notifies parent Electron app === */
document.getElementById('saveApplyBtn')?.addEventListener('click', async function() {
  const btn = this;
  const data = new FormData(form);
  const config = Object.fromEntries([...data.entries()].filter(([, v]) => v !== ''));

  // Persist debrid keys to localStorage so they survive page reloads
  ['alldebridApiKey', 'realdebridApiKey'].forEach(k => {
    if (config[k]) localStorage.setItem('aetheria_' + k, config[k]);
    else localStorage.removeItem('aetheria_' + k);
  });

  // Persist the FULL config to localStorage so every toggle (sources,
  // extractors, resolutions, languages, proxy, options) is restored on
  // the next page load — not just the debrid keys.
  localStorage.setItem('aetheria_link_full_config', JSON.stringify(config));

  try {
    await fetch('/app-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    btn.textContent = '✅ Applied!';
    btn.style.background = 'var(--neon-green)';
    btn.style.color = '#000';
  } catch(e) {
    btn.textContent = '✓ Saved Locally';
    btn.style.background = 'rgba(0,255,102,0.5)';
  }
  setTimeout(() => {
    btn.textContent = '💾 Save & Apply';
    btn.style.background = '';
    btn.style.color = '';
  }, 2500);
});

document.getElementById('copyStremioBtn')?.addEventListener('click', function() {
  flashCopy(this, '🔗 Copy Stremio', getStremioUrl());
});
document.getElementById('copyHttpBtn')?.addEventListener('click', function() {
  flashCopy(this, '📋 Copy URL', getHttpsUrl());
});

/* === "Add to Stremio": deep-link (app) + web install, and copy the HTTPS manifest URI === */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove(); ok ? resolve() : reject(new Error('copy failed'));
  });
}

document.getElementById('btnAddToStremio')?.addEventListener('click', function() {
  const url = getHttpsUrl();
  const host = window.location.host || '';
  if (host.includes('127.0.0.1') || host.includes('localhost')) {
    copyText(url).catch(() => {});
    window.alert('Local (HTTP) build detected: Stremio blocks automatic http installs. The HTTPS manifest URL was copied to your clipboard. Open Stremio, go to Add-ons, and paste it into the search box to install it there.');
    return;
  }
  const deepPath = url.slice(url.indexOf('://') + 3);
  window.location.href = 'stremio://' + deepPath;
});

document.getElementById('btnStremioWeb')?.addEventListener('click', function() {
  window.open('https://web.stremio.com/#/addons?addon=' + encodeURIComponent(getHttpsUrl()), '_blank');
});

const copyManifestBtn = document.getElementById('copyManifestBtn');
if (copyManifestBtn) {
  copyManifestBtn.addEventListener('click', function() {
    const btn = copyManifestBtn;
    const box = manifestUrlDisplay;
    if (box) { box.focus(); box.select(); }
    copyText(box ? box.value : getHttpsUrl()).then(() => {
      btn.textContent = 'COPIED ✓'; btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 1600);
    }).catch(() => {
      btn.textContent = 'COPY?'; setTimeout(() => { btn.textContent = 'COPY'; }, 1600);
    });
  });
}
if (manifestUrlDisplay) manifestUrlDisplay.addEventListener('click', () => manifestUrlDisplay.select());

/* === Restore debrid API keys from localStorage === */
['alldebridApiKey', 'realdebridApiKey'].forEach(function(k) {
  var saved = localStorage.getItem('aetheria_' + k);
  if (saved) {
    var inp = form.querySelector('[name="' + k + '"]');
    if (inp) { inp.value = saved; }
  }
});

/* === Save debrid keys to localStorage (per-field buttons) === */
document.querySelectorAll('.btn-save[data-save-key]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var key = btn.dataset.saveKey;
    var inp = form.querySelector('[name="' + key + '"]');
    if (inp && inp.value) {
      localStorage.setItem('aetheria_' + key, inp.value);
      /* Keep the full-config snapshot in sync so this key isn't lost on reload */
      try {
        var full = JSON.parse(localStorage.getItem('aetheria_link_full_config') || '{}');
        full[key] = inp.value;
        localStorage.setItem('aetheria_link_full_config', JSON.stringify(full));
      } catch (e) { /* ignore parse errors */ }
    } else {
      localStorage.removeItem('aetheria_' + key);
      try {
        var full2 = JSON.parse(localStorage.getItem('aetheria_link_full_config') || '{}');
        delete full2[key];
        localStorage.setItem('aetheria_link_full_config', JSON.stringify(full2));
      } catch (e) { /* ignore */ }
    }
    btn.textContent = '✓ Saved!';
    btn.classList.add('saved');
    setTimeout(function() {
      btn.textContent = '💾 Save';
      btn.classList.remove('saved');
    }, 2000);
    updateLink();
  });
});

/* === Toggle-All buttons for scraper categories === */
document.querySelectorAll('.cat-toggle-all').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var cat = btn.dataset.cat;
    var panel = document.querySelector('.hud-panel[data-cat="' + cat + '"]');
    if (!panel) return;
    var toggles = panel.querySelectorAll('.hud-toggle.src-toggle');
    var anyOn = false;
    toggles.forEach(function(t) { if (!t.classList.contains('sys-offline')) anyOn = true; });
    toggles.forEach(function(chip) {
      var isOff = chip.classList.contains('sys-offline');
      var key = chip.dataset.key;
      if (anyOn) {
        /* Turn all OFF */
        if (!isOff) {
          chip.classList.add('sys-offline');
          if (!document.getElementById('hx_' + key)) {
            var inp = document.createElement('input');
            inp.type = 'hidden'; inp.name = key; inp.value = 'on'; inp.id = 'hx_' + key;
            form.appendChild(inp);
          }
        }
      } else {
        /* Turn all ON */
        if (isOff) {
          chip.classList.remove('sys-offline');
          var ex = document.getElementById('hx_' + key);
          if (ex) ex.remove();
        }
      }
    });
    updateLink();
  });
});

/* === HexLattice Canvas Background Animation === */
(function() {
  var canvas = document.getElementById('hexbg');
  if (!canvas) return;
  var ctx = canvas.getContext('2d', { alpha: false });
  var renderScale = 0.5;
  var hexRadius = 55;
  var hexW = Math.sqrt(3) * hexRadius;
  var hexH = hexRadius * 2;
  var horizSpacing = hexW;
  var vertSpacing = hexH * 0.75;

  var W = 0, H = 0, cols = 0, rows = 0;
  var time = 0;
  var isVisible = true;
  var animId = null;

  /* Pre-compute hexagon paths */
  var hexPath = new Path2D();
  var innerHexPath = new Path2D();
  for (var i = 0; i < 6; i++) {
    var angle = (Math.PI / 3) * i - Math.PI / 6;
    var px1 = (hexRadius - 1) * Math.cos(angle);
    var py1 = (hexRadius - 1) * Math.sin(angle);
    if (i === 0) hexPath.moveTo(px1, py1); else hexPath.lineTo(px1, py1);
    var px2 = (hexRadius - 3) * Math.cos(angle);
    var py2 = (hexRadius - 3) * Math.sin(angle);
    if (i === 0) innerHexPath.moveTo(px2, py2); else innerHexPath.lineTo(px2, py2);
  }
  hexPath.closePath();
  innerHexPath.closePath();

  function drawFrame() {
    if (W === 0 || H === 0) return;

    /* Base layer — dark */
    ctx.fillStyle = '#050a08';
    ctx.fillRect(0, 0, W, H);

    /* Glow layer — sweeping radial gradient */
    var glowX = W * 0.5 + Math.cos(time * 0.6) * W * 0.3;
    var glowY = H * 0.5 + Math.sin(time * 0.4) * H * 0.3;
    var bgGlow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(W, H) * 0.65);
    bgGlow.addColorStop(0, 'rgba(160, 210, 40, 0.18)');
    bgGlow.addColorStop(0.5, 'rgba(0, 150, 120, 0.08)');
    bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, W, H);

    /* Honeycomb net */
    ctx.lineWidth = 1.5;
    var offsetX = time * 8;
    var offsetY = time * 6;
    var startCol = Math.floor(offsetX / horizSpacing) - 2;
    var startRow = Math.floor(offsetY / vertSpacing) - 2;

    for (var row = startRow; row < startRow + rows + 4; row++) {
      for (var col = startCol; col < startCol + cols + 4; col++) {
        var x = col * horizSpacing + (Math.abs(row % 2) === 1 ? horizSpacing * 0.5 : 0) - offsetX;
        var y = row * vertSpacing - offsetY;

        var diag = col * 0.12 + row * 0.12 - time * 8.5;
        var orth = col * 0.3 - row * 0.3 + time * 2;
        var blobNoise = Math.sin(diag) + (Math.cos(orth) * 0.25);

        ctx.translate(x, y);

        var fillStyle = 'rgba(0, 6, 6, 0.4)';
        var strokeStyle = 'rgba(20, 60, 50, 0.6)';
        var innerHighlight = 'rgba(255, 255, 255, 0.03)';
        var isGlowing = false;

        if (blobNoise > 0.95) {
          var intensity = Math.min((blobNoise - 0.95) / 0.3, 1);
          fillStyle = 'rgba(245, 210, 40, ' + (0.15 + intensity * 0.55) + ')';
          strokeStyle = 'rgba(255, 230, 80, ' + (0.4 + intensity * 0.5) + ')';
          innerHighlight = 'rgba(255, 255, 255, ' + (0.05 + intensity * 0.45) + ')';
          isGlowing = true;
          if (intensity > 0.5) {
            ctx.strokeStyle = 'rgba(240, 200, 40, ' + ((intensity - 0.5) * 0.8) + ')';
            ctx.lineWidth = 4;
            ctx.stroke(hexPath);
          }
        } else if (blobNoise > 0.65) {
          var int2 = (blobNoise - 0.65) / 0.3;
          fillStyle = 'rgba(160, 210, 40, ' + (0.05 + int2 * 0.2) + ')';
          strokeStyle = 'rgba(100, 200, 100, ' + (0.2 + int2 * 0.4) + ')';
          isGlowing = true;
        }

        ctx.fillStyle = fillStyle;
        ctx.fill(hexPath);
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 1.5;
        ctx.stroke(hexPath);

        if (isGlowing) {
          ctx.strokeStyle = innerHighlight;
          ctx.lineWidth = 0.5;
          ctx.stroke(innerHexPath);
        }

        ctx.translate(-x, -y);
      }
    }
  }

  function handleResize() {
    W = window.innerWidth;
    H = window.innerHeight;
    if (W === 0 || H === 0) return;
    canvas.width = Math.floor(W * renderScale);
    canvas.height = Math.floor(H * renderScale);
    ctx.scale(renderScale, renderScale);
    cols = Math.ceil(W / horizSpacing);
    rows = Math.ceil(H / vertSpacing);
    drawFrame();
  }

  var lastTime = performance.now();
  var fpsInterval = 1000 / 12;

  function render() {
    animId = requestAnimationFrame(render);
    var now = performance.now();
    var elapsed = now - lastTime;
    if (elapsed < fpsInterval - 0.5) return;
    lastTime = now - (elapsed % fpsInterval);
    if (!isVisible) return;
    time += 0.015;
    drawFrame();
  }

  handleResize();
  window.addEventListener('resize', handleResize);
  document.addEventListener('visibilitychange', function() { isVisible = !document.hidden; });

  render();
})();

updateLink();
</script>
</body>
</html>`;
}
