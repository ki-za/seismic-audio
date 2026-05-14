#  Executable Research Task: Audio DSP Catalog for Seismic Sonification

## Context (compressed)

We sonify compressed seismic data (24–72 hr earth motion → 1–5 min audio).
Source: 100 Hz integer instrument counts, time-compressed 480× (100 Hz → 48 kHz) by playback rate manipulation.
Result: harsh, narrow, clicky, fatiguing audio from transients + instrument noise pitch-shifted together.

Pipeline: DC removal → peak norm → edge fades → HP/LP filter → tanh sat → compressor → makeup gain → export.

Architecture: pure math in `domain/sonification.ts` (Float32Array in/out), Web Audio nodes in `sonifier.ts`, linear-interp resampling in `bridge/recorder.ts`.

Goal: **warmer, denser, less harsh, more interesting** — gallery-installation quality — without disguising the earth signal.

Full input spec: `docs/algorithm-input-spec.md`
Ethical constraints: `AUDIO_CONSTRAINTS.md` (no synthesis, no AI generation, must keep raw comparison mode)

## Task

Research and catalog **real** production audio DSP algorithms for this pipeline.
Write to: `docs/audio-algorithms-catalog.md`

Cover these categories (at least 2–3 concrete algorithms each):

1. **Anti-aliasing resampling** — windowed-sinc, polyphase, Lanczos — for bridge/recorder.ts
2. **Transient management** — look-ahead peak limiting, auto-declick, transient shapers
3. **Saturation/harmonics** — analog-modeled curves (tape, tube, transformer), asymmetric, wavefolder
4. **Multiband dynamics** — 3-band compressor, Linkwitz-Riley crossovers, per-band control
5. **De-essing / HF control** — freq-dependent compression, dynamic EQ, spectral tilt
6. **Stereo widening** — Haas, mid-side, comb-based pseudo-stereo (mono-compatible)
7. **LUFS loudness** — ITU-R BS.1770, EBU R128, real-time vs offline
8. **Noise floor management** — spectral gate + comfort noise, envelope followers
9. **Dithering** — TPDF, noise-shaped, appropriate for 16-bit export
10. **Subtle modulation** — slow filters, tape wow/flutter, gentle drift (artistic modes)

For each algorithm:
- Name + one-line description
- Signal flow position (pre-normalization? post-compression?)
- Parameter space + typical ranges
- Computational cost: trivial / cheap / moderate / expensive
- Web Audio implementation: native node? AudioWorklet only? offline only?
- Aesthetic contribution: what the listener hears differently
- Real-world equivalent: name a VST or paper that does this
- Priority: 🔴 P0 essential | 🟡 P1 high-impact | 🟢 P2 nice | ⚪ P3 artistic
- Mode: core or artistic

## Deliverable structure

```markdown
# Audio DSP Algorithms Catalog

## 1. Anti-Aliasing Resampling

### 1.1 Windowed-Sinc (Lanczos)
...
### 1.2 Polyphase FIR
...

## 2. Transient Management
...
```

Be thorough. Name real techniques, real papers, real plugins. No fictional algorithms.
This document directly drives our Tier 4 implementation.
