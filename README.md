# Seismic Audio Prototype

SvelteKit + TypeScript gallery app for compressed-time seismic sonification.

```text
Raspberry Shake UDP or synthetic feed
→ TypeScript bridge records a rolling buffer
→ SvelteKit requests compressed windows
→ browser Web Audio plays earth-time as sound
```

## Quickstart

```bash
cd ~/projects/seismic-audio
npm install
npm run show
```

Open the Vite URL printed by the terminal, usually:

```text
http://localhost:5173
```

Then:

1. Pick **Synthetic / LAN bridge** for local generated data, or a Raspberry Shake station for archive data.
2. Click **Load Window** to fetch the selected seismic window.
3. Click **Play Loaded Loop** to hear the compressed-time audio.
4. Change sound settings and click **Play Loaded Loop** again to hear the updated render.
5. Use **Download WAV + metadata** after a window is loaded.

By default the bridge uses synthetic seismic-like data so the interface can be tested without hardware.

## Run gallery prototype

```bash
npm run show
```

## Use live Raspberry Shake DATACAST

Configure DATACAST to send UDP packets to this machine on port `8888`, then run:

```bash
INPUT_MODE=udp UDP_PORT=8888 npm run show
```

## Browser smoke test

With `npm run show` already running:

```bash
npm run smoke:browser
```

This opens Chromium through Playwright, captures browser console/page errors, clicks **Begin listening**, reads bridge status, and checks the app audio meter.

## App behavior

```text
Window:    15 min / 1 hour / 6 hours / 24 hours
Playback: 10 sec / 30 sec / 1 min / 5 min
Sound:    soft / clear / raw
Mode:     normal controls / fullscreen show mode
```

The browser audio chain removes DC offset, normalizes gently, filters, saturates, limits, and fades edges so compressed data stays gallery-safe.

## Legacy Python prototype

`seismic_audio.py` remains as the original UDP-to-oscillator sketch and parser reference.
