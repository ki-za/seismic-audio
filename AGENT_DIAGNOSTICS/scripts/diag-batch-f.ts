// ── Diag Batch F: Asymmetric Saturation ──
// Tests domain/saturation.ts against catalog §9 spec.
//
// Usage: bun scripts/diag-batch-f.ts

import {
	asymmetricSaturation,
	makeAsymmetricSaturationCurve,
	DEFAULT_SATURATION,
} from "../../src/lib/domain/saturation";
import { dbToLinear } from "../../src/lib/domain/dsp";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
	if (ok) { passed++; return; }
	failed++;
	console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function almostEqual(a: number, b: number, eps = 1e-6): boolean {
	return Math.abs(a - b) < eps;
}

function maxAbs(arr: Float32Array): number {
	let mx = 0;
	for (let i = 0; i < arr.length; i++) {
		const a = Math.abs(arr[i]);
		if (a > mx) mx = a;
	}
	return mx;
}

function mean(arr: Float32Array): number {
	let s = 0;
	for (let i = 0; i < arr.length; i++) s += arr[i];
	return s / arr.length;
}

console.log("\n── Batch F: Asymmetric Saturation ──\n");

// ── 1. Identity at zero ──
{
	const input = new Float32Array(100);
	const out   = asymmetricSaturation(input);
	check("zero input → zero output", maxAbs(out) === 0);
}

// ── 2. Output same length ──
{
	const input = new Float32Array(256);
	input.fill(0.5);
	const out = asymmetricSaturation(input);
	check("output length matches input", out.length === 256);
}

// ── 3. No NaN or Infinity ──
{
	const input = new Float32Array(200);
	for (let i = 0; i < 200; i++) {
		input[i] = Math.sin(i * 0.1) * 0.9;
	}
	const out = asymmetricSaturation(input);
	let hasNaN = false;
	for (let i = 0; i < out.length; i++) {
		if (!isFinite(out[i]) || isNaN(out[i])) { hasNaN = true; break; }
	}
	check("no NaN or Infinity in output", !hasNaN);
}

// ── 4. Output does not explode for overdriven input ──
{
	const input = new Float32Array(200);
	for (let i = 0; i < 200; i++) {
		input[i] = Math.sin(i * 0.1) * 1.2; // overdriven
	}
	const out = asymmetricSaturation(input);
	check("overdriven input stays finite", maxAbs(out) < 2);
}

// ── 5. Asymmetry breaks even symmetry ──
{
	const input = new Float32Array(200);
	for (let i = 0; i < 200; i++) {
		input[i] = Math.sin(i * 0.1) * 0.8;
	}
	const symOut   = asymmetricSaturation(input, { asymmetry: 0 });
	const asymOut  = asymmetricSaturation(input, { asymmetry: 0.15 });
	// Asymmetry should produce a DC shift in the output
	const symDC  = mean(symOut);
	const asymDC = mean(asymOut);
	check("asymmetry changes DC offset (≠ symmetric)", Math.abs(asymDC - symDC) > 1e-7);
}

// ── 6. Drive increases saturation ──
{
	const input = new Float32Array(200);
	for (let i = 0; i < 200; i++) {
		input[i] = Math.sin(i * 0.1) * 0.5;
	}
	const lowDrive  = asymmetricSaturation(input, { drive: 1.1 });
	const highDrive = asymmetricSaturation(input, { drive: 3.0 });
	// High drive should produce higher peak (more saturated)
	const peakLow  = maxAbs(lowDrive);
	const peakHigh = maxAbs(highDrive);
	check("higher drive → higher peak (more saturation)", peakHigh >= peakLow - 1e-6);
}

// ── 7. Wet/dry mix creates blend ──
{
	const sine = new Float32Array(200);
	for (let i = 0; i < 200; i++) sine[i] = Math.sin(i * 0.1) * 0.5;
	const dryOut   = asymmetricSaturation(sine, { wetDryMix: 0 });
	const wetOut   = asymmetricSaturation(sine, { wetDryMix: 1 });
	check("wetDryMix=0 → output equals input (after trim)", almostEqual(maxAbs(dryOut), maxAbs(sine) * dbToLinear(DEFAULT_SATURATION.outputTrimDb), 1e-4));
	check("wetDryMix=1 → output is fully saturated", !almostEqual(maxAbs(wetOut), maxAbs(sine), 1e-3));
}

// ── 8. Dry/wet mix continuity ──
{
	const sine = new Float32Array(200);
	for (let i = 0; i < 200; i++) sine[i] = Math.sin(i * 0.1) * 0.5;
	const mixHalf  = asymmetricSaturation(sine, { wetDryMix: 0.5 });
	const fullDry  = asymmetricSaturation(sine, { wetDryMix: 0 });
	const fullWet  = asymmetricSaturation(sine, { wetDryMix: 1 });
	// 50% mix should not equal either extreme
	const diffDry  = maxAbs(new Float32Array(200).map((_, i) => mixHalf[i] - fullDry[i]));
	const diffWet  = maxAbs(new Float32Array(200).map((_, i) => mixHalf[i] - fullWet[i]));
	check("50% mix ≠ fully dry", diffDry > 1e-6);
	check("50% mix ≠ fully wet", diffWet > 1e-6);
}

// ── 9. Curve length is 2048 ──
{
	const curve = makeAsymmetricSaturationCurve();
	check("WaveShaper curve length = 2048", curve.length === 2048);
}

// ── 10. Curve has no large discontinuities ──
{
	const curve = makeAsymmetricSaturationCurve();
	let maxDrop = 0;
	for (let i = 1; i < curve.length; i++) {
		const drop = curve[i - 1] - curve[i];
		if (drop > maxDrop) maxDrop = drop;
	}
	// Allow small non-monotonic dips from bias compensation;
	// reject drops > 0.05 (which would be audible zipper noise)
	check("curve max drop < 0.05 (no large discontinuities)", maxDrop < 0.05);
}

// ── 11. Curve centred (midpoint near 0) ──
{
	const curve = makeAsymmetricSaturationCurve();
	const mid = (curve[1023] + curve[1024]) / 2;
	check("curve midpoint near 0", Math.abs(mid) < 0.01);
}

// ── 12. Curve with asymmetry ≠ curve without ──
{
	const symCurve  = makeAsymmetricSaturationCurve({ asymmetry: 0 });
	const asymCurve = makeAsymmetricSaturationCurve({ asymmetry: 0.15 });
	const maxDiff = maxAbs(new Float32Array(2048).map((_, i) => symCurve[i] - asymCurve[i]));
	check("asymmetric curve ≠ symmetric curve", maxDiff > 1e-6);
}

// ── 13. Determinism ──
{
	const input = new Float32Array(200);
	for (let i = 0; i < 200; i++) input[i] = Math.sin(i * 0.1) * 0.7;
	const a = asymmetricSaturation(input);
	const b = asymmetricSaturation(input);
	check("deterministic output", a.every((v, i) => v === b[i]));
}

// ── 14. Edge: empty input ──
{
	const out = asymmetricSaturation(new Float32Array(0));
	check("empty input → empty output", out.length === 0);
}

// ── 15. Edge: single sample ──
{
	const input = new Float32Array([0.5]);
	const out   = asymmetricSaturation(input);
	check("single sample produces output", out.length === 1);
	check("single sample is finite", isFinite(out[0]));
}

// ── 16. Edge: full-scale input ──
{
	const input = new Float32Array(200);
	input.fill(1.0);
	const out = asymmetricSaturation(input);
	check("full-scale input produces finite output", isFinite(out[0]) && maxAbs(out) < 2);
}

// ── Summary ──

const total = passed + failed;
console.log(`\n  ✓ ${passed} / ${total} checks passed${failed > 0 ? `, ✗ ${failed} failed` : ""}\n`);
process.exit(failed > 0 ? 1 : 0);
