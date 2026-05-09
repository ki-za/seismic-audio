# TODO

## ✅ Tier 1 — Hexagonal cleanup
- Extract DSP from sonifier.ts → domain/sonification.ts
- Move bridge.ts from data/ → adapters/bridge-client.ts
- Split types.ts → domain/types.ts (domain), lib/types.ts (cross-boundary DTOs)

## ✅ Tier 2 — Domain value objects + use cases
- domain/provider-id.ts — ProviderId value object
- domain/station.ts — StationId + NSLC value objects
- domain/load-state.ts — LoadState state machine
- application/seismic-audio-session.ts — SelectProvider, CompareAudioSettings, advanceLoadState
- composition/main.ts — wired new exports
- scripts/domain-diag.ts — unit diagnostics
- Committed: 50a06cb feat(domain): add ProviderId, StationId, NSLC, LoadState value objects

## ✅ Tier 3 — UI alignment
- Build Provider selector (Local Bridge / Raspberry Shake Archive)
- Build Loaded Evidence panel (NSLC, range, render, audio state)
- Wire selectProvider, compareAudioSettings into +page.svelte
- Wire LoadState machine into +page.svelte loadedState derived
- Settings comparison warning in evidence panel
- Committed: 3d209d7 feat(ui): wire Provider selector, LoadState machine, settings comparison
