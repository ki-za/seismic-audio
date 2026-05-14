# Audio Processing Constraints

## Goal

Create a listenable loop from seismic waveform data while preserving the feeling that the sound still comes from the earth signal.

The processing should tow the line between:

```txt
authentic seismic waveform
        ↔
gallery-safe listenable audio
```

The app may enhance the sound, but it should not disguise the source beyond recognition.

---

## Source Constraints

- Use time-domain waveform samples as the primary source.
- Do not synthesize replacement music from the data.
- Do not use frequency spectra as the main audio input unless explicitly designing a different mode.
- Preserve source metadata whenever exporting audio.
- Treat station, channel, source sample rate, window length, playback length, and processing settings as part of the work.

---

## Time Compression Constraints

The loop is made by compressing a longer seismic window into a shorter playback duration.

```txt
seismic window duration → audio loop duration
```

Examples:

```txt
24 hours → 1 minute
72 hours → 5 minutes
```

Rules:

- The waveform’s time-order must be preserved.
- Compression ratio should be visible to the user.
- The selected playback duration should define the final loop length.
- Avoid hidden tempo/random rearrangement unless introduced as a separate artistic mode.

---

## Amplitude Constraints

Seismic data can contain very large spikes and very quiet sections.

The app may normalize for listenability, but normalization changes the meaning of loudness.

Current approach:

```txt
remove mean / DC offset
normalize against 98th-percentile absolute peak
clip final sample range to [-1, +1]
```

Rules:

- Always remove DC offset before playback/export.
- Use robust normalization for gallery listening so one spike does not silence the whole loop.
- Preserve enough metadata to explain that exported loudness is not calibrated seismic magnitude.
- Do not claim exported WAV amplitude is scientifically comparable across different windows unless calibrated processing is added.

---

## Filtering Constraints

Filtering is allowed as transparent enhancement.

Current sound modes use:

```txt
raw    high-pass 8 Hz   low-pass 12000 Hz
soft   high-pass 24 Hz  low-pass 4200 Hz
clear  high-pass 24 Hz  low-pass 8000 Hz
```

Rules:

- Filtering should remove mud, rumble, harshness, or playback artifacts.
- Filtering should not become so extreme that the signal feels unrelated to the source.
- Keep a raw or near-raw comparison mode available.
- If stronger creative filters are added, label them as artistic modes.

---

## Dynamics Constraints

Compression and limiting are allowed to make the loop safe and audible.

Current chain:

```txt
tanh saturation
DynamicsCompressor limiter
makeup gain
```

Rules:

- Use compression to control spikes, not to erase seismic dynamics completely.
- Keep compressor settings visible/editable.
- Avoid hard clipping except as a final safety guard.
- Saturation should add density/warmth, not become distortion by default.

---

## Looping Constraints

Loops should be clean enough for installation playback.

Current approach:

```txt
fade in/out over up to 3% of the buffer, capped at 48,000 samples
AudioBufferSourceNode.loop = true
```

Rules:

- Apply edge fades to reduce clicks.
- Preserve the full selected time window as much as possible.
- Avoid long fades that erase meaningful start/end events.
- Playback loop and exported WAV should represent the same processed sound.

---

## Export Constraints

Exports should be usable outside the browser and interpretable later.

Current export:

```txt
processed AudioBuffer
→ mono 16-bit PCM WAV
→ metadata JSON sidecar
```

Rules:

- Export the processed/listenable version heard in the app.
- Export a metadata JSON sidecar with processing settings.
- Include source/channel/window/playback/sample-rate details.
- Do not export only anonymous WAV files; the context is part of the artwork.

---

## Authenticity Boundary

Allowed by default:

```txt
mean removal
robust normalization
linear resampling/time compression
high-pass filtering
low-pass filtering
light saturation
compression/limiting
edge fades
output gain
```

Should require explicit artistic-mode labeling:

```txt
pitch quantization
beat slicing
random rearrangement
granular synthesis
added synth layers
reverb/delay as dominant character
melody extraction
AI-generated accompaniment
```

Not allowed for the core mode:

```txt
claiming scientific amplitude accuracy after normalization
hiding processing settings
replacing the waveform with unrelated generated audio
exporting without source metadata
```

---

## Working Principle

The seismic waveform remains the instrument.

Processing is there to make it audible, safe, loopable, and compelling in a room — not to pretend the earth signal is something else.
