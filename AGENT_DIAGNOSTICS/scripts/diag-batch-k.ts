// ── Diag Batch K: Mono-Safe Pseudo-Stereo ──
// Tests domain/stereo.ts against catalog §15 spec.
//
// Usage: bun scripts/diag-batch-k.ts

import { monoSafePseudoStereo, DEFAULT_PSEUDO_STEREO } from "../../src/lib/domain/stereo";

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

console.log("\n── Batch K: Mono-Safe Pseudo-Stereo ──\n");

// ── 1. Zero input → zero output ──
{
	const mono = new Float32Array(200);
	const { left, right } = monoSafePseudoStereo(mono, SR);
	check("zero input → zero left", maxAbs(left) === 0);
	check("zero input → zero right", maxAbs(right) === 0);
}

// ── 2. Output same length ──
{
	const mono = new Float32Array(512);
	mono.fill(0.5);
	const { left, right } = monoSafePseudoStereo(mono, SR);
	check("left length matches input", left.length === 512);
	check("right length matches input", right.length === 512);
}

// ── 3. No NaN or Infinity ──
{
	const mono = new Float32Array(500);
	for (let i = 0; i < 500; i++) mono[i] = Math.sin(i * 0.05) * 0.8;
	const { left, right } = monoSafePseudoStereo(mono, SR);
	let ok = true;
	for (let i = 0; i < left.length; i++) {
		if (!isFinite(left[i]) || !isFinite(right[i])) { ok = false; break; }
	}
	check("no NaN or Infinity", ok);
}

// ── 4. Mono sum recovers original (mono-safe property) ──
{
	const mono = new Float32Array(SR);
	for (let i = 0; i < SR; i++) mono[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.5;
	const { left, right } = monoSafePseudoStereo(mono, SR);
	let maxError = 0;
	for (let i = 0; i < SR; i++) {
		const monoSum = (left[i] + right[i]) / 2;
		const error = Math.abs(monoSum - mono[i]);
		if (error > maxError) maxError = error;
	}
	// Float32 operations introduce ~1e-7 precision limits
	check("mono sum recovers original (mid/side identity)", maxError < 1e-6);
}

// ── 5. Left ≠ Right (stereo separation when width > 0) ──
{
	const mono = new Float32Array(SR);
	for (let i = 0; i < SR; i++) mono[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.5;
	const { left, right } = monoSafePseudoStereo(mono, SR);
	let differs = false;
	for (let i = 0; i < SR; i++) {
		if (Math.abs(left[i] - right[i]) > 1e-10) { differs = true; break; }
	}
	check("left ≠ right (stereo separation)", differs);
}

// ── 6. Width = 0 → left == right (mid only) ──
{
	const mono = new Float32Array(SR);
	for (let i = 0; i < SR; i++) mono[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.5;
	const { left, right } = monoSafePseudoStereo(mono, SR, { width: 0 });
	let maxDiff = 0;
	for (let i = 0; i < SR; i++) {
		const diff = Math.abs(left[i] - right[i]);
		if (diff > maxDiff) maxDiff = diff;
	}
	check("width = 0 → left ≈ right (same channel)", maxDiff < 1e-10);
}

// ── 7. Wider width → more separation ──
{
	const mono = new Float32Array(SR);
	for (let i = 0; i < SR; i++) mono[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.5;
	const narrow = monoSafePseudoStereo(mono, SR, { width: 0.05 });
	const wide   = monoSafePseudoStereo(mono, SR, { width: 0.35 });
	const narrowDiff = new Float32Array(SR);
	const wideDiff   = new Float32Array(SR);
	for (let i = 0; i < SR; i++) {
		narrowDiff[i] = Math.abs(narrow.left[i] - narrow.right[i]);
		wideDiff[i]   = Math.abs(wide.left[i] - wide.right[i]);
	}
	check("wider width → more L/R separation", rms(wideDiff) > rms(narrowDiff));
}

// ── 8. Determinism ──
{
	const mono = new Float32Array(500);
	for (let i = 0; i < 500; i++) mono[i] = Math.sin(i * 0.1) * 0.7;
	const a = monoSafePseudoStereo(mono, SR);
	const b = monoSafePseudoStereo(mono, SR);
	check("deterministic left channel", a.left.every((v, i) => v === b.left[i]));
	check("deterministic right channel", a.right.every((v, i) => v === b.right[i]));
}

// ── 9. Edge: empty input ──
{
	const { left, right } = monoSafePseudoStereo(new Float32Array(0), SR);
	check("empty input → empty left", left.length === 0);
	check("empty input → empty right", right.length === 0);
}

// ── 10. Edge: single sample ──
{
	const mono = new Float32Array([0.5]);
	const { left, right } = monoSafePseudoStereo(mono, SR);
	check("single sample produces left", left.length === 1);
	check("single sample produces right", right.length === 1);
	check("single sample left is finite", isFinite(left[0]));
	check("single sample right is finite", isFinite(right[0]));
	// Single sample with delay: no delayed sample available, side = 0
	const monoSum = (left[0] + right[0]) / 2;
	check("single sample mono sum correct", Math.abs(monoSum - mono[0]) < 1e-10);
}

// ── 11. Output level reasonable ──
{
	const mono = new Float32Array(SR);
	for (let i = 0; i < SR; i++) mono[i] = Math.sin(2 * Math.PI * 400 * i / SR) * 0.8;
	const { left, right } = monoSafePseudoStereo(mono, SR);
	check("left channel bounded", maxAbs(left) < 2);
	check("right channel bounded", maxAbs(right) < 2);
}

// ── Summary ──

const total = passed + failed;
console.log(`\n  ✓ ${passed} / ${total} checks passed${failed > 0 ? `, ✗ ${failed} failed` : ""}\n`);
process.exit(failed > 0 ? 1 : 0);
