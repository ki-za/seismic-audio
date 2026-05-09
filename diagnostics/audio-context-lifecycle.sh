#!/usr/bin/env bash
# Diagnostics: AudioContext lifecycle in chunked-DSP play path
# Run with: bash diagnostics/audio-context-lifecycle.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "═══ AudioContext Lifecycle Diagnostics ═══"
echo ""

# 1. Confirm playPrepared is now async (returns Promise<void>)
echo "── port interface ──"
grep -n 'playPrepared' src/lib/ports/audio.ts
echo ""

# 2. Confirm CompressedSeismicPlayer.playPrepared calls await this.start()
echo "── sonifier playPrepared ──"
grep -A2 'async playPrepared' src/lib/audio/sonifier.ts
echo ""

# 3. Confirm the caller awaits playPrepared
echo "── +page.svelte caller ──"
grep -n 'await playPrepared' src/routes/+page.svelte
echo ""

# 4. Confirm start() creates/resumes AudioContext
echo "── start() method ──"
grep -A3 'async start()' src/lib/audio/sonifier.ts
echo ""

# 5. TypeScript check
echo "── type check ──"
npm run check 2>&1
echo ""

echo "═══ Summary ═══"
echo "Root cause: playPrepared() was synchronous and bailed when this.context was null"
echo "  (the old play() path called await this.start() first, but the new playPrepared"
echo "   caller bypassed that)"
echo ""
echo "Fix: made playPrepared() async and added await this.start() as its first line"
echo "  → AudioContext is created/resumed before node wiring"
echo "  → Chain of 4 edits: sonifier.ts → ports/audio.ts → seismic-audio-session.ts → main.ts → +page.svelte"
echo ""
echo "Verify by clicking 'Play Loaded Loop' in the browser and checking:"
echo "  - AudioContext state transitions from 'suspended' → 'running'"
echo "  - Orb animates (meter callback fires)"
echo "  - Sound is audible"
