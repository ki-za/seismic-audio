# Technical Design — Provider Switching + Audible Feedback

## Aim

Make provider/station switching and audio setting changes trustworthy.

The UI must show the difference between:

```text
selected ≠ connected ≠ loaded ≠ playing ≠ audibly changed
```

Design language should stay minimal: enough state, evidence, and feedback to know what happened; no extra dashboard chrome.

---

## Final UI shape

Composite chosen from:

- Source Journey for the main flow
- Control Room evidence where trust matters
- Station Browser state where station status matters

```text
┌─────────────────────────────────────────────────────────────┐
│ Bridge: ● connected   Mode: synthetic   Buffer: 3m13s SYN   │
├─────────────────────────────────────────────────────────────┤
│ 1. Source                                                   │
│ [ Local Bridge ] [ Raspberry Shake Archive ]                │
│ Provider note: archive uses data.raspberryshake.org, -35m   │
├─────────────────────────────┬───────────────────────────────┤
│ 2. Station                  │ 3. Loaded Evidence            │
│                             │                               │
│ ● Synthetic/LAN  available  │ State: not loaded / stale     │
│ ○ RD432          untested   │ Source: —                     │
│ ○ R5022          failed     │ NSLC:   —                     │
│ ○ RCA97          available  │ Range:  —                     │
│ ○ R83E1          fallback   │ Render: —                     │
│ ○ R5156          loaded     │ Audio:  —                     │
├─────────────────────────────┴───────────────────────────────┤
│ 4. Time + Render                                             │
│ Source window: [15m] [1h] [6h] [24h] [48h] [72h]            │
│ Audio length:   [10s] [30s] [1m] [5m]                       │
│ Quality:        [Studio] [Balanced] [Installation-safe]      │
├─────────────────────────────────────────────────────────────┤
│ 5. Sound                                                     │
│ Character: [soft] [clear] [raw] [deep] [bright]              │
│ Focus:     [gentle] [event] [texture] [scientific-ish]       │
│ Compressor: threshold ratio attack release makeup            │
├─────────────────────────────────────────────────────────────┤
│ [ Load Window ] [ Play Loaded Loop ] [ Stop ] [ Export ]     │
└─────────────────────────────────────────────────────────────┘
```

After a successful Raspberry Shake load:

```text
┌─────────────────────────────────────────────────────────────┐
│ Bridge: ● connected                                         │
│ Provider: Raspberry Shake Archive · data.raspberryshake.org │
├─────────────────────────────────────────────────────────────┤
│ Station: R5156 · loaded                                     │
│ Target:  AM.R5156.00.EHZ                                    │
│ Actual:  AM.R5156.00.EHZ                                    │
│ Range:   2026-05-08 21:06:00 → 22:06:00 UTC                 │
│ Source:  100 Hz · 360,000 source samples                    │
│ Render:  12 kHz · 3,600,000 audio samples                   │
│ Shape:   1 hour source → 5 min loop                         │
│ Sound:   soft · scientific-ish · compressor hash 8f12        │
│ Audio:   playing · RMS 0.18 · changed 400ms ago             │
└─────────────────────────────────────────────────────────────┘
```

---

## Hexagonal architecture boundary

Decision rule: if it does I/O or depends on browser/server APIs, it is outside the hexagon.

```text
┌─────────────────────────────────────────────────────────────┐
│ Adapters                                                    │
│                                                             │
│ Svelte UI       HTTP bridge client       Web Audio adapter  │
│ Bridge HTTP     Raspberry Shake client   Diagnostics runner │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Application                                         │   │
│   │                                                     │   │
│   │ LoadAudioWindow use case                            │   │
│   │ SelectProvider use case                             │   │
│   │ BuildAudioRenderPlan use case                       │   │
│   │ CompareAudioSettings use case                       │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐   │   │
│   │   │ Domain                                      │   │   │
│   │   │ ProviderId, StationId, NSLC                 │   │   │
│   │   │ AudioWindowSpec, RenderPlan                 │   │   │
│   │   │ LoadState, AudioSettingsFingerprint         │   │   │
│   │   └─────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Inside hexagon

Pure TypeScript types and rules:

- provider/station state machine
- stale/loaded decision rules
- render sample-rate plan
- audio settings fingerprint
- “did the selected config match the loaded config?” checks
- metadata shape for evidence panels

### Outside hexagon

Adapters:

- Svelte component event handlers
- browser `fetch`
- bridge HTTP routes
- WebSocket bridge status
- Web Audio / OfflineAudioContext
- Raspberry Shake / seisplotjs
- Playwright smoke tests

---

## Current data already available

### Bridge status

From `BridgeStatus`:

```ts
type BridgeStatus = {
  mode: 'synthetic' | 'udp';
  udpPort: number;
  channels: string[];
  samplesStored: number;
  secondsStored: number;
  latestTimestampMs: number | null;
  startedAtMs: number;
};
```

Useful UI evidence:

```text
Bridge connected
Mode synthetic / UDP
UDP port
Channels seen
Buffered seconds
Latest sample age
Bridge uptime
```

### Loaded audio window

From `AudioWindow`:

```ts
type AudioWindow = {
  channel: string;
  windowSeconds: number;
  playbackSeconds: number;
  sourceSampleRate: number;
  renderedSampleRate: number;
  samples: number[];
  availableSeconds: number;
  network?: string;
  station?: string;
  location?: string;
  startISO?: string;
  endISO?: string;
  source?: 'bridge' | 'raspberryshake';
};
```

Useful UI evidence:

```text
Provider actually loaded
Network/station/location/channel actually used
Archive start/end time
Source sample rate
Rendered sample rate
Rendered sample count
Available source seconds
Compression ratio: source window → playback duration
```

### Browser smoke data

Current smoke script already detects:

```text
bridgeStatus text
audioMeter level
audioDetected boolean
error text
console messages
page errors
```

This proves “some audio happened”, but does not yet prove “the intended setting change produced a different render/playback chain”.

---

## Data needed for trustworthy provider switching

Add load metadata to archive responses.

```ts
type ChannelAttempt = {
  channel: string;
  status: 'ok' | 'empty' | 'error';
  error?: string;
};

type AudioLoadMetadata = {
  loadedAtISO: string;
  requestHost?: string;
  delayMinutes?: number;
  requestedStartISO?: string;
  requestedEndISO?: string;
  requestedChannel?: string;
  actualChannel: string;
  channelFallbackOrder?: string[];
  attemptedChannels?: ChannelAttempt[];
};
```

Extend `AudioWindow`:

```ts
type AudioWindow = {
  // existing fields...
  metadata?: AudioLoadMetadata;
};
```

This enables UI states:

```text
untested  station has never been loaded this session
loading   request in progress
loaded    selected station/window matches loaded evidence
fallback  station loaded, but not on preferred channel
failed    request failed; show last error
stale     user changed provider/station/window/quality after load
```

---

## Data needed to validate audio setting changes

Problem: turning a knob can sound subtle. The UI and diagnostics need proof that the app applied a new chain.

### Add an audio settings fingerprint

Pure domain/application value:

```ts
type AudioSettingsSnapshot = {
  soundMode: SoundMode;
  listeningFocus: ListeningFocus;
  compression: CompressionSettings;
  renderQuality: RenderQuality;
  playbackSeconds: number;
  renderedSampleRate: number;
};

type AudioSettingsFingerprint = string;
```

The fingerprint changes when any sound-affecting setting changes.

Example display:

```text
Sound settings changed · pending replay
Current: soft / scientific-ish / 8f12
Loaded:  soft / gentle / 2c9a
```

### Add render/audio metrics

When preparing or rendering audio, collect cheap statistics.

```ts
type AudioMetrics = {
  sampleCount: number;
  sampleRate: number;
  durationSeconds: number;
  rms: number;
  peak: number;
  mean: number;
  zeroCrossingRate?: number;
};
```

Use metrics for feedback:

```text
Rendered 3,600,000 samples @ 12 kHz
RMS changed 0.11 → 0.18
Peak changed 0.42 → 0.71
```

### Add playback confirmation

The current audio meter is a good start. Add structured playback state:

```ts
type PlaybackState = {
  state: 'stopped' | 'starting' | 'playing' | 'failed';
  startedAtMs?: number;
  contextState?: AudioContextState;
  activeFingerprint?: string;
  activeWindowId?: string;
  meterLevel: number;
  lastMeterChangeAtMs?: number;
};
```

This lets the UI say:

```text
Playing loaded loop
AudioContext: running
Meter: active
Settings: applied
```

or:

```text
Settings changed after playback started
Restart loop to hear new compressor settings
```

---

## Load and change state rules

### Provider/station/window changes

```text
User changes provider       → loaded window becomes stale
User changes station        → loaded window becomes stale
User changes source window  → loaded window becomes stale
User changes playback time  → loaded window becomes stale
User changes render quality → loaded window becomes stale
```

Reason: these alter the fetched/rendered sample array.

### Sound setting changes

```text
User changes sound character → playback chain becomes stale
User changes focus           → playback chain becomes stale
User changes compressor      → playback chain becomes stale
```

These do not require refetching source data, but they do require replay or re-render to hear/export the change.

UI copy:

```text
Sound changed. Restart loop to hear it.
```

or if live re-application is later implemented:

```text
Sound changed. Applied live.
```

### Export rules

Export should include metadata proving what was exported:

```text
loadedWindowId
audioSettingsFingerprint
renderMetrics
exportedAtISO
```

---

## Minimal implementation plan

### Phase 1 — evidence without architecture churn

- Add `loadedWindow` evidence panel.
- Add explicit `Load Window` button.
- Track `loadedRequestKey` vs `selectedRequestKey`.
- Show `stale` when they differ.
- Show `actual channel` from `AudioWindow.channel`.
- Show source/render sample rates and sample count.

### Phase 2 — trustworthy archive fallback

- Return `attemptedChannels` from `bridge/raspberryshake.ts`.
- Return `delayMinutes`, `requestHost`, `loadedAtISO`.
- Show fallback result in station card and evidence panel.

### Phase 3 — audio-change feedback

- Add audio settings fingerprint.
- Add prepared/rendered audio metrics.
- Show whether current playback matches current settings.
- Update browser smoke to change one audio setting and verify fingerprint/metrics changed.

### Phase 4 — cleaner hexagonal split

Move pure rules into domain/application modules:

```text
src/lib/domain/provider-state.ts
src/lib/domain/audio-settings.ts
src/lib/domain/audio-metrics.ts
src/lib/application/load-window-state.ts
src/lib/application/render-plan.ts
```

Keep adapters thin:

```text
src/lib/data/bridge.ts          fetch adapter
src/lib/audio/sonifier.ts       Web Audio adapter
src/routes/+page.svelte         UI adapter
bridge/raspberryshake.ts        external archive adapter
```

---

## Diagnostic upgrades

Current `npm run diagnose` should eventually print:

```json
{
  "providerSwitch": {
    "requested": "AM.R5156.00.EHZ",
    "actual": "AM.R5156.00.EHZ",
    "state": "loaded",
    "attemptedChannels": [
      { "channel": "EHZ", "status": "ok" }
    ]
  },
  "render": {
    "windowSeconds": 3600,
    "playbackSeconds": 300,
    "renderedSampleRate": 12000,
    "sampleCount": 3600000,
    "durationSeconds": 300
  },
  "audioChange": {
    "beforeFingerprint": "2c9a",
    "afterFingerprint": "8f12",
    "fingerprintChanged": true,
    "beforeRms": 0.11,
    "afterRms": 0.18,
    "metricsChanged": true,
    "audioDetected": true
  }
}
```

This gives feedback that:

1. the provider/station connection loaded real data,
2. fallback behavior is visible,
3. rendering used the expected performance mode,
4. browser audio actually started,
5. changing audio settings changed the applied audio chain.

---

## Acceptance criteria

A user should be able to answer from the UI alone:

```text
Am I connected to the bridge?
Which provider is selected?
Has this station actually loaded?
Which channel was actually used?
What time range did I get?
How much source data was available?
What render rate/sample count am I hearing?
Did my audio setting change apply?
Do I need to reload, replay, or export again?
```

If the UI can answer those, provider switching is trustworthy enough for the next prototype stage.
