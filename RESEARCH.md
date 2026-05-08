# RESEARCH.md

# Raspberry Shake Seismic Sonification

## Overview

This p5.js browser sketch fetches recent seismic waveform data from a Raspberry Shake station, draws the waveform, turns the seismic trace into an audible looping sound buffer, and exports that sound as a WAV file.

The key idea is simple:

> seismic ground-motion samples are treated as an audio waveform, normalized, sped up by changing the playback sample rate, then written into a Web Audio `AudioBuffer`.

Because real seismic signals are usually far below the human hearing range, the sketch accelerates the data so slow ground motion becomes audible.

---

## Expected Input Data

The program expects waveform data from the Raspberry Shake FDSN dataselect service:

```text
https://data.raspberryshake.org
```

The user selects:

```text
network.station.location.channel
```

For example:

```text
AM.R2A2B.00.EHZ
```

### Required station fields

| Field | Example | Meaning |
|---|---:|---|
| Network | `AM` | Raspberry Shake network code |
| Station | `R2A2B` | Individual station code |
| Location | `00` or `--` | Sensor location code |
| Channel | `EHZ`, `EHN`, `EHE`, etc. | Sensor component/channel |

### Time window

The sketch asks for a recent time window:

```text
window mins = 60
delay mins  = 35
```

This means:

```text
end time   = now - 35 minutes
start time = end time - 60 minutes
```

The delay matters because very recent seismic data may not yet be available from the server.

### Channel selection

The sketch can try channels automatically:

```js
["EHE", "EHN", "EHZ", "SHZ", "HHE", "HHN", "HHZ"]
```

Or the user can choose one fixed channel.

Common channel meanings:

| Channel | Rough meaning |
|---|---|
| `EHZ` | High-gain vertical component |
| `EHN` | High-gain north-south component |
| `EHE` | High-gain east-west component |
| `SHZ` | Short-period vertical component |
| `HHZ` | Broadband/high sample-rate vertical component |

The exact available channels depend on the station.

---

## Data Format Expected by the Code

The sketch imports `seisplotjs` and calls:

```js
dsQuery.querySeismograms()
```

It expects a returned seismogram object with sample data in one of these shapes:

```js
seis.y
```

or:

```js
seis.seismogram.y
```

or inside segment arrays:

```js
seis.segments
seis.segmentArray
seis._segmentArray
```

Each sample is expected to be a numeric ground-motion value. These are usually integer-like instrument counts, not audio samples.

The code also tries to read the sample rate from:

```js
seis.sampleRate
```

or:

```js
seis.segments[0].sampleRate
```

If no sample rate is found, it assumes:

```js
100 Hz
```

---

## Signal Processing Pipeline

The audio transformation has four main steps:

```text
raw seismic samples
        ↓
remove DC offset / mean
        ↓
normalize amplitude
        ↓
increase effective playback rate
        ↓
loop and export as WAV
```

---

## 1. Mean Removal

Function:

```js
processSamples(raw)
```

The raw seismic trace is first averaged:

```js
mean = sum(raw) / raw.length
```

Then the mean is subtracted from every sample:

```js
v = raw[i] - mean
```

### Why this matters

Seismic data often has a DC offset. That means the waveform may be shifted above or below zero.

For audio, this is bad because:

- it wastes headroom,
- it can cause clicks,
- it can bias the speaker cone,
- it makes normalization less clean.

Mean removal recenters the trace around zero.

---

## 2. Amplitude Normalization

After mean removal, the code finds the largest absolute value:

```js
maxAbs = max(abs(samples[i]))
```

Then every sample is scaled into the range:

```text
-1.0 to +1.0
```

using:

```js
normSamples[i] = constrain(samples[i] / maxAbs, -1, 1)
```

### Why this matters

The Web Audio API expects floating-point audio samples roughly in the range:

```text
-1.0 to +1.0
```

This transformation does not preserve absolute seismic amplitude. It makes the loudest point in each loaded trace full scale.

So the output audio is good for listening to waveform shape, rhythm, and texture, but not for comparing true earthquake magnitude across different exports unless extra calibration is added.

---

## 3. Sonification by Sample-Rate Acceleration

Function:

```js
buildAudioBuffer()
```

The key sonic transformation is here:

```js
const audioRate = max(4000, floor(sampleRate * sonifyFactor));
```

Then the normalized seismic data is copied into a Web Audio buffer:

```js
audioBuffer = audioCtx.createBuffer(1, normSamples.length, audioRate);
audioBuffer.copyToChannel(normSamples, 0);
```

Default settings:

```js
sampleRate = about 100 Hz
sonifyFactor = 140
audioRate = 100 × 140 = 14000 Hz
```

### What this does

The seismic samples are not resampled in a complex way. Instead, they are placed directly into an audio buffer whose sample rate is much higher than the original seismic sample rate.

This compresses time.

A 60-minute seismic trace at 100 Hz contains:

```text
60 min × 60 sec × 100 samples/sec = 360,000 samples
```

Played at 14,000 samples/sec:

```text
360,000 / 14,000 ≈ 25.7 seconds
```

So one hour of seismic data becomes about 26 seconds of audio.

### Frequency shift

All frequencies are multiplied by the same factor.

With the default factor:

```text
audio frequency = seismic frequency × 140
```

So:

| Seismic frequency | Heard as |
|---:|---:|
| 0.1 Hz | 14 Hz |
| 1 Hz | 140 Hz |
| 5 Hz | 700 Hz |
| 10 Hz | 1400 Hz |

This is the main sonification method.

---

## 4. Loop Playback

Function:

```js
togglePlay()
```

The audio buffer is played using a looping `AudioBufferSourceNode`:

```js
bufferSource.loop = true;
```

The code calculates the playhead position visually by comparing current audio time to the buffer duration:

```js
loopTime = (audioCtx.currentTime - startedAtAudioTime) % audioBuffer.duration;
playheadIndex = floor(loopTime * audioBuffer.sampleRate);
```

This keeps the yellow playhead synced with the audible loop.

Important detail:

`AudioBufferSourceNode` objects are single-use. The code correctly creates a new one each time playback starts.

---

## 5. Gain Control

The sketch uses a `GainNode`:

```js
masterGain = audioCtx.createGain();
masterGain.gain.value = outputGain;
masterGain.connect(audioCtx.destination);
```

Default gain:

```js
0.18
```

The UI gain slider changes:

```js
masterGain.gain.value = outputGain;
```

This is playback loudness only. It does not change the stored normalized seismic samples.

---

## 6. WAV Export

Function:

```js
exportCurrentLoopAsWav()
```

The sketch exports the current audio buffer, not the raw seismic trace.

The export path is:

```text
AudioBuffer
    ↓
Float32 samples
    ↓
16-bit PCM encoding
    ↓
RIFF/WAVE Blob
    ↓
downloaded .wav file
```

The WAV encoder writes:

- RIFF header,
- WAVE format marker,
- `fmt` chunk,
- `data` chunk,
- 16-bit PCM sample data.

The audio is mono because the buffer is created with one channel:

```js
audioCtx.createBuffer(1, normSamples.length, audioRate)
```

### Export format

| Property | Value |
|---|---:|
| Channels | 1 / mono |
| Bit depth | 16-bit PCM |
| Sample rate | `sampleRate × sonifyFactor`, minimum `4000 Hz` |
| Amplitude | normalized float converted to signed 16-bit integer |

---

## Important Interpretation Notes

### This is sonification, not scientific audio reproduction

The generated WAV is not a physically calibrated acoustic signal. It is a transformed representation of seismic movement.

Good for:

- listening to seismic rhythm,
- hearing transients,
- comparing texture,
- artistic use,
- quick exploratory inspection.

Not enough for:

- magnitude estimation,
- calibrated amplitude comparison,
- formal earthquake analysis,
- instrument-response-corrected research.

### Normalization removes absolute amplitude meaning

Every loaded trace is scaled so its largest sample becomes full scale. This makes quiet and loud seismic windows equally loud in the export.

Useful for listening. Dangerous for measurement.

### Speed factor controls time compression

Higher `sonifyFactor` means:

- shorter audio,
- higher pitch,
- faster events.

Lower `sonifyFactor` means:

- longer audio,
- lower pitch,
- slower events.

### No filtering is currently applied

The code does not currently use:

- high-pass filtering,
- low-pass filtering,
- band-pass filtering,
- smoothing,
- anti-alias filtering,
- instrument correction,
- clipping protection beyond normalization.

The raw trace shape is mostly preserved after mean removal and scaling.

---

## Key Methods Summary

| Method | Function | Purpose |
|---|---|---|
| Data fetch | `loadWaveform()` | Requests seismic data from Raspberry Shake |
| Sample extraction | `extractSamples()` | Pulls numeric samples from several possible seisplotjs object structures |
| Sample-rate extraction | `extractSampleRate()` | Finds original seismic sample rate |
| Mean removal | `processSamples()` | Removes DC offset |
| Normalization | `processSamples()` | Scales waveform to `[-1, +1]` |
| Sonification | `buildAudioBuffer()` | Converts seismic samples into accelerated audio |
| Playback | `togglePlay()` | Loops the generated audio buffer |
| Gain | `initAudio()` / slider | Controls output volume |
| WAV export | `exportCurrentLoopAsWav()` | Saves current sonified loop as a WAV file |
| PCM encoding | `encodeWAV()` | Writes RIFF/WAVE 16-bit PCM data |

---

## Suggested Improvements

### 1. Add filtering

A band-pass filter would make the sonification cleaner:

```text
remove very slow drift
remove very high-frequency noise
focus on earthquake-relevant bands
```

Possible filters:

- high-pass before normalization,
- low-pass before acceleration,
- Web Audio `BiquadFilterNode`,
- offline DSP filter before buffer creation.

### 2. Preserve amplitude metadata

Export a sidecar JSON file containing:

```json
{
  "network": "AM",
  "station": "R2A2B",
  "location": "00",
  "channel": "EHZ",
  "startISO": "...",
  "endISO": "...",
  "originalSampleRate": 100,
  "sonifyFactor": 140,
  "normalizationMaxAbs": "...",
  "meanRemoved": "..."
}
```

This would make exports easier to interpret later.

### 3. Add stereo modes

Possible stereo mappings:

| Left channel | Right channel |
|---|---|
| `EHN` | `EHE` |
| vertical trace | horizontal trace |
| raw trace | filtered trace |

### 4. Add envelope or compression

Large spikes can dominate normalization. Gentle compression could make quieter features easier to hear.

### 5. Add click-safe fades

Loop boundaries may click. Short fade-in and fade-out envelopes would smooth looping.

### 6. Add anti-alias-aware resampling

Current method changes the buffer sample rate directly. That is simple and effective, but more careful resampling/filtering would improve fidelity when pushing speed factors high.

---

## Minimal Conceptual Summary

This project takes a recent seismic waveform, recenters it, scales it into audio amplitude range, plays it much faster than real time, and exports the accelerated waveform as a mono 16-bit WAV file.

In one sentence:

> It turns slow earth motion into sound by normalizing seismic samples and multiplying their effective playback rate.
