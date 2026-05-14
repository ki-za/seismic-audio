# 󰜛 Algorithm Input Data Spec

> What the Tier 4 DSP algorithms actually receive — format, constraints, edge cases.
> Update this document whenever the signal path upstream changes.

---

##  Signal flow position

Algorithms operate at two injection points:

```
┌─────────────────────────────────────────────────┐
│ SEISMIC SOURCE                                   │
│ • 100 Hz integer counts from instrument          │
│ • 24-72 hr window captured into rolling buffer    │
│ • Time-compressed via playback rate increase      │
│   (e.g. 100 Hz source → 48 kHz rendered)          │
└───────────────────┬─────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ DOMAIN DSP (pure math, sync in workers)          │  ← INJECTION POINT A
│ • DC offset removal                              │     domain/sonification.ts
│ • Robust peak normalization (98th percentile)    │     prepareSamples()
│ • Edge fades (3% of buffer, capped 48k samples)  │
│ • Light gain per SoundMode (raw=0.7x, else=0.9x) │
│ Output: Float32Array, range [-1, +1]              │
└───────────────────┬─────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ WEB AUDIO CHAIN (browser nodes, real-time)       │  ← INJECTION POINT B
│ • BiquadFilter (highpass)                        │     sonifier.ts
│ • BiquadFilter (lowpass)                         │     configureChain()
│ • WaveShaperNode (tanh saturation)               │
│ • DynamicsCompressor (limiter)                   │
│ • GainNode (makeup gain)                         │
│ • AnalyserNode (meter)                           │
│ Output: AudioBuffer → speakers / WAV export       │
└─────────────────────────────────────────────────┘
```

---

## 󰜛 Injection Point A: Domain DSP (Float32Array)

### What you get

```ts
// The output of prepareSamples():
const prepared: Float32Array  // typed array, no allocation cost beyond creation
// Range: guaranteed [-1.0, +1.0]
// Length: equal to audio loop duration in samples
//   = playbackSeconds × renderedSampleRate
//   e.g. 60s × 48000Hz = 2,880,000 samples
```

### Properties

| Property              | Value                                            |
|-----------------------|--------------------------------------------------|
| Type                  | `Float32Array`                                   |
| Range                 | `[-1.0, +1.0]` clamped                          |
| Zero-centered         | Yes (DC offset removed)                          |
| Peak normalization    | 98th-percentile robust peak → scaled to near 1.0 |
| Sample rate           | `renderedSampleRate` (4k–48k Hz, see table)      |
| Channel count         | 1 (mono)                                         |
| Fades applied         | Linear fade-in/out over 3% of buffer (max 48k)   |
| Gain trim             | `raw` mode: 0.7x, other modes: 0.9x              |
| Expected loop length  | 5s – 300s (typically 60s for gallery)            |
| Memory (typical)      | 2,880,000 × 4 bytes = ~11 MB per loop            |

### Rendered sample rate by quality

| Quality             | Short loops (< 5 min) | Long loops (≥ 5 min) |
|---------------------|------------------------|-----------------------|
| `studio`            | 48,000 Hz              | 48,000 Hz             |
| `balanced`          | 48,000 Hz              | 16,000 Hz             |
| `installation-safe` | 32,000 Hz              | 12,000 Hz             |

### What's already baked in

The Float32Array you receive has already gone through:
- ✓ DC offset removal
- ✓ 98th-percentile robust normalization
- ✓ Edge fades (click prevention at loop boundaries)
- ✓ Hard clip to [-1, +1]
- ✓ Light output gain trim

**You do NOT need to re-normalize or re-center.**

### What's NOT yet done

- ❌ No filtering (happens downstream in Web Audio chain)
- ❌ No saturation (happens downstream in WaveShaperNode)
- ❌ No compression/limiting (happens downstream)
- ❌ No anti-aliasing (bridge resampling is linear interpolation)
- ❌ No de-clicking beyond edge fades
- ❌ No transient management
- ❌ No dithering
- ❌ No spatial processing
- ❌ No loudness normalization

### What you CAN do at Injection Point A

- Replace/fix the `prepareSamples` pipeline
- Add anti-aliasing pre-filtering
- Add transient de-clicking
- Add adaptive normalization
- Replace linear interpolation resampling (in `bridge/recorder.ts`)
- Add per-sample look-ahead processing (offline, heavy but acceptable for export)
- This code runs in workers or during offline render, not in the audio thread

---

## 󰜛 Injection Point B: Web Audio Node Chain

### Signal chain topology

```
AudioBufferSourceNode (looping)
  → BiquadFilterNode (highpass)
    → BiquadFilterNode (lowpass)
      → WaveShaperNode (tanh saturation)
        → DynamicsCompressorNode (limiter)
          → GainNode (makeup gain)
            → AnalyserNode (meter, fftSize=1024)
              → AudioContext.destination
```

### Current SoundMode parameters

| Mode      | Highpass | Lowpass  | Saturation amount | Makeup gain |
|-----------|----------|----------|--------------------|-------------|
| `raw`     | 8 Hz     | 12000 Hz | 1.1               | 0.35×       |
| `soft`    | 24 Hz    | 4200 Hz  | 1.4               | 0.32×       |
| `clear`   | 24 Hz    | 8000 Hz  | 2.2               | 0.42×       |
| `deep`    | 24 Hz    | 2600 Hz  | 1.8               | 0.38×       |
| `bright`  | 24 Hz    | 14000 Hz | 2.6               | 0.36×       |

### DynamicsCompressor defaults

| Param      | Default | After `applyFocus(event)` | After `applyFocus(texture)` | After `applyFocus(scientific)` |
|------------|---------|---------------------------|-----------------------------|-------------------------------|
| threshold  | -12 dB  | -8 dB                     | -18 dB                      | -6 dB                         |
| ratio      | 16:1    | 4:1                       | 18:1                        | 2:1                           |
| attack     | 3 ms    | 3 ms                      | 3 ms                        | 3 ms                          |
| release    | 180 ms  | 180 ms                    | 180 ms                      | 180 ms                        |
| knee       | 12 dB   | 12 dB                     | 12 dB                       | 12 dB                         |
| makeup     | 0 dB    | 0 dB                      | +2 dB                       | 0 dB                          |

### What you CAN do at Injection Point B

- Insert additional Web Audio nodes between existing ones
- Replace BiquadFilter with IIRFilterNode for custom filter shapes
- Swap WaveShaperNode curve for better saturation
- Add stereo widening via ChannelSplitter → ChannelMerger
- Add noise gate nodes
- Add a second AnalyserNode for frequency display
- **Cannot** run AudioWorklet unless we add the adapter (possible but complex)

---

## 󰜛 Resampling pipeline (bridge/recorder.ts)

### What happens in `makeWindow()`

```
seismic samples in rolling buffer (number[])
  ↓  select last N seconds
  ↓  calculate outputSampleCount = playbackSeconds × renderedSampleRate
  ↓  resample(input, outputCount)   ← linear interpolation
  ↓  AudioWindow.samples (number[])
  ↓  measureSamples() → AudioMetrics
  ↓  → sonifier.ts → prepareSamples() → Float32Array
```

### Resampling function

```ts
export function resample(input: ArrayLike<number>, outputCount: number): number[]
// Linear interpolation between nearest two input samples
// No anti-aliasing pre-filter
// No windowing function
// Output: standard number[] (not typed array)
```

### Typical compression ratios

| Source window | Playback | Source samples | Output samples | Ratio |
|---------------|----------|----------------|----------------|-------|
| 24 hours      | 60 sec   | 8,640,000      | 2,880,000      | 3:1   |
| 24 hours      | 120 sec  | 8,640,000      | 5,760,000      | 1.5:1 |
| 72 hours      | 300 sec  | 25,920,000     | 3,600,000      | 7.2:1 |

Relative compression from 100 Hz source to rendered rate is nominal (the "time compression" already happened by setting the buffer sample rate). The resample here is just matching buffer dimensions, not the primary sonification transform.

**The actual time compression happens when the AudioBuffer is created with `renderedSampleRate` and the 100 Hz seismic samples are played back at e.g. 48 kHz — a 480× speedup.**

---

## 󰜛 Key constraint summary

| Constraint             | Value                            |
|------------------------|----------------------------------|
| Real-time DSP budget   | < 10 ms per processing tick      |
| Offline export budget  | < 5 sec for 5-min loop           |
| Memory budget          | < 50 MB per audio window         |
| Browser target         | Web Audio API (no AudioWorklet yet) |
| External dependencies  | None (pure TypeScript/Web Audio) |
| Maintainability        | Must stay unit-testable in domain-diag.ts |
| Authenticity boundary  | See AUDIO_CONSTRAINTS.md — no synthesis, no AI generation |
| Mono compatibility     | Must not break when summed to mono |

---

## 󰜛 Edge cases algorithms must handle

1. **Complete silence** — dead air between events (common in seismic data)
2. **Single massive spike** — earthquake transient dominating normalization
3. **Near-zero sample rate** — installation-safe at 12 kHz (Nyquist = 6 kHz)
4. **Very short loops** — 5 seconds at 48 kHz = 240k samples (trivial)
5. **Very long loops** — 300 seconds at 12 kHz = 3.6M samples (moderate)
6. **Empty input** — zero samples (already handled by prepareSamples returning empty)
7. **DC drift over long windows** — 72 hours may have slow baseline wander
8. **Sample rate mismatch** — bridge may change rates between loads

---

## 󰜛 WAV export path (separate concern)

The export uses `OfflineAudioContext` → `audioBufferToWavBlob()`:
- 16-bit PCM, mono
- No dithering (truncation)
- Same chain as real-time playback
- Metadata sidecar JSON

---

_Last updated: 2026-05-10_
_Tied to branch: `tier4-sound-quality`_
