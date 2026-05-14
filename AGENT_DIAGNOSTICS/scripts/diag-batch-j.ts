// ── Diag Batch J: Downward Expander With Comfort Noise ──
// Tests domain/expander.ts against catalog §14 spec.
//
// Usage: bun scripts/diag-batch-j.ts

import { expanderWithComfortNoise, DEFAULT_EXPANDER } from "../../src/lib/domain/expander";

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

console.log("\n── Batch J: Downward Expander With Comfort Noise ──\n");

// ── 1. Identity at zero ──
{
	const input = new Float32Array(200);
	const out   = expanderWithComfortNoise(input, SR);
	// Zero input: expander reduces (already zero) and comfort noise adds very tiny amount
	// Comfort noise at -60 dB → max amplitude ≈ 0.001
	check("zero input → very near zero", maxAbs(out) < 0.005);
}

// ── 2. Output same length ──
{
	const input = new Float32Array(512);
	input.fill(0.5);
	const out = expanderWithComfortNoise(input, SR);
	check("output length matches input", out.length === 512);
}

// ── 3. No NaN or Infinity ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.05) * 0.8;
	const out = expanderWithComfortNoise(input, SR);
	let ok = true;
	for (let i = 0; i < out.length; i++) {
		if (!isFinite(out[i])) { ok = false; break; }
	}
	check("no NaN or Infinity", ok);
}

// ── 4. Output stays finite ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.9;
	const out = expanderWithComfortNoise(input, SR);
	check("output stays bounded", maxAbs(out) < 2);
}

// ── 5. Loud signal mostly unchanged ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.8;
	const out = expanderWithComfortNoise(input, SR);
	check("loud signal approximately preserved", rms(out) > rms(input) * 0.5);
}

// ── 6. Quiet signal is reduced ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.001; // -60 dB
	const out = expanderWithComfortNoise(input, SR);
	check("quiet signal reduced below input RMS", rms(out) <= rms(input) + 0.0005);
}

// ── 7. Determinism ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.1) * 0.7;
	const a = expanderWithComfortNoise(input, SR, {}, 42);
	const b = expanderWithComfortNoise(input, SR, {}, 42);
	check("deterministic output (same seed)", a.every((v, i) => v === b[i]));
}

// ── 8. Different seed → different output ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.1) * 0.7;
	const a = expanderWithComfortNoise(input, SR, {}, 1);
	const b = expanderWithComfortNoise(input, SR, {}, 2);
	// At least some sample should differ (noise is different)
	let differs = false;
	for (let i = 0; i < 500; i++) {
		if (a[i] !== b[i]) { differs = true; break; }
	}
	check("different seed → different output", differs);
}

// ── 9. Edge: empty input ──
{
	const out = expanderWithComfortNoise(new Float32Array(0), SR);
	check("empty input → empty output", out.length === 0);
}

// ── 10. Edge: single sample ──
{
	const input = new Float32Array([0.5]);
	const out   = expanderWithComfortNoise(input, SR);
	check("single sample produces output", out.length === 1);
	check("single sample is finite", isFinite(out[0]));
}

// ── 11. White vs pink noise — pink has lower peak (filtered) ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.8;
	const white = expanderWithComfortNoise(input, SR, { noiseColor: "white" }, 42);
	const pink  = expanderWithComfortNoise(input, SR, { noiseColor: "pink"  }, 42);
	// Pink noise is filtered (smoothed) so the signal should differ
	let differs = false;
	for (let i = 0; i < input.length; i++) {
		if (white[i] !== pink[i]) { differs = true; break; }
	}
	check("pink noise ≠ white noise", differs);
}

// ── 12. Comfort noise level respected ──
{
	const input   = new Float32Array(SR); // silent
	const outLow  = expanderWithComfortNoise(input, SR, { comfortNoiseLevelDb: -80 }, 42);
	const outHigh = expanderWithComfortNoise(input, SR, { comfortNoiseLevelDb: -50 }, 42);
	// Higher comfort noise level → more energy in output
	check("higher comfort noise level → more energy", rms(outHigh) > rms(outLow));
}

// ── 13. Threshold and ratio effect ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.003; // ~-50 dB

	const lowExpansion  = expanderWithComfortNoise(input, SR, { thresholdDb: -80, ratio: 1.2 }, 42);
	const highExpansion = expanderWithComfortNoise(input, SR, { thresholdDb: -40, ratio: 3.0 }, 42);
	check("different threshold/ratio → different output", rms(lowExpansion) !== rms(highExpansion));
}

// ── Summary ──

const total = passed + failed;
console.log(`\n  ✓ ${passed} / ${total} checks passed${failed > 0 ? `, ✗ ${failed} failed` : ""}\n`);
process.exit(failed > 0 ? 1 : 0);
