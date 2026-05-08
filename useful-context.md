To convert seismic data into sound, you need to work with time-domain waveform data rather than frequency spectra. The most appropriate data formats would be the input trace formats that contain the actual seismic waveforms.

## Most Appropriate Formats for Sound Conversion

**miniSEED** and **SAC** formats are the most suitable for audio conversion because they contain the original time-domain seismic waveforms [1](#0-0) . These formats preserve the actual amplitude variations over time that can be mapped to audio signals.

## Key Data Format Properties to Consider

When converting seismic data to sound, you need to understand:

1. **Sampling Rate**: Seismic data typically has much lower sampling rates (10-100 Hz) compared to audio (44.1 kHz), so you'll need to upsample for audible playback [2](#0-1) 

2. **Amplitude Scaling**: Seismic amplitudes can vary by many orders of magnitude and require appropriate scaling to the audio dynamic range

3. **Data Type**: The waveform data is typically stored as floating-point values representing ground displacement, velocity, or acceleration

4. **Channel Information**: Three-component data (Z, N, E) can be converted to stereo or mono audio [3](#0-2) 

## Less Suitable Formats

The **HDF5 spectral format** would be less appropriate for direct audio conversion since it contains frequency-domain spectra rather than time-domain waveforms [4](#0-3) . While you could perform an inverse FFT to convert back to time domain, this adds complexity and potential artifacts.

## Notes

The spectral data formats (HDF5 and TEXT) are designed for scientific analysis and parameter estimation, not audio playback. They contain processed frequency spectra that have already been transformed from the original time-domain data. For sound conversion, always start with the raw waveform data in miniSEED or SAC format to preserve the original seismic signal characteristics.

Wiki pages you might want to explore:
- [Getting Started (SeismicSource/sourcespec)](/wiki/SeismicSource/sourcespec#1.1)

### Citations

**File:** docs/input_file_formats.rst (L13-16)
```text
Two very common choices are:

-  `miniSEED`_
-  `SAC`_
```

**File:** docs/signal_processing.rst (L103-104)
```text
      "12. Spectral S/N check" -> "13. Build H component";
      "13. Build H component" -> "14. Convert to magnitude units";
```

**File:** docs/signal_processing.rst (L127-130)
```text
5. The amplitude spectra of the signal and noise windows are computed, using
   :func:`numpy.fft.rfft()`.
   If ``spectral_win_length`` is not ``None``, the signal is zero-padded to
   this length before computing the Fast Fourier Transform.
```

**File:** docs/spectral_file_formats.rst (L87-95)
```text
HDF5 File Format
----------------
In the HDF5 file format, all the spectra are stored in a group named
``spectra``. This will allow for storing additional data types in the future.
Within the ``spectra`` group, each :class:`spectrum.Spectrum` object is stored
in a `group`_ named ``spectrum_NNNNN_NET.STA.LOC.CHAN``, where ``NNNN`` is the
index of the spectrum in the original :class:`spectrum.SpectrumStream` object.
For each group, metadata is stored in the `attributes`_ section, and data is
stored into 6 `datasets`_, as illustrated below:
```



Yes — but probably **not one single library** that does the whole “Raspberry Shake seismic data → sonified WAV” pipeline turnkey.

Best stack in the TypeScript/Svelte family:

```txt
seisplotjs
  for seismic/FDSN/Raspberry Shake waveform access

Web Audio API
  for AudioBuffer playback, gain, looping, speed-up sonification

audiobuffer-to-wav or your own encoder
  for WAV export

optional: Tone.js
  for nicer audio scheduling/effects/filters
```

## 1. Seismic data: `seisplotjs`

Use this. Your current code already does.

`seisplotjs` is a JavaScript library for “parsing, manipulating and plotting seismic data,” and it includes modules for FDSN dataselect queries, station queries, FFT, filtering, and plotting. It installs through npm:

```bash
npm install seisplotjs
```

Import:

```ts
import * as sp from "seisplotjs";
```

It has an `fdsndataselect` module for querying seismograms from FDSN web services, plus `filter` and `fft` modules that are useful if you want real signal-processing instead of only raw speed-up sonification. ([GitHub][1])

So: **for the seismic data type, `seisplotjs` is the main answer.**

## 2. Audio transformation: Web Audio API

For your exact transformation, browser-native Web Audio is enough.

You are already doing the core thing:

```ts
const audioRate = Math.max(4000, Math.floor(sampleRate * sonifyFactor));

const buffer = audioCtx.createBuffer(
  1,
  normSamples.length,
  audioRate
);

buffer.copyToChannel(normSamples, 0);
```

That maps very cleanly to TypeScript and Svelte.

`AudioBuffer` stores PCM audio samples as `Float32Array` data, normally between `-1` and `+1`, and can be created directly from raw sample arrays using `AudioContext.createBuffer()`. ([MDN Web Docs][2])

That means your seismic-to-audio method does **not need a special audio library**. Your seismic samples become audio samples after:

```txt
mean remove
normalize to [-1, 1]
copy to AudioBuffer
play at accelerated sample rate
```

Caveman version: data already waveform. Make it centered, make it loud enough, play it faster. Done.

## 3. WAV export: `audiobuffer-to-wav`

You can replace your hand-written WAV encoder with:

```bash
npm install audiobuffer-to-wav
```

Usage pattern:

```ts
import audioBufferToWav from "audiobuffer-to-wav";

const wavArrayBuffer = audioBufferToWav(audioBuffer);
const blob = new Blob([wavArrayBuffer], { type: "audio/wav" });
```

The package encodes Web Audio `AudioBuffer` contents as WAV and supports 16-bit PCM and 32-bit float output. ([npm][3])

Your current encoder is fine, though. No need to replace unless you want less custom code.

## 4. Optional higher-level audio: `Tone.js`

Use Tone.js only if you want nicer musical/audio tooling:

```bash
npm install tone
```

Tone.js is a Web Audio framework with transport, scheduling, synths, effects, filters, and signal-processing building blocks. ([tonejs.github.io][4])

For your app, Tone.js is useful for:

```txt
filters
gain staging
loop transport
effects
envelopes
smoother playback control
```

But it is **not needed** for the basic seismic sonification.

## Recommended Svelte/TypeScript structure

I’d split it like this:

```txt
src/lib/seismic.ts
  fetches Raspberry Shake data with seisplotjs
  returns { samples, sampleRate, metadata }

src/lib/sonify.ts
  removeMean()
  normalize()
  seismicToAudioBuffer()
  applyFade()
  maybe filter later

src/lib/wav.ts
  exportAudioBufferToWav()

src/routes/+page.svelte
  UI only
```

Core transform module could look like:

```ts
export function removeMean(input: ArrayLike<number>): Float32Array {
  let mean = 0;

  for (let i = 0; i < input.length; i++) {
    mean += input[i];
  }

  mean /= input.length || 1;

  const out = new Float32Array(input.length);

  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] - mean;
  }

  return out;
}

export function normalize(input: Float32Array): Float32Array {
  let maxAbs = 0;

  for (const value of input) {
    maxAbs = Math.max(maxAbs, Math.abs(value));
  }

  maxAbs = Math.max(maxAbs, 1e-9);

  const out = new Float32Array(input.length);

  for (let i = 0; i < input.length; i++) {
    out[i] = Math.max(-1, Math.min(1, input[i] / maxAbs));
  }

  return out;
}

export function seismicToAudioBuffer(params: {
  audioCtx: AudioContext;
  samples: Float32Array;
  seismicSampleRate: number;
  speedFactor: number;
}): AudioBuffer {
  const audioRate = Math.max(
    4000,
    Math.floor(params.seismicSampleRate * params.speedFactor)
  );

  const buffer = params.audioCtx.createBuffer(
    1,
    params.samples.length,
    audioRate
  );

  buffer.copyToChannel(params.samples, 0);

  return buffer;
}
```

## My recommendation

Use this combo:

```bash
npm install seisplotjs audiobuffer-to-wav
```

Then keep Web Audio native.

Do **not** over-library this yet. Your current algorithm is small and good. The valuable library is `seisplotjs`; the sonification part is better as your own clean TypeScript module.

[1]: https://github.com/crotwell/seisplotjs "GitHub - crotwell/seisplotjs: Javascript modules for parsing, manipulating and plotting seismic data. · GitHub"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer "AudioBuffer - Web APIs | MDN"
[3]: https://www.npmjs.com/package/audiobuffer-to-wav?utm_source=chatgpt.com "audiobuffer-to-wav"
[4]: https://tonejs.github.io/ "Tone.js"
