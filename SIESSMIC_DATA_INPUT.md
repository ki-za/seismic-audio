# SIESSMIC_DATA_INPUT.md

> Note: filename keeps the requested spelling: `SIESSMIC`.

## Purpose

This document captures what we know about live Raspberry Shake seismic data input, and how to extend the current prototype from a quick UDP-to-audio sketch into a stronger live sonification system.

Current prototype:

```text
Raspberry Shake DATACAST UDP
→ seismic_audio.py
→ parse packet samples
→ calculate motion level
→ map level to oscillator pitch/gain/noise
→ local audio output
```

## Main finding

For live art-show sonification, the best input path is local Raspberry Shake data, not public archive APIs.

Recommended order:

1. **UDP / DATACAST** — fastest first prototype, closest to live.
2. **SeedLink** — better robust live input once the audio idea works.
3. **FDSN** — archive/replay/backfill only; not live enough.

## Input option 1: UDP / DATACAST

### Summary

Raspberry Shake DATACAST sends plain-text UDP packets from the Shake to a configured IP and port.

This is the current prototype target.

```text
Raspberry Shake
→ UDP packet
→ local Python socket listener
→ parsed integer samples
```

### Packet shape

DATACAST packets look like:

```text
{'CHANNEL', epoch_timestamp_ms, sample_1, sample_2, sample_3, ...}
```

Important facts:

- One packet contains one channel.
- First field is the channel name.
- Second field is the epoch timestamp in milliseconds for the first sample.
- Remaining fields are integer waveform samples.
- Packets are comma-separated and wrapped in braces.

### Why use it first

- Very low ceremony.
- Easy to parse.
- Good for proving “earth motion becomes sound.”
- Browser cannot receive UDP directly, but Python can.

### Risks

- UDP can drop packets.
- No delivery guarantee.
- Not the best final production input if continuity matters.
- Needs Raspberry Shake DATACAST configured to send to this machine’s LAN IP and chosen port.

### Prototype extension ideas

Add:

- packet loss/gap detection using timestamps
- per-channel routing
- configurable channel choice
- raw packet logging
- rolling buffer for smoothing and replay
- OSC/WebSocket forwarding
- calibration display showing current RMS/noise floor

## Input option 2: SeedLink

### Summary

SeedLink is a seismic-native real-time streaming protocol over TCP. Raspberry Shake exposes local SeedLink on port `18000`.

```text
Raspberry Shake :18000
→ SeedLink client
→ miniSEED traces
→ processing ring buffer
→ audio engine
```

### Why use it later

- TCP-based, so more reliable than UDP.
- Better candidate for show installation stability.
- Used by seismic tools for real-time waveform viewing.
- ObsPy has SeedLink support in Python.

### Tradeoff

SeedLink is more robust, but miniSEED parsing and client setup are more complex than UDP DATACAST.

### Prototype extension ideas

Add a second input backend:

```text
--input udp
--input seedlink
```

Possible CLI shape:

```bash
python seismic_audio.py --input seedlink --host rs.local --port 18000 --channel EHZ
```

Implementation likely uses ObsPy:

```text
ObsPy EasySeedLinkClient
→ callback receives Trace objects
→ convert trace.data to numeric samples
→ feed same Sonifier.ingest(samples)
```

## Input option 3: FDSN web services

### Summary

FDSN is useful for historical data and replay, but not live sonification.

```text
Raspberry Shake FDSN archive
→ miniSEED download
→ replay through same audio mapping
```

### Why not for live

Raspberry Shake FDSN data is delayed; research indicates it is suitable for data around **T minus 30 minutes and older**, not immediate performance input.

### Why still useful

Use FDSN for:

- testing against known earthquake events
- rehearsing without the Shake hardware
- comparing stations/channels
- tuning the sound mapping
- filling gaps after the fact
- instrument metadata and response work

### Prototype extension ideas

Add replay mode:

```bash
python seismic_audio.py --input fdsn --station R1234 --start ... --duration ... --speed 60
```

Then feed downloaded samples into the same sonifier.

## Browser and web interface finding

Browsers cannot open raw UDP sockets, and direct browser SeedLink is not the simple first path.

Future web architecture should use a local bridge:

```text
Raspberry Shake input
→ Python/Node bridge
→ normalized timestamped frames
→ WebSocket
→ browser visualizer + AudioWorklet
```

For low-latency browser audio, use:

```text
Web Audio API
→ AudioWorklet
→ ring buffer / queued frames
→ audio output
```

## Current audio strategy

The current prototype uses amplitude-to-oscillator mapping:

```text
packet samples
→ remove packet mean
→ RMS level
→ logarithmic compression
→ smoothing
→ oscillator frequency / gain / grit
```

This was chosen because seismic motion is usually below direct human hearing range. Direct playback would often be too slow or too quiet unless time-compressed.

## Future audio modes

### 1. Amplitude-to-oscillator

Best current mode.

Good for:

- ambient installation
- reliable continuous sound
- quick performance tuning

Controls to add:

- base frequency
- frequency range
- gain range
- smoothing amount
- noise/grit amount
- filter cutoff mapping

### 2. Time-compressed waveform playback

More literal.

```text
seismic buffer
→ normalize
→ resample/time-compress
→ audio-rate playback
```

Useful for making earthquakes audible as accelerated sound.

Needs:

- anti-click envelopes
- DC removal
- limiter
- configurable speed multiplier
- buffer management

### 3. Event-triggered sound

```text
STA/LTA or threshold detector
→ trigger sample/synth patch
→ optionally render accelerated seismic excerpt
```

Good for gallery moments where small motions trigger audible events.

## Practical setup checklist

To use real live data:

1. Find this computer’s LAN IP.
2. Pick a UDP port, currently default `8888`.
3. Configure Raspberry Shake DATACAST to send to that IP and port.
4. Run:

```bash
cd ~/projects/seismic-audio-prototype
source .venv/bin/activate
python seismic_audio.py --port 8888
```

5. If multiple channels arrive, try:

```bash
python seismic_audio.py --port 8888 --channel EHZ
```

## Next engineering steps

Smallest useful improvements:

1. Add CLI parameters for sound mapping:

```text
--base-freq
--freq-range
--gain
--smoothing
```

2. Add packet logging:

```text
--record packets.log
```

3. Add input backend abstraction:

```text
UdpDatacastInput
SyntheticInput
SeedLinkInput later
FdsnReplayInput later
```

4. Add WebSocket output:

```text
--websocket-port 8765
```

5. Add gap detection:

```text
expected timestamp delta vs received timestamp delta
→ warn when packets are missing or late
```

## Recommended implementation path

```text
Phase 1: keep UDP prototype tiny and tune sound
Phase 2: clean up into input backends + sonifier controls
Phase 3: add WebSocket frames for browser visuals
Phase 4: add SeedLink backend for robust live installation
Phase 5: add FDSN replay for rehearsals and known-event testing
```

## Current open questions

- Which Raspberry Shake model are we using?
- Which channels are available: `EHZ`, `SHZ`, others?
- What UDP port will the Shake send to?
- Is the show machine on the same LAN as the Shake?
- Should the final sound feel scientific, musical, ominous, tactile, or ritual/ambient?
- Do dropped packets matter artistically, or can glitches be part of the piece?
