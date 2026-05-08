# Seismic Data Input Findings

The durable project-facing findings live in `SIESSMIC_DATA_INPUT.md`.

## Input Ranking

Use DATACAST UDP first, SeedLink second, and FDSN only for archive/replay.

```text
UDP DATACAST → fastest live prototype
SeedLink     → robust live candidate
FDSN         → delayed archive/replay source
```

## Extension Direction

The prototype should grow toward separate input backends that feed the same sonification path.

```text
UdpDatacastInput
SyntheticInput
SeedLinkInput
FdsnReplayInput
→ Sonifier.ingest(samples)
```

## Browser Direction

A browser should not try to read UDP directly. Future web work should use a local bridge and WebSocket frames.

```text
Raspberry Shake input
→ Python/Node bridge
→ WebSocket
→ browser AudioWorklet / visualizer
```
