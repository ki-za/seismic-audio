# Seismic Audio Prototype

The prototype turns Raspberry Shake DATACAST UDP packets into local sound so the live-earth-to-audio path can be tested quickly.

## Live UDP Sonification Pipeline

The first live path listens for local DATACAST packets, extracts sample motion, and maps movement intensity into an audible oscillator.

```text
Raspberry Shake DATACAST UDP
→ parse_datacast_packet DATACAST parser
→ Sonifier.ingest level detector
→ Sonifier.audio_callback audio callback
→ stereo audio output
```

## Synthetic Test Mode

Synthetic mode exercises the same sonification path without requiring the Raspberry Shake hardware to be configured first.

`synthetic_loop` generates seismic-like pulses and feeds them into the same `Sonifier` used by live UDP.

## Audio Mapping Decision

The first sound design maps seismic amplitude to oscillator pitch, gain, and grit instead of directly playing seismic samples.

Direct waveform playback is deferred because seismic motion is usually below audible range; oscillator mapping gives immediate performable feedback for iteration.
