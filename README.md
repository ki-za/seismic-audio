# Seismic Audio Prototype

SvelteKit + TypeScript gallery app for compressed-time seismic sonification.

```text
synthetic feed or Raspberry Shake archive/DATACAST
→ Bun TypeScript bridge records or fetches seismic windows
→ SvelteKit UI requests compressed windows
→ browser Web Audio renders earth-time as sound
→ WAV + metadata export for loaded windows
```

## Requirements

- [Bun](https://bun.sh/) for local development and scripts.
- Chromium-compatible browser for the gallery UI and smoke tests.

## Quickstart

```bash
cd ~/projects/seismic-audio
bun install
bun run show
```

Open the Vite URL printed by the terminal, usually:

```text
http://localhost:5173
```

Then:

1. Pick **Synthetic / LAN bridge** for local generated data, or search/select a Raspberry Shake station.
2. Choose the window range and playback length.
3. Click **Load Window** to fetch/render the selected seismic window.
4. Click **Play Loaded Loop** to listen.
5. Adjust sound/DSP settings, then replay or export.
6. Use **Download WAV + metadata** after a window is loaded.

Synthetic mode works without hardware or network station setup.

## Run modes

### Development gallery

```bash
bun run show
```

This starts both pieces:

```text
Bun bridge/server.ts  → local HTTP/WebSocket bridge
Vite/SvelteKit        → browser UI
```

### Live Raspberry Shake DATACAST

Configure DATACAST to send UDP packets to this machine on port `8888`, then run:

```bash
INPUT_MODE=udp UDP_PORT=8888 bun run show
```

### Static preview / packaged shape

```bash
bun run build
bun run preview
```

The project uses SvelteKit static output plus the local Bun bridge.

## Features

```text
Sources:    synthetic bridge, Raspberry Shake station archive, UDP DATACAST
Stations:   searchable local Raspberry Shake catalog
Windows:    presets plus granular date/time controls
Playback:   compressed render length controls
Sound:      soft / clear / raw, with collapsible DSP tuning
Export:     WAV + sidecar metadata from the loaded window
Guide:      in-app DSP tuning guide at /dsp-guide
Packaging:  Windows portable build script
```

The browser audio chain removes DC offset, normalizes gently, filters, saturates,
limits, and fades edges so compressed data stays gallery-safe.

## Diagnostics and verification

Core checks:

```bash
bun run check
bun run build
bun run diagnose
```

Focused diagnostics:

```bash
bun run diagnose:domain
bun run diagnose:dsp
bun run diagnose:query-controls
bun run diagnose:stations
bun run diagnose:windows-portable
```

Browser smoke test, with `bun run show` already running:

```bash
bun run smoke:browser
```

The smoke test opens Chromium through Playwright, captures browser console/page
errors, reads bridge status, and checks the app audio meter.

## Windows portable build

```bash
bun run package:windows-portable
bun run diagnose:windows-portable
```

The packaging script builds the static UI and prepares a portable Windows bundle
around the bridge/static server path.

## Station catalog maintenance

Refresh the committed live station catalog with:

```bash
bun run refresh:stations
```

The app reads the committed catalog from:

```text
static/data/raspberry-shake-stations-live.json
```

## Repository layout

```text
src/                Svelte UI, adapters, application, domain, ports
bridge/             Bun HTTP/WebSocket/UDP bridge
scripts/            user-facing maintenance, packaging, and smoke scripts
static/             static app assets and station catalog data
AGENT_CONTEXT/      planning notes, research, previous agent orientation docs
AGENT_DIAGNOSTICS/  one-off diagnostics, agent scratch scripts, temp test data
```

## Legacy Python prototype

`seismic_audio.py` remains as the original UDP-to-oscillator sketch and parser
reference.
