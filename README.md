# Mirathym — Measure. Mind. Minimize.

Mirathym is a Chrome Extension that monitors AI prompt usage on-device and translates it into live efficiency and carbon metrics using Gemini Nano. It helps you understand and reduce the environmental cost of your prompts.

## Highlights
- Live metrics from the backend (on-device Gemini Nano):
  - Tokens Used (your input tokens)
  - Efficiency = (outputTokens / inputTokens) × 100
  - Load Time (measured)
  - CPU Load (from `chrome.system.cpu.getInfo()`)
  - CO₂ Emission (g) = tokens × 0.0003 × cpu_load_factor
- No cloud calls: uses Chrome's built‑in `chrome.ai.*` APIs (Gemini Nano)
- Works across AI apps (ChatGPT, Gemini, Claude, Perplexity)
- Local summaries, suggestions, and history with weekly rollup
- Beautiful, accessible UI with animated rings/bars and eco tips

## How it works
- Content script captures prompt submissions from common inputs and AI sites.
- Background service worker spins up an offscreen document to access `chrome.ai.*`.
- Offscreen backend:
  - Runs Prompt API for completion + token metadata
  - Summarizer API for a concise prompt summary
  - Writer/Proofreader (via `chrome.ai.writer`) for eco suggestions
  - Translator API to localize eco summary to browser locale
  - CPU via `chrome.system.cpu.getInfo()`
  - Computes CO₂ and efficiency, persists `lastRun` and history
- Popup listens for backend updates and renders the dashboard live.

## Permissions
- `offscreen`: runs the on-device AI backend in an offscreen document
- `system.cpu`, `system.memory`: to read CPU load and system info
- `scripting`, `activeTab`, `tabs`, `storage`, `webRequest`: extension basics and caching

## Install (Developer Mode)
1. Open Chrome → `chrome://extensions` → enable Developer mode.
2. Click “Load unpacked” → select the `Mirathym` folder.
3. Confirm the extension loads without errors.

## Usage
1. Visit an AI app (ChatGPT, Gemini, Claude, Perplexity, etc.).
2. Type a prompt and press Enter.
3. Open the Mirathym popup to see live metrics:
   - Tokens Used, Efficiency, Load Time, CPU Load, CO₂
   - Eco suggestions, system health, facts carousel

## Project structure
- `manifest.json` — Extension manifest (MV3)
- `content.js` — Captures prompt submissions across AI sites
- `service_worker.js` — Manages lifecycle + offscreen backend relay
- `ai_offscreen.html` — Offscreen host page for on-device Gemini Nano
- `ai_offscreen.js` — Backend logic using `chrome.ai.*` + CPU + CO₂ math
- `popup.html`, `popup.css`, `popup.js` — Frontend dashboard (Mirathym)
- `assets/` — Extension icons

## Gemini Nano APIs used
- `chrome.ai.prompt` — primary prompt/compute + token metadata
- `chrome.ai.summarize` — short prompt summary
- `chrome.ai.translation` — localize eco summary to user locale
- `chrome.ai.writer` — proofread/rewriter-style eco suggestions

## CO₂ model
Approximation (based on public averages, adjustable):
- `CO2 (g) = tokens_total × 0.0003 × cpu_load_factor`, where `cpu_load_factor = cpuLoad/100` (clamped to `[0.1, 1.0]`).
- Token estimate fallback: `1 token ≈ 4 chars` if metadata is unavailable.

## Privacy
- All processing happens on device.
- No prompt content or metrics are sent to any server.
- History and weekly summaries are stored locally via `chrome.storage.local`.

## Make it your own
- Tune the CO₂ constant or the CPU factor in `ai_offscreen.js`.
- Customize tips, UI colors, or facts in `popup.js` / `popup.css`.

## Development scripts
None required; this is a pure MV3 extension. Reload from `chrome://extensions` after changes.

## Contributing
PRs and issues welcome. Please describe the AI app and browser build if you’re reporting site‑specific selector issues.

## License
MIT
