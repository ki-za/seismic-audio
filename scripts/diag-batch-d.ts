// ── Batch D Diagnostics ──
// Tests the P0 core export orchestrator, bridge polyphase integration,
// and sonifier dither+impulse integration.
//
// Run: bun scripts/diag-batch-d.ts
// Alternatively: npx tsx scripts/diag-batch-d.ts

import { renderCoreExport } from "../src/lib/application/render-core-export";
import type { ImpulseParams, LimiterParams } from "../src/lib/domain/types";

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
// 1. RenderCoreExport orchestrator
// ════════════════════════════════════════════

console.log("── RenderCoreExport ──");

// Simple sine wave
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
check("crest factor > 1",                  result.metrics.crestFactor > 1);
check("peak is finite and > 0",            isFinite(result.metrics.peak) && result.metrics.peak > 0);
check("rms is finite and > 0",             isFinite(result.metrics.rms) && result.metrics.rms > 0);
check("inputLUFS is finite",               isFinite(result.metrics.inputLUFS));

// With bypass options: all skips
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

check("bypass output has correct length", bypassResult.samples.length === 48000);
check("bypass output still in [-1, 1]",   bypassResult.samples.every(v => v >= -1 && v <= 1));

// With partial options override
const customResult = renderCoreExport({
	inputSamples     : sineInput,
	mode             : "deep",
	compression      : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus            : "texture",
	sampleRate       : 48000,
	impulseOptions   : { radius: 5, thresholdMAD: 10 },
	limiterOptions   : { ceilingDb: -2, lookAheadMs: 3 },
	targetLUFS       : -16,
});

check("custom output has correct length", customResult.samples.length === 48000);
check("custom output in [-1, 1]",         customResult.samples.every(v => v >= -1 && v <= 1));
check("custom metrics have LUFS",         isFinite(customResult.metrics.integratedLUFS));

// ════════════════════════════════════════════
// 2. Edge cases
// ════════════════════════════════════════════

console.log("\n── Edge Cases ──");

// Empty input
const emptyResult = renderCoreExport({
	inputSamples : [],
	mode         : "clear",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "gentle",
	sampleRate   : 48000,
});
check("empty → empty samples",             emptyResult.samples.length === 0);
check("empty → peak = 0",                  emptyResult.metrics.peak === 0);
check("empty → rms = 0",                   emptyResult.metrics.rms === 0);

// Very short input (just a few samples)
const shortInput = [0.5, -0.3, 0.1, -0.7, 0.2];
const shortResult = renderCoreExport({
	inputSamples : shortInput,
	mode         : "soft",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "event",
	sampleRate   : 48000,
});
check("short input produces output",       shortResult.samples.length > 0);
check("short output in [-1, 1]",           shortResult.samples.every(v => v >= -1 && v <= 1));

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
// For all-zero input, the LUFS measurement may return -Infinity or a very
// low number depending on how the K-weighting + gating resolves.
// The key property is it should not be a normal loudness value (e.g. > -40).
check("silence → LUFS is very low",          silenceResult.metrics.integratedLUFS < -50);

// Spike input (tests impulse suppressor in chain)
const spikeInput: number[] = [];
for (let i = 0; i < 4800; i++) spikeInput.push(Math.sin(2 * Math.PI * i / 48));
spikeInput[2400] = 100; // huge spike
const spikeResult = renderCoreExport({
	inputSamples : spikeInput,
	mode         : "bright",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "scientific",
	sampleRate   : 48000,
});
check("spike limited below 2.0",           spikeResult.metrics.peak < 2.0);
check("spike output in [-1, 1]",           spikeResult.samples.every(v => v >= -1 && v <= 1));

// 12 kHz sample rate
const lowRateInput: number[] = [];
for (let i = 0; i < 12000; i++) lowRateInput.push(Math.sin(2 * Math.PI * i / 120));
const lowRateResult = renderCoreExport({
	inputSamples : lowRateInput,
	mode         : "installation-safe",
	compression  : { thresholdDb: -12, ratio: 16, attackMs: 3, releaseMs: 180, makeupDb: 0 },
	focus        : "gentle",
	sampleRate   : 12000,
});
check("12 kHz output length correct",      lowRateResult.samples.length === 12000);
check("12 kHz output in [-1, 1]",          lowRateResult.samples.every(v => v >= -1 && v <= 1));

// All modes
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
	check(`${mode} produces valid output`, modeResult.samples.length === 4800);
}

// ════════════════════════════════════════════
// 3. Determinism
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

// ════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════

console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
if (fail > 0) process.exit(1);
