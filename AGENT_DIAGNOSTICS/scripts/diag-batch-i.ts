// ── Diag Batch I: Dynamic EQ / Adaptive Resonance Cut ──
// Tests domain/dynamic-eq.ts against catalog §13 spec.
//
// Usage: bun scripts/diag-batch-i.ts

import { dynamicResonanceCut, DEFAULT_DYNAMIC_EQ } from "../../src/lib/domain/dynamic-eq";

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

console.log("\n── Batch I: Dynamic EQ / Adaptive Resonance Cut ──\n");

// ── 1. Identity at zero ──
{
	const input = new Float32Array(200);
	const out   = dynamicResonanceCut(input, SR);
	check("zero input → zero output", maxAbs(out) === 0);
}

// ── 2. Output same length ──
{
	const input = new Float32Array(512);
	input.fill(0.5);
	const out = dynamicResonanceCut(input, SR);
	check("output length matches input", out.length === 512);
}

// ── 3. No NaN or Infinity ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.05) * 0.8;
	const out = dynamicResonanceCut(input, SR);
	let ok = true;
	for (let i = 0; i < out.length; i++) {
		if (!isFinite(out[i])) { ok = false; break; }
	}
	check("no NaN or Infinity", ok);
}

// ── 4. Output stays finite ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 4000 * i / SR) * 0.9;
	const out = dynamicResonanceCut(input, SR);
	check("output stays finite", maxAbs(out) < 2);
}

// ── 5. Frequency at target band is reduced more than other frequencies ──
{
	// Signal with energy at the target frequency
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 4000 * i / SR) * 0.5;
	const out = dynamicResonanceCut(input, SR, {
		frequencyHz: 4000,
		Q: 4,
		thresholdDb: -40,
		maxCutDb: 9,
		attackMs: 1,
		releaseMs: 50,
	});
	// The output should have less energy at this frequency
	check("energy reduced at target frequency", rms(out) <= rms(input) * 0.95);
}

// ── 6. Different frequency (outside band) less affected ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.5;
	const out = dynamicResonanceCut(input, SR, {
		frequencyHz: 4000,
		Q: 4,
		thresholdDb: -40,
		maxCutDb: 9,
		attackMs: 1,
		releaseMs: 50,
	});
	// Low frequency should be mostly unaffected (high Q, different band)
	// but the bandpass filter still leaks some energy
	// Just check it's not reducing drastically
	check("different frequency less affected", rms(out) > rms(input) * 0.5);
}

// ── 7. Silence preserved ──
{
	const input = new Float32Array(200);
	const out   = dynamicResonanceCut(input, SR);
	check("silence → near-silence output", maxAbs(out) < 1e-10);
}

// ── 8. Determinism ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.1) * 0.7;
	const a = dynamicResonanceCut(input, SR);
	const b = dynamicResonanceCut(input, SR);
	check("deterministic output", a.every((v, i) => v === b[i]));
}

// ── 9. Edge: empty input ──
{
	const out = dynamicResonanceCut(new Float32Array(0), SR);
	check("empty input → empty output", out.length === 0);
}

// ── 10. Edge: single sample ──
{
	const input = new Float32Array([0.5]);
	const out   = dynamicResonanceCut(input, SR);
	check("single sample produces output", out.length === 1);
	check("single sample is finite", isFinite(out[0]));
}

// ── 11. Very high threshold → no cut ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 4000 * i / SR) * 0.5;
	const out = dynamicResonanceCut(input, SR, {
		frequencyHz: 4000,
		thresholdDb: 100, // unreachable
		maxCutDb: 9,
	});
	const diff = new Float32Array(SR);
	for (let i = 0; i < SR; i++) diff[i] = Math.abs(out[i] - input[i]);
	check("very high threshold → near-identity", maxAbs(diff) < 0.2);
}

// ── Summary ──

const total = passed + failed;
console.log(`\n  ✓ ${passed} / ${total} checks passed${failed > 0 ? `, ✗ ${failed} failed` : ""}\n`);
process.exit(failed > 0 ? 1 : 0);
