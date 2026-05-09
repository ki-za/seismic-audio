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

## ☐ Tier 4 — Sound quality
- Refine DSP params per SoundMode in domain/sonification.ts (highpass, lowpass, saturation)
- Improve resampling quality in bridge/recorder.ts (anti-aliasing pre-filter?)
- Add sonification DSP unit tests to scripts/domain-diag.ts

## ☐ Tier 5 — Diagnostics upgrade
- Upgrade browser-smoke.ts: change one audio setting → verify fingerprint changed and audioDetected
- Add bridge health check: latency, buffer pressure, error rate
- Structured JSON output from smoke test for CI

## ☐ Tier 6 — Bridge reliability
- Better error responses in bridge/server.ts (proper HTTP status codes)
- Timeout handling in raspberryshake.ts requests
- Retry logic with backoff for archive fetches

## ☐ Tier 7 — Boundary cleanup (nice-to-have)
- Consider moving sonifier.ts from audio/ → adapters/ (it IS a Web Audio adapter)
- Fix domain/audio-state.ts dependent on $lib/types (move AudioWindow into domain?)
- Add station status per-station (not all show 'untested')

## ☐ Tier 8 — UI polish
- Loading spinner during bridge fetches
- Show mode glow tuning (orb energy during silence)
- Responsive fixes for mobile layout (station grid, compressor knobs)
- Per-station load status in station list (untested / loaded / failed / fallback)
