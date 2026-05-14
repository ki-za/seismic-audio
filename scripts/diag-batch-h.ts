// ── Diag Batch H: Three-Band Multiband Compressor ──
// Tests domain/multiband.ts against catalog §11 spec.
//
// Usage: bun scripts/diag-batch-h.ts

import { threeBandCompressor, compressSingleBand, DEFAULT_MULTIBAND } from "../src/lib/domain/multiband";
import type { BandCompressorParams, MultibandParams } from "../src/lib/domain/types";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
	if (ok) { passed++; return; }
	failed++;
	console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function maxAbs(arr: Float32Array): number {
	let mx = 0;
	for (let i = 0; i < arr.length; i++) {
		const a = Math.abs(arr[i]);
		if (a > mx) mx = a;
	}
	return mx;
}

function rms(arr: Float32Array): number {
	let s = 0;
	for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
	return Math.sqrt(s / arr.length);
}

const SR = 44100;

console.log("\n── Batch H: Three-Band Multiband Compressor ──\n");

// ── 1. Identity at zero ──
{
	const input = new Float32Array(200);
	const out   = threeBandCompressor(input, SR);
	check("zero input → zero output", maxAbs(out) === 0);
}

// ── 2. Output same length ──
{
	const input = new Float32Array(512);
	input.fill(0.5);
	const out = threeBandCompressor(input, SR);
	check("output length matches input", out.length === 512);
}

// ── 3. No NaN or Infinity ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.05) * 0.8;
	const out = threeBandCompressor(input, SR);
	let ok = true;
	for (let i = 0; i < out.length; i++) {
		if (!isFinite(out[i])) { ok = false; break; }
	}
	check("no NaN or Infinity", ok);
}

// ── 4. Output bounded — compressor reduces peaks ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.9;
	const out = threeBandCompressor(input, SR);
	// Filter transients can cause slight overshoot at band boundaries
	check("output stays bounded", maxAbs(out) < 1.5);
}

// ── 5. Output RMS lower than input (compression) ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.8;
	const out = threeBandCompressor(input, SR, {
		bands: [
			{ thresholdDb: -20, ratio: 4, attackMs: 1, releaseMs: 50, makeupDb: 0 },
			{ thresholdDb: -20, ratio: 4, attackMs: 1, releaseMs: 50, makeupDb: 0 },
			{ thresholdDb: -20, ratio: 4, attackMs: 1, releaseMs: 50, makeupDb: 0 },
		],
	});
	// With 0 makeup gain, output should be quieter on sustained tones
	check("compression reduces RMS (with 0 makeup)", rms(out) <= rms(input) + 1e-6);
}

// ── 6. Band reconstitution — sum of bands approximates input (null test) ──
{
	// Low-frequency sine: should mostly pass through
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 100 * i / SR) * 0.5;

	// With no compression (high threshold, ratio=1), output should be close to input
	const out = threeBandCompressor(input, SR, {
		lowCrossoverHz: 250,
		highCrossoverHz: 3500,
		bands: [
			{ thresholdDb: 100, ratio: 1, attackMs: 1, releaseMs: 1, makeupDb: 0 },
			{ thresholdDb: 100, ratio: 1, attackMs: 1, releaseMs: 1, makeupDb: 0 },
			{ thresholdDb: 100, ratio: 1, attackMs: 1, releaseMs: 1, makeupDb: 0 },
		],
	});
	// LR crossovers sum cleanly by design — small residual from filter startup
	const diff = new Float32Array(SR);
	for (let i = 0; i < SR; i++) diff[i] = Math.abs(out[i] - input[i]);
	const maxDiff = maxAbs(diff);
	check("no-compression band sum ≈ input (null test)", maxDiff < 0.2);
}

// ── 7. Silence preserved ──
{
	const input = new Float32Array(200);
	const out   = threeBandCompressor(input, SR);
	check("silence → near-silence output", maxAbs(out) < 1e-10);
}

// ── 8. Determinism ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.1) * 0.7;
	const a = threeBandCompressor(input, SR);
	const b = threeBandCompressor(input, SR);
	check("deterministic output", a.every((v, i) => v === b[i]));
}

// ── 9. Edge: empty input ──
{
	const out = threeBandCompressor(new Float32Array(0), SR);
	check("empty input → empty output", out.length === 0);
}

// ── 10. Edge: single sample ──
{
	const input = new Float32Array([0.5]);
	const out   = threeBandCompressor(input, SR);
	check("single sample produces output", out.length === 1);
	check("single sample is finite", isFinite(out[0]));
}

// ── 11. compressSingleBand reduces level above threshold ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.6;

	const params: BandCompressorParams = {
		thresholdDb: -10,
		ratio: 4,
		attackMs: 1,
		releaseMs: 50,
		makeupDb: 0,
	};

	const out = compressSingleBand(input, SR, params);
	// With 0 makeup, output should be quieter
	check("compressSingleBand reduces RMS", rms(out) <= rms(input) - 0.01);
}

// ── 12. compressSingleBand identity at high threshold ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.3;

	const params: BandCompressorParams = {
		thresholdDb: 100, // unreachable
		ratio: 4,
		attackMs: 1,
		releaseMs: 1,
		makeupDb: 0,
	};

	const out = compressSingleBand(input, SR, params);
	const diff = new Float32Array(SR);
	for (let i = 0; i < SR; i++) diff[i] = Math.abs(out[i] - input[i]);
	check("very high threshold → near-identity", maxAbs(diff) < 0.001);
}

// ── Summary ──

const total = passed + failed;
console.log(`\n  ✓ ${passed} / ${total} checks passed${failed > 0 ? `, ✗ ${failed} failed` : ""}\n`);
process.exit(failed > 0 ? 1 : 0);
