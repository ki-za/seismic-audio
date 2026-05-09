#  Hexagonal Cleanup Plan

## Tier 1 — Clean what's there ✅ DONE

- [x] Extract DSP functions from `sonifier.ts` → `domain/sonification.ts`
- [x] Move `data/bridge.ts` → `adapters/bridge-client.ts` + update imports
- [x] Split `types.ts`: domain types → `domain/types.ts`, cross-boundary DTOs stay

## Tier 2 — Build missing domain (medium risk, high value)

- [ ] Add domain value objects: `ProviderId`, `StationId`, `NSLC`, `AudioSettingsFingerprint`
- [ ] Add `LoadState` state machine in domain
- [ ] Implement `SelectProvider` use case in application
- [ ] Implement `CompareAudioSettings` use case in application
- [ ] Wire new use cases through `composition/main.ts`

## Tier 3 — UI alignment (TECHNICAL_DESIGN.md)

- [ ] Build Loaded Evidence panel in `+page.svelte`
- [ ] Add Provider selector replacing implicit station=provider inference

## 󰶻 Last verified

npm run check ✅ 0 errors | npm run build ✅ success
