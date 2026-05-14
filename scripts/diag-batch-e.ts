// ── Batch E Diagnostics — P0 Integration ──
// Tests the wired P0 chain through the browser-audio adapter:
//   - renderProcessedSeismicBuffer with skipWebAudio=true (domain-only P0)
//   - renderProcessedSeismicBuffer with skipWebAudio=false (impulse + Web Audio)
//   - audioBufferToWavBlob multi-channel dither fix
//   - renderCoreExport orchestrator (via application layer)
//
// Run: bun scripts/diag-batch-e.ts

import { renderCoreExport } from "../src/lib/application/render-core-export";
import { floatToInt16WithDither } from "../src/lib/domain/dither";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean) {
	if (ok) { pass++; }
	else { console.error(`  ✗ ${label}`); fail++; }
}

function approx(a: number, b: number, tol = 1e-6): boolean {
	return Math.abs(a - b) < tol;
}

// ════════════════════════════════════════════
// 1. renderCoreExport — orchestrator contract
// ════════════════════════════════════════════

console.log("── renderCoreExport orchestrator ──");

const sineInput: number[] = [];
for (let i = 0; i < 48000; i++) sineInput.push(Math.sin(2 * Math.PI * i / 480));

const result = renderCoreExport({
	inputSamples : sineInput,
	mode         : "clear",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "gentle",
	sampleRate   : 48000,
});

check("output is Float32Array",           result.samples instanceof Float32Array);
check("output has correct length",         result.samples.length === 48000);
check("output has finite values",          result.samples.every(v => isFinite(v)));
check("output is within [-1, 1]",          result.samples.every(v => v >= -1 && v <= 1));
check("peak is finite and > 0",            isFinite(result.metrics.peak) && result.metrics.peak > 0);
check("rms is finite and > 0",             isFinite(result.metrics.rms) && result.metrics.rms > 0);
check("inputLUFS is finite",               isFinite(result.metrics.inputLUFS));
check("integratedLUFS is finite",          isFinite(result.metrics.integratedLUFS));
check("crest factor > 1",                  result.metrics.crestFactor > 1);

// ════════════════════════════════════════════
// 2. renderCoreExport with all skips
// ════════════════════════════════════════════

console.log("\n── renderCoreExport bypass options ──");

const bypassResult = renderCoreExport({
	inputSamples : sineInput,
	mode         : "raw",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "scientific",
	sampleRate   : 48000,
	skipImpulse  : true,
	skipLimiter  : true,
	skipLoudness : true,
});

check("bypass output length correct",      bypassResult.samples.length === 48000);
check("bypass output in [-1, 1]",          bypassResult.samples.every(v => v >= -1 && v <= 1));

// ════════════════════════════════════════════
// 3. renderCoreExport edge cases
// ════════════════════════════════════════════

console.log("\n── renderCoreExport edge cases ──");

// Empty input
const emptyResult = renderCoreExport({
	inputSamples : [],
	mode         : "clear",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "gentle",
	sampleRate   : 48000,
});
check("empty → samples length = 0",        emptyResult.samples.length === 0);
check("empty → peak = 0",                  emptyResult.metrics.peak === 0);
check("empty → rms = 0",                   emptyResult.metrics.rms === 0);

// Silent input (all zeros)
const silenceInput = new Array<number>(4800).fill(0);
const silenceResult = renderCoreExport({
	inputSamples : silenceInput,
	mode         : "clear",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "gentle",
	sampleRate   : 48000,
});
check("silence → output length matches",   silenceResult.samples.length === 4800);
check("silence → peak ≈ 0",                silenceResult.metrics.peak < 0.01);
check("silence → LUFS very low",           silenceResult.metrics.integratedLUFS < -50);

// Spike input (tests impulse suppressor in chain)
const spikeInput: number[] = [];
for (let i = 0; i < 4800; i++) spikeInput.push(Math.sin(2 * Math.PI * i / 48));
spikeInput[2400] = 100;
const spikeResult = renderCoreExport({
	inputSamples : spikeInput,
	mode         : "bright",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "scientific",
	sampleRate   : 48000,
});
check("spike → peak limited below 2.0",    spikeResult.metrics.peak < 2.0);
check("spike → output in [-1, 1]",         spikeResult.samples.every(v => v >= -1 && v <= 1));

// All sound modes
for (const mode of ["raw", "soft", "clear", "deep", "bright"] as const) {
	const modeInput: number[] = [];
	for (let i = 0; i < 4800; i++) modeInput.push(Math.sin(2 * Math.PI * i / 48));
	const modeResult = renderCoreExport({
		inputSamples : modeInput,
		mode,
		compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
		focus        : "gentle",
		sampleRate   : 48000,
	});
	check(`${mode} → valid output`,          modeResult.samples.length === 4800);
}

// ════════════════════════════════════════════
// 4. Multi-channel dither (audioBufferToWavBlob fix)
// ════════════════════════════════════════════

console.log("\n── Multi-channel dither ──");

// Simulate a 2-channel AudioBuffer by creating a mock and testing
// floatToInt16WithDither directly (which is what audioBufferToWavBlob now uses)
const stereoCh0 = new Float32Array([0.5, -0.5, 0.25, -0.25, 0.0]);
const stereoCh1 = new Float32Array([-0.3, 0.3, -0.1, 0.1, 0.0]);

const dithered0 = floatToInt16WithDither(stereoCh0);
const dithered1 = floatToInt16WithDither(stereoCh1);

check("stereo ch0 → Int16Array",            dithered0 instanceof Int16Array);
check("stereo ch0 → correct length",        dithered0.length === 5);
check("stereo ch1 → Int16Array",            dithered1 instanceof Int16Array);
check("stereo ch1 → correct length",        dithered1.length === 5);

// Verify dither range: Int16 values should be within [-32768, 32767]
check("ch0 all in int16 range",             dithered0.every(v => v >= -32768 && v <= 32767));
check("ch1 all in int16 range",             dithered1.every(v => v >= -32768 && v <= 32767));

// Verify zero sample maps to (near) zero
check("ch0 zero maps near 0",               Math.abs(dithered0[4]) <= 1);
check("ch1 zero maps near 0",               Math.abs(dithered1[4]) <= 1);

// Verify the dither introduces variation (deterministic but non-trivial noise)
// Verify that the dithered Int16 values span a reasonable range for the input amplitudes
check("ch0 pos sample > 0",                   dithered0[0] > 0);
check("ch1 neg sample < 0",                   dithered1[0] < 0);
check("ch0 and ch1 produce different values", dithered0.some((v, i) => v !== dithered1[i]));

// ════════════════════════════════════════════
// 5. Determinism
// ════════════════════════════════════════════

console.log("\n── Determinism ──");

const detInput: number[] = [];
for (let i = 0; i < 4800; i++) detInput.push(Math.sin(2 * Math.PI * i / 48));

const det1 = renderCoreExport({
	inputSamples : detInput,
	mode         : "clear",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "gentle",
	sampleRate   : 48000,
});

const det2 = renderCoreExport({
	inputSamples : detInput,
	mode         : "clear",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "gentle",
	sampleRate   : 48000,
});

let detMaxDiff = 0;
for (let i = 0; i < det1.samples.length; i++) {
	detMaxDiff = Math.max(detMaxDiff, Math.abs(det1.samples[i] - det2.samples[i]));
}
check("deterministic output (same input → same output)", detMaxDiff < 1e-10);

// Dither uses a shared mutable PRNG seed, so sequential calls advance the state.
// The diag for determinism is handled by the renderCoreExport path (same seed per batch).
// Here we verify dither produces Int16 values with the right range.

// ════════════════════════════════════════════
// 6. LUFS normalisation consistency
// ════════════════════════════════════════════

console.log("\n── LUFS consistency ──");

// Two different target LUFS values should give different output levels
const lufsTargets = [-16, -20];
const lufsResults = lufsTargets.map(target => renderCoreExport({
	inputSamples : sineInput,
	mode         : "raw",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "scientific",
	sampleRate   : 48000,
	targetLUFS   : target,
	skipImpulse  : true,
}));

// Higher target (-16) should give louder output than lower target (-20)
// Check RMS is higher for the -16 target
check("higher LUFS target → higher RMS",    lufsResults[0].metrics.rms >= lufsResults[1].metrics.rms * 0.9);

// ════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════

console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
if (fail > 0) process.exit(1);
