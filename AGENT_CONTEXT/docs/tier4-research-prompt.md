# Tier 4 Research Prompt: Production Audio Quality for Seismic Sonification

##  Context

We're building a seismic audio sonification app. The input is **massively time-compressed seismic waveform data** — typically 24–72 hours of ground motion squeezed into 1–5 minutes of audio. The raw data is integer instrument counts at ~100 Hz, accelerated to 4–48 kHz by changing effective playback rate.

The source is inherently harsh and narrow: transients from earthquakes, ambient microseisms, and instrument noise all get pitch-shifted into the audible range together. Noisy, clicky, fatiguing.

We need to make it listenable — gallery-installation quality — without disguising the earth signal beyond recognition.

The app uses a hexagonal architecture: domain/sonification.ts holds pure DSP math, and a Web Audio adapter (`src/lib/audio/sonifier.ts`) wires it into live playback. The bridge recorder (`bridge/recorder.ts`) handles offline resampling for export.

##  Current State

### What we have now
- **DC offset removal** + **98th-percentile robust normalization**
- **Edge fades** (3% of buffer, capped at 48k samples)
- **tanh saturation** via WaveShaperNode
- **DynamicsCompressor** as limiter
- **makeup gain**
- **SoundModes** with different filter pairs (raw, soft, clear)
- **Linear interpolation resampling** in bridge/recorder.ts (no anti-aliasing)
- **Chunked processing** for large arrays with progress reporting

### What's missing for production quality
1. **No anti-aliasing pre-filter** on resampling — aliasing artifacts from time compression
2. **No de-clicking** beyond simple edge fades — transient spikes cause pops
3. **No multi-band dynamics** — single DynamicsCompressor treats all frequencies equally
4. **No de-essing** — harsh high-frequency artifacts from instrument noise getting pitch-shifted
5. **No stereo widening / spatialization** — mono only
6. **No loudness normalization** (LUFS) — just peak normalization
7. **No proper dithering** — 16-bit truncation on export
8. **Saturation curve is naive tanh** — no overdrive character, no soft-clip knee
9. **Filter parameters are static per SoundMode** — no adaptive filtering based on input character
10. **No noise floor gating** — silence during quiet seismic periods sounds like dead air

##  Research Request

Please research and catalog production-ready audio DSP algorithms suitable for this pipeline. The goal is **aesthetic improvement** — warmer, denser, less harsh, more interesting — while preserving the seismic character of the source.

### Algorithm categories to research

#### 1. Anti-aliasing for extreme time compression
When 100 Hz seismic data gets replayed at 48 kHz, we're doing 480x upsampling. Linear interpolation is cheap but introduces imaging artifacts. Need:
- Windowed-sinc interpolation (Lanczos, Kaiser)
- Polyphase resampling
- What's practical in real-time vs offline export

#### 2. Transient management (de-clicking / de-popping)
Seismic events produce sharp transients that become audible pops after time compression. Need:
- Look-ahead peak limiting with soft clipping
- Transient shapers (attack/release envelope control)
- Auto-declick algorithms that don't smear
- What's cheap enough for browser Web Audio

#### 3. Saturation & harmonic enhancement
tanh is clean but boring. Want warmth and density. Need:
- Analog-modeled saturation curves (tape, tube, transformer)
- Asymmetric saturation (even harmonics)
- Multiband saturation
- Exciters / harmonic enhancers (Aphex-style)
- Wavefolder / Chebyshev polynomial options

#### 4. Multiband dynamics
Single DynamicsCompressor is crude for compressed seismic audio. Need:
- 3-band or 4-band compressor/limiter architecture
- Crossover filter design (Linkwitz-Riley)
- Per-band threshold/ratio/makeup
- Phase-coherent band recombination

#### 5. De-essing / high-frequency control
Instrument noise pitched up becomes harsh. Need:
- Frequency-dependent compression above 2–8 kHz
- Dynamic EQ approaches
- Spectral tilt / gentle lowpass shelf

#### 6. Stereo / spatial enhancement
Mono seismic audio is flat. Need:
- Pseudo-stereo techniques (Haas, comb filtering, mid-side)
- Subtle chorus / ensemble for width
- What's safe for installation playback (mono compatibility)

#### 7. Loudness normalization (LUFS)
Peak normalization ignores perceived loudness. Need:
- ITU-R BS.1770 integrated loudness
- LUFS target for gallery playback
- Real-time LUFS metering
- EBU R128 short-term vs integrated

#### 8. Noise floor management
Dead air between seismic events is unsettling. Need:
- Spectral noise gate with soft knee
- Comfort noise injection (shaped noise floor)
- Envelope followers for adaptive gating

#### 9. Dithering for 16-bit export
Truncating float32 to int16 adds quantization distortion. Need:
- TPDF dither (triangular PDF)
- Noise-shaped dither
- What's appropriate for sonified data

#### 10. Subtle modulation (optional, artistic modes)
- Slow filter sweeps
- Subtle wow/flutter for tape character
- Gentle pitch drift

### Constraints to work within
- **Browser Web Audio API** for real-time playback (AudioWorklet possible but complex)
- **TypeScript**, no external DSP libraries (pure math in domain layer)
- **Must run on consumer hardware** — no offline rendering heavier than 30s for 5-min loops
- **Must preserve mono compatibility** for gallery installations
- **Must be bypassable** — keep a "raw" comparison mode
- **Real-time DSP must stay under ~10ms latency budget**
- **Offline export can be heavier** — up to a few seconds processing

### Deliverable format

For each algorithm, provide:
- **Name** and short description
- **What problem it solves** in our pipeline
- **Signal flow position** (pre-normalization? post-compression? final output?)
- **Parameter space** (what knobs, typical ranges)
- **Computational cost** (trivial / cheap / moderate / expensive)
- **Web Audio implementation notes** (native node? AudioWorklet? offline only?)
- **Aesthetic contribution** (what it does to the listening experience)
- **Reference implementations or papers** if available
- **Whether it belongs in core mode or artistic mode**

### Priority signals

Mark each algorithm:
- **🔴 P0 — Essential** — without this, the audio is unacceptably bad
- **🟡 P1 — High impact** — significant quality upgrade
- **🟢 P2 — Nice polish** — would improve but not critical
- **⚪ P3 — Artistic flavor** — creative modes only

---

Recipient: a fresh sub-agent with audio DSP research capability and web search access.
Please organize findings into a structured reference document at `docs/audio-algorithms-catalog.md`.
