# ORIENTATION.md

Knowledge checkpoint for agents entering this codebase.

##  Current aim

This project is a **SvelteKit + TypeScript gallery app** for seismic sonification.

Core experience:

```text
seismic data
→ rolling TypeScript bridge buffer
→ compressed time window
→ browser Web Audio playback
→ minimal fullscreen gallery UI
```

The artistic goal is to make slow earth motion listenable by compressing long windows, e.g. **24 hours → 1 minute**.

## 󰜛 Run / verify

Install:

```bash
npm install
```

Run app + synthetic bridge:

```bash
npm run show
```

Live Raspberry Shake UDP mode:

```bash
INPUT_MODE=udp UDP_PORT=8888 npm run show
```

Check Svelte/TS:

```bash
npm run check
```

Build:

```bash
npm run build
```

Browser smoke test, with app already running:

```bash
npm run smoke:browser
```

Smoke test opens Chromium, clicks **Begin listening**, captures browser console/page errors, reads bridge status, and checks browser audio-meter signal.

##  Architecture map

```text
bridge/                         Node/TypeScript process
├─ server.ts                     HTTP + WebSocket + optional UDP listener
├─ datacast.ts                   Raspberry Shake DATACAST parser
├─ recorder.ts                   rolling sample buffer + compressed windows
└─ synthetic.ts                  fake seismic feed for gallery/dev testing

src/                            SvelteKit browser app
├─ routes/+page.svelte           main UI and show mode
├─ app.css                       global visual style
├─ lib/types.ts                  shared DTO/types
├─ lib/core/errors.ts            app-level error model
├─ lib/data/bridge.ts            browser HTTP/WebSocket adapter
└─ lib/audio/sonifier.ts         Web Audio compressed seismic player

scripts/
└─ browser-smoke.ts              agent-readable browser diagnostics
```

## 󰓁 Hexagonal boundaries

Use this rule:

```text
Does it do I/O or depend on browser/node/framework APIs?
├─ no  → core/application/domain
└─ yes → adapter
```

Current split:

```text
Inside-ish / pure
├─ src/lib/core/errors.ts        AppError shape and constructors
├─ src/lib/types.ts              shared data contracts
├─ bridge/datacast.ts            mostly pure packet parsing
└─ bridge/recorder.ts            mostly pure buffering/resampling

Adapters / I/O
├─ bridge/server.ts              HTTP, WebSocket, UDP
├─ bridge/synthetic.ts           timer/random feed
├─ src/lib/data/bridge.ts        fetch + WebSocket browser calls
├─ src/lib/audio/sonifier.ts     Web Audio API
└─ src/routes/+page.svelte       Svelte UI/browser interaction
```

When adding features, keep adapters thin. Put reusable rules/transforms in pure modules first, then call them from adapters.

##  Data flow

Synthetic/dev mode:

```text
bridge/synthetic.ts
→ RollingRecorder.ingest('SYN', timestamp, samples)
→ GET /window?windowSeconds=...&playbackSeconds=...
→ recorder.makeWindow(...)
→ Svelte getAudioWindow(...)
→ CompressedSeismicPlayer.play(...)
```

Live UDP mode:

```text
Raspberry Shake DATACAST UDP
→ bridge/server.ts UDP socket
→ parseDatacastPacket(...)
→ RollingRecorder.ingest(channel, timestamp, samples)
→ same /window browser flow
```

Status flow:

```text
RollingRecorder.status(...)
→ WebSocket broadcast every second
→ connectStatus(...)
→ +page.svelte status line
```

## 󰜛 Important existing choices

- SvelteKit is used as a client-focused app.
- The long-running UDP/buffer service is a separate TypeScript bridge, not SvelteKit server code.
- Audio synthesis/playback lives in browser Web Audio.
- Timescale means **literal compressed replay**, not just smoothing responsiveness.
- Sound must stay safe: DC removal, normalization, filtering, saturation, limiter, fades.
- UI has normal controls plus fullscreen show mode.
- Default bridge mode is synthetic, so the gallery interface works without hardware.

##  Known constraints / pitfalls

- Browsers cannot receive UDP directly.
- Browser audio requires a user gesture; keep **Begin listening** behavior.
- `$state` arrays/objects become proxies. Avoid comparing proxied objects with `===`; compare stable primitives like `seconds` or `label`.
- The browser smoke test proves Web Audio graph signal, not physical speaker output.
- `npm install` currently reports 3 low-severity dependency vulnerabilities.
- A true 24h live window only exists after the bridge has recorded 24h, unless archive/replay import is added later.

##  Common next tasks

Improve diagnostics:

```text
src/lib/core/errors.ts
src/lib/data/bridge.ts
src/routes/+page.svelte
scripts/browser-smoke.ts
```

Improve sound:

```text
src/lib/audio/sonifier.ts
bridge/recorder.ts
```

Improve live data input:

```text
bridge/server.ts
bridge/datacast.ts
bridge/recorder.ts
```

Improve gallery UI:

```text
src/routes/+page.svelte
src/app.css
```

## 󰶻 Last verified state

The app has been checked with:

```text
npm run check          ✅ 0 errors
npm run build          ✅ success
npm run smoke:browser  ✅ bridge connected, audioDetected true
```
