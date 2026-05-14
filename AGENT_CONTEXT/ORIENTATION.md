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

Domain unit tests (pure value objects + use cases):

```bash
npm run diagnose       # alias: npx tsx scripts/domain-diag.ts
```

Smoke test opens Chromium, clicks **Begin listening**, captures browser console/page errors, reads bridge status, and checks browser audio-meter signal.

##  Hexagonal architecture

The codebase uses hexagonal (ports & adapters) architecture.

Decision rule: **"Does it do I/O or depend on browser/node/framework APIs?"**
- **No** → inside hexagon (domain or application)
- **Yes** → outside (adapter)

Layers (inner to outer):

```text
┌─────────────────────────────────────────────────────┐
│ ADAPTERS (outside)                                  │
│ src/lib/adapters/         I/O implementations       │
│ src/routes/+page.svelte   UI binding layer          │
│ src/lib/audio/sonifier.ts Web Audio DSP wiring      │
│ bridge/                  Node process, HTTP/UDP      │
│ ┌───────────────────────────────────────────────┐   │
│ │ APPLICATION                                   │   │
│ │ src/lib/application/   use cases, orchestration│   │
│ │ src/lib/composition/   DI wiring, adapters → ports│ │
│ │ ┌─────────────────────────────────────────┐   │   │
│ │ │ DOMAIN                                   │   │   │
│ │ │ src/lib/domain/     pure value objects,  │   │   │
│ │ │ src/lib/core/       rules, state machine │   │   │
│ │ └─────────────────────────────────────────┘   │   │
│ └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
              Dependencies flow INWARD only
```

##  Architecture map

```text
bridge/                              Node/TypeScript process
├─ server.ts                          HTTP + WebSocket + optional UDP listener
├─ datacast.ts                        Raspberry Shake DATACAST parser
├─ recorder.ts                        rolling sample buffer + compressed windows
└─ synthetic.ts                       fake seismic feed for gallery/dev testing

src/lib/
├─ domain/                            PURE — no I/O, no framework
│  ├─ types.ts                        SoundMode, RenderQuality, AudioMetrics, etc.
│  ├─ provider-id.ts                   ProviderId value object
│  ├─ station.ts                       StationId, NSLC, channel hint parsing
│  ├─ load-state.ts                    LoadState state machine
│  ├─ audio-state.ts                   request keys, fingerprints, metrics calc
│  └─ sonification.ts                  DSP: prepareSamples, saturation, measureRms
├─ application/                        PURE — orchestrates domain, depends on ports
│  └─ seismic-audio-session.ts         loadAudioWindow, play, export, compare, selectProvider
├─ ports/                              ABSTRACT — interfaces, no impl
│  └─ audio.ts                        AudioWindowSource, AudioPlayer, AudioRenderer
├─ adapters/                           I/O — browser/framework adapters
│  ├─ bridge-client.ts                 fetch + WebSocket bridge adapter
│  └─ browser-audio.ts                 Web Audio player + renderer + file downloader
├─ audio/
│  └─ sonifier.ts                      CompressedSeismicPlayer + WAV rendering (Web Audio)
├─ composition/
│  └─ main.ts                          DI: wires adapters to ports, re-exports use cases
├─ core/
│  └─ errors.ts                        AppError model (pure)
└─ types.ts                            Cross-boundary DTOs, re-exports domain types

src/routes/
├─ +layout.svelte                      root layout wrapper
└─ +page.svelte                        main UI (Svelte adapter — all I/O decisions here)

scripts/
├─ browser-smoke.ts                    Playwright browser diagnostics
└─ domain-diag.ts                      pure domain + application unit tests
```

##  Data flow

Synthetic/dev mode:

```text
bridge/synthetic.ts
→ RollingRecorder.ingest('SYN', timestamp, samples)
→ GET /window?windowSeconds=...&playbackSeconds=...
→ recorder.makeWindow(...)
→ bridge-client.getAudioWindow()          [adapter]
→ seismic-audio-session.loadAudioWindow()  [application]
→ +page.svelte playLoaded()               [UI adapter]
→ CompressedSeismicPlayer.play()          [Web Audio adapter]
```

Live UDP mode:

```text
Raspberry Shake DATACAST UDP
→ bridge/server.ts UDP socket
→ parseDatacastPacket(...)
→ RollingRecorder.ingest(channel, timestamp, samples)
→ same /window browser flow
```

Raspberry Shake archive mode:

```text
+page.svelte selects archive station
→ GET /raspberryshake/window?station=RD432&...
→ loadRaspberryShakeTrace(...)
→ same bridge-client flow
```

Status flow:

```text
RollingRecorder.status(...)
→ WebSocket broadcast every second
→ connectStatus(...)
→ +page.svelte status display
```

## 󰜛 Important existing choices

- SvelteKit is used as a client-focused app.
- The long-running UDP/buffer service is a separate TypeScript bridge, not SvelteKit server code.
- Audio synthesis/playback lives in browser Web Audio.
- Timescale means **literal compressed replay**, not just smoothing responsiveness.
- Sound must stay safe: DC removal, normalization, filtering, saturation, limiter, fades.
- UI has normal controls plus fullscreen show mode.
- Default bridge mode is synthetic, so the gallery interface works without hardware.
- Provider switching (bridge ↔ Raspberry Shake archive) with full evidence feedback.
- LoadState machine: idle → loading → loaded/fallback/failed → stale → (reload).
- Audio settings fingerprint detects sound changes vs loaded window.

##  Known constraints / pitfalls

- Browsers cannot receive UDP directly.
- Browser audio requires a user gesture; keep **Begin listening** behavior.
- `$state` arrays/objects become proxies. Avoid comparing proxied objects with `===`; compare stable primitives like `seconds` or `label`.
- The browser smoke test proves Web Audio graph signal, not physical speaker output.
- `npm install` currently reports 3 low-severity dependency vulnerabilities.
- A true 24h live window only exists after the bridge has recorded 24h, unless archive/replay import is added later.
- `sonifier.ts` lives under `audio/` (legacy) but acts as a Web Audio adapter — it imports from `domain/sonification.ts` for pure DSP. Not yet moved to `adapters/`.
- `audio-state.ts` in domain imports types from `$lib/types` (cross-boundary layer). This is a mild boundary tension — domain shouldn't depend on the DTO layer. Refactor would move the types it needs into domain directly.

##  Remaining work (post hexagonal port)

See `todo.md` for completed items. Outstanding work:

### Sound quality
```text
src/lib/domain/sonification.ts   refine DSP params per mode
bridge/recorder.ts               improve resampling quality
```

### Bridge reliability
```text
bridge/server.ts                 better error responses, timeout handling
bridge/raspberryshake.ts         retry logic, more channels
```

### UI polish
```text
src/routes/+page.svelte          station status per-station, loading spinner
src/app.css                      responsive tuning, show mode glow
```

### Diagnostics
```text
scripts/browser-smoke.ts         upgrade to verify fingerprint change on setting switch
scripts/domain-diag.ts           add sonification DSP tests
```

### Boundary cleanup (nice-to-have)
```text
src/lib/audio/sonifier.ts  → src/lib/adapters/       (it's a Web Audio adapter)
audio-state.ts             fix domain → DTO import   (move AudioWindow into domain?)
```

## 󰶻 Last verified state

The app has been checked with:

```text
npm run check          ✅ 0 errors, 0 warnings
npm run build          ✅ success
npm run diagnose        ✅ all domain unit tests pass
npm run smoke:browser  ✅ bridge connected, audioDetected true
```
