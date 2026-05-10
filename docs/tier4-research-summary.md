# Tier 4 Sound Quality: Codebase-Adapted Research

> Gateway document for implementing production DSP in the seismic-audio hexagonal codebase.
>
> This adapts the original `tier4-research-summary.md` (language-agnostic pseudocode catalog) to the specific TypeScript domain/adapter split of this project.
>
> Use alongside: `algorithm-input-spec.md` (data formats, injection points), `AUDIO_CONSTRAINTS.md` (authenticity boundary), `todo.md` (task tracking).

---

##  Where we are

```
raw seismic counts (bridge/recorder.ts)
  → linear-interpolation resampling   ←  artifact source #1
  → prepareSamples() (domain/sonification.ts)
  → Float32Array [-1, +1]
  → Web Audio chain (sonifier.ts)     ←  brittle native nodes only
  → speakers / WAV export
```

Two injection points (see `algorithm-input-spec.md`):

| Point | File | What it can do | Constraints |
|-------|------|----------------|-------------|
| **A** | `src/lib/domain/sonification.ts` | Pure DSP math, runs in workers/offline | No Web Audio API, must be unit-testable |
| **B** | `src/lib/audio/sonifier.ts` | Web Audio node graph | Browser-only, ~10ms real-time budget |

---

##  Hexagonal fit

The research summary's algorithms must be split into:

| Layer | Where | Examples |
|-------|-------|----------|
| **Domain** (ports) | `src/lib/domain/` | Resampler, limiter, LUFS meter, dither, de-clicker, multiband compressor — as pure functions on `Float32Array` |
| **Application** (use cases) | `src/lib/application/` | `RenderCoreExport` orchestrating domain DSP in sequence, `ConfigureRealtimeGraph` coordinating nodes |
| **Adapters** | `src/lib/audio/`, `bridge/` | Web Audio node wiring, WAV encoding with dither, recorder resampling upgrade |

Domain functions must:
- Accept/return `Float32Array` (or `number[]` for bridge compat)
- Have zero imports from `AudioContext`, `BiquadFilterNode`, etc.
- Be callable from `scripts/domain-diag.ts` for diagnostics
- Have no side effects beyond allocation

Adapters wire domain output into Web Audio nodes or file I/O.

---

##  Phase 1: Fix the foundation (P0)

Ship these first. They fix the "unacceptably bad" class of problems.

### 1.1 Polyphase Windowed-Sinc Resampler → `bridge/recorder.ts`

**What changes:** Replace `resample()` linear interpolation with polyphase windowed-sinc.

```ts
// domain port (in domain/sonification.ts or a new domain/resampling.ts)
export function resamplePolyphase(
  input: number[],
  outputLength: number,
  options: PolyphaseOptions
): Float32Array
```

**Why this repo needs it:** `bridge/recorder.ts` currently uses `function resample()` — straight linear interpolation. No anti-aliasing pre-filter. No windowing. This is artifact source #1: every resample creates imaging and high-frequency droop that later saturation/compression exaggerates.

**Pre-built helpers to reuse:** None exist yet. `estimateRobustPeak()` patterns show the codebase tolerates ~100k-stride subsampling for large arrays — the polyphase filter table is similar scope.

**Config knob:** Preview (16-32 taps) vs export (64-256 taps). Taps/phase count driven by `RenderQuality`.

---

### 1.2 Hampel Impulse Suppressor → `domain/`

**What changes:** New domain function `suppressImpulses(input: Float32Array, options): Float32Array`.

```ts
// domain/impulse.ts
export function suppressImpulses(
  input: Float32Array,
  options: { radius: number; thresholdMAD: number; maxRepairLength: number; blend: number }
): Float32Array
```

**Why this repo needs it:** `prepareSamples()` does edge fades for loop-boundary clicks, but does nothing for mid-buffer pops, sensor spikes, or resampling defects. The 98th-percentile robust peak normalization helps, but single-sample spikes still slip through and become audible ticks.

**Call site:** After `prepareSamples()`, before the Web Audio chain. In the offline export path, between normalization and tone stages.

---

### 1.3 Look-Ahead Limiter → `domain/`

**What changes:** Pure domain limiter function.

```ts
// domain/limiter.ts
export function lookAheadLimiter(
  input: Float32Array,
  sampleRate: number,
  options: { ceilingDb: number; lookAheadMs: number; releaseMs: number }
): Float32Array
```

**Why this repo needs it:** The current chain uses `DynamicsCompressorNode` with ratio 16:1 — this is a rough safety net, not a real mastering limiter. A single earthquake transient can still punch through and clip at the destination.

**Call site:** After tone/dynamics stages, before LUFS normalization. In `renderProcessedSeismicBuffer()` for offline export; as a domain pre-processor whose output feeds the Web Audio chain as pre-limited `Float32Array`.

---

### 1.4 LUFS Normalization → `domain/`

**What changes:** Integrated loudness measurement + gain application.

```ts
// domain/loudness.ts
export function measureIntegratedLUFS(input: Float32Array, sampleRate: number): number
export function normalizeLoudness(input: Float32Array, sampleRate: number, targetLUFS: number): Float32Array
```

**Why this repo needs it:** Currently there's no loudness normalization at all. Different seismic windows produce wildly different perceived loudness despite peak normalization. Gallery playback demands consistency — the curator shouldn't need to ride the gain knob.

**Call site:** Final stage of offline export chain, after limiting. The K-weighting filter is a domain concern (pure biquad math, no Web Audio needed).

---

### 1.5 TPDF Dither → `domain/` + `sonifier.ts`

**What changes:** Domain dither function + integration into WAV export.

```ts
// domain/dither.ts
export function applyTPDFDither(input: Float32Array, bitDepth?: number): Float32Array
export function floatToInt16WithDither(input: Float32Array): Int16Array
```

**Why this repo needs it:** `audioBufferToWavBlob()` truncates float samples directly to int16 — no dither, no noise shaping. Quiet tails turn gritty. This is the last step before PCM encoding.

**Call site:** In `sonifier.ts`, `audioBufferToWavBlob()` path. Domain function handles the math; adapter converts AudioBuffer → Float32Array → dithered Int16Array → WAV bytes.

---

##  Phase 2: Make it feel produced (P1)

Ship after P0. These create the gallery-quality lift.

### 2.1 Asymmetric Soft-Knee Saturation → `domain/`

**What changes:** Replace naive `tanh(x * amount)` curve generator with asymmetric soft-knee waveshaper.

```ts
// domain/saturation.ts
export function asymmetricSaturation(
  input: Float32Array,
  options: { drive: number; knee: number; asymmetry: number; wetDryMix: number; outputTrimDb: number }
): Float32Array
export function makeAsymmetricSaturationCurve(amount: number, knee: number, asymmetry: number): Float32Array
```

**Why this repo needs it:** `makeSaturationCurve()` currently generates `Math.tanh(x * amount)` — symmetric, no knee control. This is okay but thin. Asymmetric saturation adds even harmonics that read as warmth and density. The `Float32Array` curve version slots directly into `WaveShaperNode` for real-time; the pure function version processes offline export.

**Replaces/supplements:** `makeSaturationCurve()` in `domain/sonification.ts`, `configureChain()` in `sonifier.ts`.

---

### 2.2 Relative-Threshold De-Esser → `domain/` + `sonifier.ts`

**What changes:** Domain de-esser function + Web Audio adapter path.

```ts
// domain/deesser.ts
export function relativeDeEsser(
  input: Float32Array,
  sampleRate: number,
  options: { detectorFrequencyHz: number; relativeThresholdDb: number; maxReductionDb: number; attackMs: number; releaseMs: number }
): Float32Array
```

**Why this repo needs it:** Time-compressed seismic data concentrates energy in the upper band. Bright modes (`bright`, `clear`) are particularly harsh. Currently there's only a fixed `lowpass` filter per mode — blunt. The de-esser catches brightness spikes only when they exceed a relative threshold, preserving detail during balanced sections.

**Call site:** After de-clicking, before saturation. Domain function for offline export; a separate real-time adapter that inserts a dynamics node in the Web Audio chain (monitoring high-band energy and modulating a high-shelf filter).

---

### 2.3 Three-Band Multiband Compressor → `domain/`

**What changes:** Linkwitz-Riley crossover + per-band compression.

```ts
// domain/multiband.ts
export function threeBandCompressor(
  input: Float32Array,
  sampleRate: number,
  options: {
    lowCrossoverHz: number; highCrossoverHz: number;
    bands: [BandParams, BandParams, BandParams]
  }
): Float32Array
```

**Why this repo needs it:** The single `DynamicsCompressorNode` treats low rumble, mid activity, and high harshness as one blob. Multiband lets each region breathe differently. Phase-coherent crossovers (Linkwitz-Riley 4th order) ensure the bands sum cleanly.

**Call site:** Offline export chain. Real-time path may use three parallel `BiquadFilter` + `DynamicsCompressor` chains with a `ChannelSplitter`/`ChannelMerger` — or stay single-band in real-time and only go multiband on export.

---

### 2.4 Dynamic EQ / Adaptive Resonance Cut → `domain/`

**What changes:** Narrow-band dynamic gain reduction.

```ts
// domain/dynamic-eq.ts
export function dynamicResonanceCut(
  input: Float32Array,
  sampleRate: number,
  options: { frequencyHz: number; Q: number; thresholdDb: number; maxCutDb: number; attackMs: number; releaseMs: number }
): Float32Array
```

**Why this repo needs it:** Some seismic sensors produce whistling artifacts or resonance at specific frequencies. Static EQ would dull the signal everywhere. Dynamic EQ cuts only when that band gets rude. Complements the de-esser (which handles broadband top-end) with surgical band-specific control.

**Call site:** After de-clicking, before saturation.

---

### 2.5 Downward Expander With Comfort Noise → `domain/`

**What changes:** Soft noise gate with ambient noise bed.

```ts
// domain/expander.ts
export function expanderWithComfortNoise(
  input: Float32Array,
  sampleRate: number,
  options: {
    thresholdDb: number; ratio: number; maxDepthDb: number;
    attackMs: number; releaseMs: number;
    comfortNoiseLevelDb: number; noiseColor: "white" | "pink"
  }
): Float32Array
```

**Why this repo needs it:** Seismic data often has long quiet periods where only the noise floor is audible. Hard gating sounds broken. Dead air in a gallery feels like failure. A soft expander plus subtle comfort noise keeps the space alive during geological quiet.

**Call site:** Before limiter/LUFS.

---

### 2.6 Mono-Safe Pseudo-Stereo → `domain/` + `sonifier.ts`

**What changes:** Mid/side widening from delayed+filtered side signal.

```ts
// domain/stereo.ts
export function monoSafePseudoStereo(
  monoInput: Float32Array,
  sampleRate: number,
  options: { sideDelayMs: number; sideHighpassHz: number; sideLowpassHz: number; width: number }
): { left: Float32Array; right: Float32Array }
```

**Why this repo needs it:** Everything is currently mono (single-channel `AudioBuffer`). Gallery installations may have stereo speakers. Mid/side processing keeps the mono sum identical to the original — no comb filtering when the gallery sound system or subwoofer collapses to mono.

**Call site:** Late stage in the chain. Domain function for offline export (renders stereo WAV). Real-time adapter uses `ChannelSplitter` → delay + filter on side → `ChannelMerger`.

---

##  Phase 3: Polish (P2)

Ship after listening tests. Useful but easy to overdo.

### 3.1 Spectral Gate → `domain/` (offline only)

```ts
// domain/spectral-gate.ts
export function spectralGate(
  input: Float32Array,
  sampleRate: number,
  options: {
    fftSize: number; hopSize: number;
    noiseProfileDuration: number; reductionDb: number;
    spectralFloorDb: number
  }
): Float32Array
```

FFT-based noise reduction. Useful for windows with broadband hiss/static. **Offline only** — heavy compute. Risk: overuse creates metallic "musical noise" artifacts.

### 3.2 Noise-Shaped Dither → `domain/`

```ts
// domain/dither.ts (add)
export function floatToInt16WithNoiseShapedDither(input: Float32Array): Int16Array
```

Option alongside TPDF for slightly cleaner low-level decay. Neutral if file may be further processed; cleaner for final listener exports.

---

##  Phase 4: Artistic modes (P3)

Ship behind explicit creative mode flags. These change signal identity — good art tools, not neutral science tools.

Per `AUDIO_CONSTRAINTS.md`, these require:
- Explicit artistic-mode labeling in UI
- Not active in `raw` comparison mode
- Described as "creative treatment" not "seismic representation"

| Algorithm | Domain file | Notes |
|-----------|-------------|-------|
| Tape-style saturation | `domain/saturation.ts` | Hysteresis + HF damping variant |
| Harmonic exciter | `domain/exciter.ts` | Upper harmonics from high-passed branch |
| Wavefolder | `domain/wavefolder.ts` | Band-limit input first, oversample |
| Wow/flutter | `domain/modulation.ts` | Slow delay modulation for living loops |
| Haas widening | `domain/stereo.ts` | Fast but risky — test mono collapse |

---

## 󰘓 Phase-by-phase execution order

### P0 (deliver "technically trustworthy")

```
resamplePolyphase (bridge/recorder.ts)
  → suppressImpulses (domain/)
    → prepareSamples (domain/sonification.ts — already exists, may tune)
      → [Web Audio tone chain] (sonifier.ts — already exists)
        → lookAheadLimiter (domain/)
          → normalizeLoudness (domain/)
            → applyTPDFDither (domain/)
              → audioBufferToWavBlob (sonifier.ts — adapt)
```

### P1 (deliver "gallery-produced")

```
[after de-clicking, before Web Audio chain]
  → relativeDeEsser
    → dynamicResonanceCut (if needed)
      → threeBandCompressor
        → asymmetricSaturation
          → expanderWithComfortNoise
            → [existing chain continues]
              → monoSafePseudoStereo (if stereo enabled, late stage)
```

---

## 󰜛 Codebase touch points

### Files that will change

| File | Change type | What |
|------|-------------|------|
| `src/lib/domain/sonification.ts` | Extend | Add resampler, limiter, saturation functions; keep existing `prepareSamples()` |
| `src/lib/domain/` | **New files** | `impulse.ts`, `limiter.ts`, `loudness.ts`, `dither.ts`, `deesser.ts`, `multiband.ts`, `saturation.ts`, `dynamic-eq.ts`, `expander.ts`, `stereo.ts` |
| `src/lib/domain/types.ts` | Extend | Add `PolyphaseOptions`, `LimiterParams`, `DeEsserParams`, `MultibandParams`, etc. — all domain value types |
| `src/lib/audio/sonifier.ts` | Extend | Wire new domain output into Web Audio; add dither to WAV export; add stereo adapter |
| `bridge/recorder.ts` | Change | Replace `resample()` with polyphase; keep backward compat |
| `scripts/domain-diag.ts` | Extend | Diagnostics for every new domain function |
| `src/lib/application/` | **New files** | `render-core-export.ts` (orchestrates full P0+P1 chain for offline) |

### Files that stay put

| File | Reason |
|------|--------|
| `src/lib/types.ts` | Cross-boundary DTOs — re-exports domain types, no DSP logic here |
| `AUDIO_CONSTRAINTS.md` | Authenticity boundary — already complete, algorithms must respect it |
| `RESEARCH.md` | Historical reference — describes original p5.js sketch, not current codebase |
| Existing `SoundMode` / `ListeningFocus` types | These remain the UI-driven configuration surface; algorithms respect them as parameters |

---

## 󰘓 Design decisions (adapting the research summary)

| Original assumption | Codebase reality | Adaptation |
|---------------------|-----------------|------------|
| "mono floating-point buffer after initial preparation" | `Float32Array` from `prepareSamples()` — already mono, normalized, faded | ✅ Direct match. Domain functions accept `Float32Array` |
| "generic functions: lowpass, highpass, fft" | No helper library exists | Must implement biquad filters, FFT, and window functions as domain helpers. Build once, share across algorithms. |
| "language-agnostic" | TypeScript in domain layer, Web Audio API in adapters | Domain = pure TS functions. Adapter = `BiquadFilterNode`, `WaveShaperNode`, etc. |
| "real-time browser chain without custom audio processor" | We DO have `CompressedSeismicPlayer` with pre-wired nodes | P0+P1 domain output feeds into the existing chain as pre-processed `Float32Array`. Real-time-specific algorithms (de-esser, multiband) get simplified Web Audio adapter versions. |
| "export path: OfflineAudioContext" | `renderProcessedSeismicBuffer()` already does this | Domain DSP runs BEFORE `OfflineAudioContext`. The offline context only handles gain staging and final output — or we bypass it entirely and write PCM directly from domain output. |

---

##  Open decisions

These need alignment before implementation:

1. **Realtime de-esser strategy:** Domain-only (pre-process Float32Array before Web Audio) vs. real-time `BiquadFilterNode` + envelope detection + gain modulation? Pre-processing is simpler but not adaptive during playback. Real-time is harder but responds to live data changes.

   *Recommendation:* Phase 1 = domain-only (offline export quality). Phase 2 = real-time adapter if gallery testing shows need.

2. **Multiband compressor in real-time:** Three-band splitter/merger in Web Audio is feasible with 6 `BiquadFilterNode` instances + 3 `DynamicsCompressorNode` instances, but adds ~6ms latency and complexity. Worth it?

   *Recommendation:* Not for P0/P1 real-time. Use domain multiband for offline export. Real-time stays single-band with improved compressor settings.

3. **LUFS measurement at 12 kHz:** K-weighting filter and LUFS measurement assume at least 44.1 kHz. At `installation-safe` 12 kHz, the high-frequency shelf will be misaligned.

   *Recommendation:* Test at all three sample rates. Implement resampling to 48 kHz internally for measurement, then apply gain at original rate.

4. **Stereo output format:** Currently mono WAV export. Adding stereo means changing `AudioBuffer` channel count (1 → 2), adjusting `audioBufferToWavBlob()`, and potentially doubling memory for stereo modes.

   *Recommendation:* Keep mono as default. Stereo is an opt-in `SoundMode` variant or export option. Don't pay the memory cost unless the user enables it.

---

## 󰶻 What this document replaces

This adapted version **supersedes** the original `tier4-research-summary.md` for implementation purposes. The original remains as a reference for:
- Pseudocode detail of individual algorithms
- Parameter ranges and rationale
- Full testing checklist

When implementing an algorithm, consult **both** documents:
- **This doc:** Where does it go in the hexagonal codebase? What files change? What types are needed?
- **Original doc:** What's the pseudocode? What parameters? What edge cases?

---

_Adapted: 2026-05-10_
_From: tier4-research-summary.md v1 (language-agnostic algorithm catalog)_
_To: Seismic-audio hexagonal codebase (TypeScript domain + Web Audio adapters)_
