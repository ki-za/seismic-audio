// ── Batch B Diagnostics ──
// Tests Hampel impulse suppressor + look-ahead limiter + LUFS normalisation.
// Run: bun scripts/diag-batch-b.ts
// Alternatively: npx tsx scripts/diag-batch-b.ts

import {
	clamp, dbToLinear, linearToDb,
	smoothingCoefficient,
} from "../src/lib/domain/dsp";

import { suppressImpulses } from "../src/lib/domain/impulse";
import { lookAheadLimiter, softClip } from "../src/lib/domain/limiter";
import {
	measureIntegratedLUFS,
	normalizeLoudness,
	applyKWeightingFilter,
} from "../src/lib/domain/loudness";

import type {
	ImpulseParams, LimiterParams,
} from "../src/lib/domain/types";

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
// 1. Hampel Impulse Suppressor
// ════════════════════════════════════════════

console.log("── Impulse Suppressor ──");

const impulseOpts: ImpulseParams = {
	radius          : 3,
	thresholdMAD    : 6,
	maxRepairLength : 3,
	blend           : 1.0,
};

// Clean signal unchanged
const clean = new Float32Array(100);
for (let i = 0; i < 100; i++) clean[i] = Math.sin(2 * Math.PI * i / 50);
const cleanOut = suppressImpulses(clean, impulseOpts);
let maxDiff = 0;
for (let i = 0; i < 100; i++) maxDiff = Math.max(maxDiff, Math.abs(clean[i] - cleanOut[i]));
check("clean signal unchanged", maxDiff < 1e-10);

// Single-sample spike suppressed (positive)
const clean50 = clean[50];
const spike = Float32Array.from(clean);
spike[50] = 10; // huge outlier
const spikeOut = suppressImpulses(spike, impulseOpts);
check("single spike reduced significantly", Math.abs(spikeOut[50] - clean50) < Math.abs(10 - clean50) * 0.1);

// Single-sample negative spike
const clean30 = clean[30];
const negSpike = Float32Array.from(clean);
negSpike[30] = -10;
const negSpikeOut = suppressImpulses(negSpike, impulseOpts);
check("negative spike reduced significantly", Math.abs(negSpikeOut[30] - clean30) < Math.abs(-10 - clean30) * 0.1);

// Multi-sample spike run (2 samples)
const clean40 = clean[40];
const clean41 = clean[41];
const runSpike = Float32Array.from(clean);
runSpike[40] = 5;
runSpike[41] = 4;
const runSpikeOut = suppressImpulses(runSpike, impulseOpts);
check("2-sample run both reduced significantly",
	Math.abs(runSpikeOut[40] - clean40) < Math.abs(5 - clean40) * 0.1 &&
	Math.abs(runSpikeOut[41] - clean41) < Math.abs(4 - clean41) * 0.1);

// Small spike below threshold passes through (blend=1.0 but score < threshold)
const spikeThresh: ImpulseParams = { radius: 3, thresholdMAD: 50, maxRepairLength: 3, blend: 1.0 };
const smallSpike = Float32Array.from(clean);
smallSpike[60] = 0.5; // well within range
const smallSpikeOut = suppressImpulses(smallSpike, spikeThresh);
check("small spike below threshold preserved",
	approx(smallSpikeOut[60], 0.5, 1e-6));

// Edge spike (near start boundary)
const clean5 = clean[5];
const edgeSpike = Float32Array.from(clean);
edgeSpike[5] = 8;
const edgeSpikeOut = suppressImpulses(edgeSpike, impulseOpts);
check("edge spike near start reduced significantly", Math.abs(edgeSpikeOut[5] - clean5) < Math.abs(8 - clean5) * 0.1);

// Edge spike (near end boundary)
const clean95 = clean[95];
const edgeSpike2 = Float32Array.from(clean);
edgeSpike2[95] = 8;
const edgeSpikeOut2 = suppressImpulses(edgeSpike2, impulseOpts);
check("edge spike near end reduced significantly", Math.abs(edgeSpikeOut2[95] - clean95) < Math.abs(8 - clean95) * 0.1);

// Partial blend (blend = 0.5)
const blendOpts: ImpulseParams = { radius: 3, thresholdMAD: 6, maxRepairLength: 3, blend: 0.5 };
const blendSpike = Float32Array.from(clean);
blendSpike[60] = 8;
const blendOut = suppressImpulses(blendSpike, blendOpts);
check("partial blend < full blend (0.5 means some original remains)",
	blendOut[60] > spikeOut[60] && blendOut[60] < 8);

// Radius 1 (minimum)
const minRadiusOpts: ImpulseParams = { radius: 1, thresholdMAD: 6, maxRepairLength: 1, blend: 1.0 };
const minRadSpike = Float32Array.from(clean);
minRadSpike[50] = 10;
const minRadOut = suppressImpulses(minRadSpike, minRadiusOpts);
check("radius=1 still detects spike", Math.abs(minRadOut[50]) < 0.5);

// Empty input
const empty = new Float32Array(0);
const emptyOut = suppressImpulses(empty, impulseOpts);
check("empty input → empty output", emptyOut.length === 0);

// Silence (all zeros) unchanged
const silence = new Float32Array(100);
const silenceOut = suppressImpulses(silence, impulseOpts);
check("silence unchanged", silenceOut.every(s => s === 0));

// Sine + noise: no false positives on natural variation
const sineNoise = new Float32Array(200);
for (let i = 0; i < 200; i++) sineNoise[i] = Math.sin(2 * Math.PI * i / 40) + (Math.random() - 0.5) * 0.01;
const snOut = suppressImpulses(sineNoise, impulseOpts);
let snMaxDiff = 0;
for (let i = 0; i < 200; i++) snMaxDiff = Math.max(snMaxDiff, Math.abs(snOut[i] - sineNoise[i]));
check("sine+noise barely touched", snMaxDiff < 0.05);

// ════════════════════════════════════════════
// 2. Look-Ahead Limiter
// ════════════════════════════════════════════

console.log("\n── Look-Ahead Limiter ──");

const limiterOpts: LimiterParams = {
	ceilingDb     : -1,
	lookAheadMs   : 5,
	releaseMs     : 200,
	softClipKnee  : 0.92,
	softClipDrive : 1.2,
};

// Sine wave within ceiling passes through
const limiterClean = new Float32Array(4800);
for (let i = 0; i < 4800; i++) limiterClean[i] = 0.5 * Math.sin(2 * Math.PI * i / 100);
const limiterCleanOut = lookAheadLimiter(limiterClean, 48000, limiterOpts);
const ceiling = dbToLinear(-1); // ~0.79
let cleanPeak = 0;
for (let i = 0; i < 4800; i++) cleanPeak = Math.max(cleanPeak, Math.abs(limiterCleanOut[i]));
check("sub-ceiling signal passes through", cleanPeak < ceiling + 0.01);

// Large spike is limited below ceiling
const limiterSpike = new Float32Array(4800);
for (let i = 0; i < 4800; i++) limiterSpike[i] = 0.5 * Math.sin(2 * Math.PI * i / 100);
limiterSpike[2000] = 100; // huge spike
const limiterSpikeOut = lookAheadLimiter(limiterSpike, 48000, limiterOpts);
let spikePeak = 0;
for (let i = 0; i < 4800; i++) spikePeak = Math.max(spikePeak, Math.abs(limiterSpikeOut[i]));
check("spike limited below ceiling", spikePeak < ceiling + 0.05);

// All-positive square wave (heavy limiting scenario)
const square = new Float32Array(4800);
for (let i = 0; i < 4800; i++) square[i] = (i % 200 < 100) ? 1 : -1;
const squareOut = lookAheadLimiter(square, 48000, limiterOpts);
let squarePeak = 0;
for (let i = 0; i < 4800; i++) squarePeak = Math.max(squarePeak, Math.abs(squareOut[i]));
check("square wave limited below ceiling", squarePeak < ceiling + 0.05);

// Empty input
const emptyLimit = lookAheadLimiter(new Float32Array(0), 48000, limiterOpts);
check("empty limiter input → empty output", emptyLimit.length === 0);

// Output length matches input
const lenCheck = lookAheadLimiter(new Float32Array(100), 48000, limiterOpts);
check("limiter output same length as input", lenCheck.length === 100);

// Soft-clip works independently
check("softClip unity at low level", approx(softClip(0.3, 1.0, 0.92), 0.3));
check("softClip clips at high level", softClip(2.0, 1.2, 0.92) <= 1.0);
check("softClip preserves sign", softClip(-1.5, 1.2, 0.92) < 0);

// ════════════════════════════════════════════
// 3. LUFS Loudness
// ════════════════════════════════════════════

console.log("\n── LUFS Loudness ──");

// Silence → -Infinity
const lufsSilence = new Float32Array(48000);
const silentLUFS = measureIntegratedLUFS(lufsSilence, 48000);
check("silence → -Infinity LUFS", !isFinite(silentLUFS) || silentLUFS < -90);

// Full-scale 1 kHz sine at 48 kHz should produce a known LUFS
const lufsTone = new Float32Array(48000 * 2); // 2 seconds
for (let i = 0; i < lufsTone.length; i++) lufsTone[i] = Math.sin(2 * Math.PI * 1000 * i / 48000);
const toneLUFS = measureIntegratedLUFS(lufsTone, 48000);
check("1 kHz sine has finite LUFS", isFinite(toneLUFS));
check("1 kHz sine > -10 LUFS (it's loud)", toneLUFS > -10);

// Normalisation brings to target
const targetLUFS = -18;
const normalized = normalizeLoudness(lufsTone, 48000, targetLUFS);
const measuredNormalized = measureIntegratedLUFS(normalized, 48000);
check("normalised loudness within 2 dB of target",
	Math.abs(measuredNormalized - targetLUFS) < 2);

// Very short signal (too short for 400ms block) — fallback
const shortSignal = new Float32Array(100);
for (let i = 0; i < 100; i++) shortSignal[i] = Math.sin(2 * Math.PI * i / 20);
const shortLUFS = measureIntegratedLUFS(shortSignal, 48000);
check("short signal produces finite LUFS", isFinite(shortLUFS));

// K-weighting filter doesn't crash on any sample rate
const rates = [12000, 16000, 32000, 48000];
for (const sr of rates) {
	const sig = new Float32Array(1000);
	for (let i = 0; i < 1000; i++) sig[i] = Math.sin(2 * Math.PI * 100 * i / sr);
	const weighted = applyKWeightingFilter(sig, sr);
	check(`K-weight #${sr}Hz output length matches`, weighted.length === sig.length);
}

// Empty signal normalisation
const emptyNorm = normalizeLoudness(new Float32Array(0), 48000, -18);
check("empty normalisation → empty", emptyNorm.length === 0);

// Normalisation preserves length
const normLen = normalizeLoudness(new Float32Array(4800), 48000, -18);
check("normalisation preserves length", normLen.length === 4800);

// ════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════

console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
if (fail > 0) process.exit(1);
