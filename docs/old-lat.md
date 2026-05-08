# seismic-audio-prototype

## Prototype pipeline

Quick live sonification path for Raspberry Shake DATACAST UDP.

```text
Raspberry Shake DATACAST UDP
→ seismic_audio.py UDP listener
→ parse packet: channel, timestamp_ms, integer samples
→ center samples around packet mean
→ RMS level detection
→ logarithmic compression + smoothing
→ oscillator pitch/gain/noise modulation
→ local stereo audio output
```

## Interfaces

- `seismic_audio.py --port <port>` listens for DATACAST UDP packets on `0.0.0.0:<port>`.
- `seismic_audio.py --channel EHZ` ignores all channels except the selected channel.
- `seismic_audio.py --test-tone` uses synthetic seismic-like pulses for testing without hardware.

## Dependencies

- Required for audio: `sounddevice`, `numpy`.
- Without those dependencies, the script still parses UDP and prints a level meter.

## Design decision

The first prototype maps seismic amplitude to an oscillator instead of directly playing the seismic waveform. Seismic motion is usually below direct audible range, so this produces an immediate controllable sound for exhibition iteration.
