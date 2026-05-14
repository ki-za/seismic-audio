#  Tier 4 Rollout Plan — Stage 2: Complete P0 → Start P1

> Based on analysis of commits `79749d5` through `28892c5` and gap audit of `audio-algorithms-catalog.md` + `tier4-research-summary.md`.

---

##  P0 Completion (what remains)

The P0 algorithms ARE implemented. The integration has two gaps:

### Gap 1: Orchestrator not wired to export path ( blocker for domain-only export)

| What | Where | Status |
|---|---|---|
| `renderCoreExport()` exists | `application/render-core-export.ts` | ✅ Created |
| Called from anywhere | — | ❌ Not wired |

**Current export path** (`browser-audio.ts` → `sonifier.ts` → `renderProcessedSeismicBuffer`):
```
prepareSamples → suppressImpulses → [Web Audio chain via OfflineAudioContext] → audioBufferToWavBlob → TPDF dither
```

This runs impulse suppressor, then feeds everything through Web Audio — missing the look-ahead limiter, LUFS, and the pure-domain benefit.

**Target export path:**
```
prepareSamples → suppressImpulses → lookAheadLimiter → normalizeLoudness → [optional Web Audio tone shaping] → floatToInt16WithDither → WAV
```

### Gap 2: Multi-channel dither uses naive truncation ()

| What | Where | Status |
|---|---|---|
| `floatToInt16WithDither()` for mono | `sonifier.ts` L241–245 | ✅ |
| Multi-channel uses naive `Math.max(-1, Math.min(1, …))` truncation | `sonifier.ts` L249–259 | ❌ Naive |

---

##  Execution Plan

### Stage 2a — Complete P0 Integration (1 session)

| Step | File | What |
|---|---|---|
| **A1** | `adapters/browser-audio.ts` | Wire `renderCoreExport` into `renderWavFile`. After the domain chain, push through `OfflineAudioContext` for Web Audio tone shaping (optional — skip if `raw` mode), then to `audioBufferToWavBlob`. |
| **A2** | `audio/sonifier.ts` L249–259 | Fix multi-channel branch: call `floatToInt16WithDither()` per channel instead of naive clamping. |
| **A3** | `audio/sonifier.ts` | Expose `renderProcessedSeismicBufferRaw` — a version that runs domain chain only (no Web Audio), or add a `skipWebAudio` flag. So the orchestrator path and the Web Audio path are both callable. |
| **A4** | `scripts/diag-batch-e.ts` | Integration diag: full chain with real `AudioWindow`-shaped input, verify all stages produce valid output, verify multi-channel dither. |
| **A5** | `todo.md` | Mark Tier 4 complete, create Tier 5-P1 section. |

### Stage 2b — P1 Algorithms (6 sessions, 1 per algorithm)

Each follows the same pattern: domain function + diag batch + integration.

#### 2b.1 Asymmetric Soft-Knee Saturation (`domain/saturation.ts`)

- Creates `asymmetricSaturation()` and `makeAsymmetricSaturationCurve()` per catalog §9
- Replaces `makeSaturationCurve()` (tanh) in `configureChain()` for offline export
- Real-time uses `WaveShaperNode` + the new curve
- **Types added:** `SaturationParams` to `domain/types.ts`
- **Diag:** `scripts/diag-batch-f.ts` (15–20 checks)
- **Integration:** `sonifier.ts` `configureChain()` — swap curve generator

#### 2b.2 Relative-Threshold De-Esser (`domain/deesser.ts`)

- Creates `relativeDeEsser()` per catalog §12
- **Types added:** `DeEsserParams` to `domain/types.ts`
- **Diag:** `scripts/diag-batch-g.ts` (15–20 checks)
- **Integration:** `renderCoreExport` chain, after `suppressImpulses`, before saturation

#### 2b.3 Three-Band Multiband Compressor (`domain/multiband.ts`)

- Creates `threeBandCompressor()` per catalog §11
- Requires Linkwitz-Riley crossover filters (pair of lowpass + subtraction)
- **Types added:** `BandCompressorParams`, `MultibandParams` to `domain/types.ts`
- **Diag:** `scripts/diag-batch-h.ts` (15–20 checks)
- **Integration:** `renderCoreExport` chain, between de-esser and saturation

#### 2b.4 Dynamic EQ / Adaptive Resonance Cut (`domain/dynamic-eq.ts`)

- Creates `dynamicResonanceCut()` per catalog §13
- **Types added:** `DynamicEqParams` to `domain/types.ts`
- **Diag:** `scripts/diag-batch-i.ts` (15–20 checks)
- **Integration:** `renderCoreExport` chain, after de-esser, before compressor

#### 2b.5 Expander + Comfort Noise (`domain/expander.ts`)

- Creates `expanderWithComfortNoise()` per catalog §14
- Needs a deterministic PRNG for reproducibility (reuse xorshift32 from dither.ts or extract shared)
- **Types added:** `ExpanderParams` (including `NoiseColor`) to `domain/types.ts`
- **Diag:** `scripts/diag-batch-j.ts` (15–20 checks)
- **Integration:** `renderCoreExport` chain, after saturation, before limiter

#### 2b.6 Mono-Safe Pseudo-Stereo (`domain/stereo.ts`)

- Creates `monoSafePseudoStereo()` per catalog §15
- Returns `{ left: Float32Array; right: Float32Array }`
- **Types added:** `PseudoStereoParams` to `domain/types.ts`
- **Diag:** `scripts/diag-batch-k.ts` (verify mid/side math, mono-sum identity)
- **Integration:** `renderCoreExport` chain, last stage before dither/WAV
- Also: `audioBufferToWavBlob` needs stereo support (multi-channel dither already handled in A2)

---

### Stage 2c — P1 Chain Integration (1 session)

Once all P1 algorithms exist:

- Update `renderCoreExport` to accept P1 skip flags and params
- Set sensible default chain order: `de-esser → dynamic EQ → multiband compressor → saturation → expander → [limiter → LUFS]`
- Add `pseudoStereo` as final pre-WAV stage (if enabled)
- `diag-batch-l.ts`: end-to-end integration with all stages

---

## 󰜛 Risk Register

| Risk |  Impact | Mitigation |
|---|---|---|
| `renderCoreExport` vs `renderProcessedSeismicBuffer` — two export paths diverge | Copy-paste bug farms | Provide `skipWebAudio` flag on one function. Don't maintain two separate chains. |
| Multi-band compressor crossover phase errors | Audible artefacts at band edges | Verify band reconstitution in diag (sine sweep → sum → null test) |
| Pseudo-stereo doubles buffer count → doubles dither | Twice the compute, WAV size doubles | Only enable when stereo gallery export is explicitly requested. Keep mono as default. |
| P1 algorithms not wired into real-time preview chain | Users test quality only on export | P1 domain functions get a "quick-adapt" path: `WaveShaperNode` for saturation, `BiquadFilter` envelope follower for de-esser. But scope for Stage 3. |
| All P1 algorithms are pure-domain functions but the Web Audio chain (`sonifier.ts` `configureChain`) still uses naive `tanh` curve, simple `DynamicsCompressorNode` | Inconsistent real-time vs export quality | **Decision needed:** Do we adapt P1 for real-time, or accept export-only for now? The `tier4-research-summary.md` §Recommendation says "Phase 1 = domain-only (offline export quality). Phase 2 = real-time adapter if gallery testing shows need." |

---

## 󰘓 Key Decisions Before Starting

1. **`renderProcessedSeismicBuffer` vs `renderCoreExport` — merge or coexist?**
   - Recommend: merge. `renderProcessedSeismicBuffer` gets an optional `skipWebAudio` flag. When true, run domain chain only. When false, also apply Web Audio tone shaping. This keeps one function, one call site.

2. **Real-time P1 adapters — now or later?**
   - The research summary recommends later ("if gallery testing shows need"). The `configureChain` in `sonifier.ts` stays with current Web Audio defaults. P1 domain functions run on export only. This is simpler and aligns with the doc.
   - Exception: `makeAsymmetricSaturationCurve()` replaces `makeSaturationCurve()` for both paths — it's a pure curve update, zero cost.

3. **xorshift32 PRNG extraction?**
   - Currently lives in `domain/dither.ts`. The expander also needs a deterministic RNG. Extract `xorshift32` into `domain/dsp.ts` (alongside `clamp`, `smoothEnvelope`, `dbToLinear`, `linearToDb`) or a new `domain/prng.ts`.

---

## 󰶻 Expected Output

After Stage 2a–2c:
- ~10 new domain files (saturation, deesser, multiband, dynamic-eq, expander, stereo + types per module)
- ~8 new diag scripts (A5 + F-K + L)
- ~2000 LOC new code
- P0 fully integrated and diagnosable
- P1 domain functions ship-ready, integration lags behind with `skip*` flags

After Stage 3 (P1 real-time adapters, future):
- `configureChain` upgraded with P1 Web Audio paths
- Gallery-real-time quality matches offline export
