// ── Batch A Diagnostics ──
// Tests shared DSP helpers + polyphase resampler.
// Run: bun AGENT_DIAGNOSTICS/scripts/domain-diag.ts
// Alternatively: npx tsx scripts/domain-diag.ts

import {
	clamp, dbToLinear, linearToDb,
	smoothingCoefficient, smoothEnvelope,
	lerp, mix, median, millisecondsToSamples,
	biquadLPF, biquadHPF, biquadPeak, biquadHighShelf, biquadApply,
} from "../../src/lib/domain/dsp";

import {
	sinc, evaluateWindow, buildWindowedSincTable,
	resamplePolyphase, polyphaseOptionsForQuality, clearFilterCache,
} from "../../src/lib/domain/resampling";

import type {
	PolyphaseOptions, WindowType,
} from "../../src/lib/domain/types";

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
// 1. Shared DSP Helpers
// ════════════════════════════════════════════

console.log("── DSP Helpers ──");

check("clamp within range",       clamp(0.5, 0, 1) === 0.5);
check("clamp below min",          clamp(-0.1, 0, 1) === 0);
check("clamp above max",          clamp(1.5, 0, 1) === 1);
check("dbToLinear 0dB = 1",       approx(dbToLinear(0), 1));
check("dbToLinear -6dB ≈ 0.5",    approx(dbToLinear(-6), 0.501187, 1e-4));
check("linearToDb 1 = 0",         approx(linearToDb(1), 0));
check("linearToDb 0.5 ≈ -6",      approx(linearToDb(0.5), -6.0205, 1e-2));
check("smoothing coeff in (0,1)", smoothingCoefficient(10, 48000) > 0 && smoothingCoefficient(10, 48000) < 1);
check("smoothing shorter = lower", smoothingCoefficient(5, 48000) < smoothingCoefficient(10, 48000));
check("lerp midpoint",            approx(lerp(0, 10, 0.5), 5));
check("lerp endpoint",            approx(lerp(0, 10, 1), 10));
check("mix full dry = 0",         mix(1, 0, 0) === 1);
check("mix full wet = 1",         mix(0, 1, 1) === 1);
check("median odd",               median(Float64Array.from([1, 3, 7])) === 3);
check("median even",              approx(median(Float64Array.from([1, 3, 7, 9])), 5));
check("ms to samples 48k",        millisecondsToSamples(10, 48000) === 480);
check("ms to samples 12k",        millisecondsToSamples(10, 12000) === 120);

// ════════════════════════════════════════════
// 2. Biquad Filters
// ════════════════════════════════════════════

console.log("\n── Biquad Filters ──");

// LPF at high cutoff: should pass DC (DC gain ≈ 1)
const lpfCo = biquadLPF(24000, 48000, 0.707);
check("LPF a0 = 1 after norm", approx(lpfCo.a0, 1));
const dcSignal = new Float32Array(100);
for (let i = 0; i < dcSignal.length; i++) dcSignal[i] = 1;
const dcOut = biquadApply(dcSignal, lpfCo);
check("LPF DC gain ≈ 1 for high cutoff", approx(dcOut[dcOut.length - 1], 1, 0.05));

// HPF at high cutoff (close to Nyquist): should reject DC quickly
const hpfCo = biquadHPF(1000, 48000, 0.707);
const dcLong = new Float32Array(48000); // 1 second
for (let i = 0; i < dcLong.length; i++) dcLong[i] = 1;
const dcOut2 = biquadApply(dcLong, hpfCo);
// After 1s at a reasonable HPF cutoff, output should be near 0
check("HPF DC gain ≈ 0 at 1kHz cutoff", approx(dcOut2[dcOut2.length - 1], 0, 0.001));

// High-shelf: +6 dB boost should roughly double at Nyquist-ish
const shelfCo = biquadHighShelf(1000, 6, 0.707, 48000);
check("HighShelf normalised", approx(shelfCo.a0, 1));

// Peaking: 0 dB gain should be pass-through
const peakCo = biquadPeak(1000, 0, 1, 48000);
check("Peak 0dB a0=1", approx(peakCo.a0, 1));

// ════════════════════════════════════════════
// 3. Resampler
// ════════════════════════════════════════════

console.log("\n── Resampler ──");

check("sinc(0) = 1", approx(sinc(0), 1));
check("sinc(1) = 0", approx(sinc(1), 0, 1e-10));
check("sinc(0.5) ≈ 0.636", approx(sinc(0.5), 0.636619, 1e-4));
// Hann window: for N=4, indices 0,3 are edges (≈0), 1,2 are mid-points (≈0.75)
const hann2 = evaluateWindow(1, 4, "hann");
check("Hann window mid = 0.75", approx(hann2, 0.75, 1e-3));
check("Hann window edge ≈ 0", approx(evaluateWindow(0, 4, "hann"), 0, 1e-3));
check("Hann window edge = 0", approx(evaluateWindow(0, 4, "hann"), 0, 1e-3));

clearFilterCache();
const table = buildWindowedSincTable(512, 32, 0.90, "kaiser", 6);
check("filter table correct size", table.length === 512 && table[0].length === 32);
check("first phase sum ≈ 1", approx(table[0].reduce((a, b) => a + b, 0), 1, 0.01));
// Phase-0 coefficients: center tap aligns with a sample → should dominate (close to 1)
// Side lobes are negative but small magnitude. Range is roughly [-0.1, 0.9].
const maxAbs = Math.max(...table[0].map(c => Math.abs(c)));
check("coefficient max absolute < 1.0", maxAbs < 1.0);
check("center tap dominates phase 0", table[0][Math.floor(32/2)] > 0.5);

// Identity test: upsampling a simple signal (same length)
const identity = new Float32Array(100);
for (let i = 0; i < identity.length; i++) identity[i] = Math.sin(2 * Math.PI * i / 50);
const same = resamplePolyphase(identity, 100, polyphaseOptionsForQuality("export"));
let mse = 0;
for (let i = 0; i < same.length; i++) {
	const d = identity[i] - same[i];
	mse += d * d;
}
mse /= same.length;
check("identity resample: MSE < 1e-4", mse < 1e-4, 1e-4);

// Downsample: 200 → 100 samples (2:1)
const tone200 = new Float32Array(200);
for (let i = 0; i < tone200.length; i++) tone200[i] = Math.sin(2 * Math.PI * i / 40); // 5 cycles
const down100 = resamplePolyphase(tone200, 100, polyphaseOptionsForQuality("preview"));
check("downsample 2:1 produces correct length", down100.length === 100);

// Upsample: 100 → 200 samples (1:2)
const up200 = resamplePolyphase(tone200.subarray(0, 100), 200, polyphaseOptionsForQuality("preview"));
check("upsample 1:2 produces correct length", up200.length === 200);

// Empty input
const empty = resamplePolyphase([], 0, polyphaseOptionsForQuality("preview"));
check("empty input produces empty output", empty.length === 0);

// Single-sample input (degenerate case)
const single = resamplePolyphase([0.5], 10, polyphaseOptionsForQuality("preview"));
check("single-sample input constant output", single.every(s => approx(s, 0.5)));

// Output shorter than filter taps (edge case)
const short = resamplePolyphase(tone200, 4, polyphaseOptionsForQuality("preview"));
check("very short output produces correct length", short.length === 4);

// Number[] input (bridge compat)
const numberInput = [0, 1, 0, -1, 0];
const numberOut = resamplePolyphase(numberInput, 20, polyphaseOptionsForQuality("preview"));
check("number[] input produces Float32Array", numberOut instanceof Float32Array);
check("number[] output correct length", numberOut.length === 20);

// Silence preservation
const silence = new Float32Array(100);
const silentOut = resamplePolyphase(silence, 200, polyphaseOptionsForQuality("preview"));
check("silence in → silence out", silentOut.every(s => approx(s, 0)));

// Cache hit (second call with same params uses cache)
const beforeCacheSize = (buildWindowedSincTable as any)._tableCache?.size ?? 0;
const table2 = buildWindowedSincTable(512, 32, 0.90, "kaiser", 6);
check("filter table cache hit", table2 === table);

// ════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════

console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
if (fail > 0) process.exit(1);
