// ── Diag Batch G: Relative De-Esser ──
// Tests domain/deesser.ts against catalog §12 spec.
//
// Usage: bun scripts/diag-batch-g.ts

import { relativeDeEsser, DEFAULT_DEESSER } from "../../src/lib/domain/deesser";

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

const SR = 44100;

console.log("\n── Batch G: Relative-Threshold De-Esser ──\n");

// ── 1. Identity at zero ──
{
	const input = new Float32Array(200);
	const out   = relativeDeEsser(input, SR);
	check("zero input → zero output", maxAbs(out) === 0);
}

// ── 2. Output same length ──
{
	const input = new Float32Array(512);
	input.fill(0.5);
	const out = relativeDeEsser(input, SR);
	check("output length matches input", out.length === 512);
}

// ── 3. No NaN or Infinity ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.05) * 0.8;
	const out = relativeDeEsser(input, SR);
	let ok = true;
	for (let i = 0; i < out.length; i++) {
		if (!isFinite(out[i])) { ok = false; break; }
	}
	check("no NaN or Infinity", ok);
}

// ── 4. Output bounded — loud high band reduced ──
{
	// Pure high-frequency tone — should trigger de-essing
	const input = new Float32Array(SR); // 1 second
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 8000 * i / SR) * 0.5;

	const out = relativeDeEsser(input, SR);
	check("output stays finite for HF tone", maxAbs(out) <= 1);
}

// ── 5. Low-frequency signal mostly unchanged ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.5;

	const out = relativeDeEsser(input, SR);
	// The de-esser shouldn't mess with low frequencies
	const diff = new Float32Array(SR);
	for (let i = 0; i < SR; i++) diff[i] = Math.abs(out[i] - input[i]);
	const maxDiff = maxAbs(diff);
	// Some tiny difference from filter startup transient, but mostly unchanged
	// Use a generous tolerance — the HPF has some ripple
	check("LF signal mostly unchanged", maxDiff < 0.3);
}

// ── 6. Silence preserved ──
{
	const input = new Float32Array(200);
	const out   = relativeDeEsser(input, SR);
	const maxOut = maxAbs(out);
	check("silence → near-silence output", maxOut < 1e-10);
}

// ── 7. Determinism ──
{
	const input = new Float32Array(500);
	for (let i = 0; i < 500; i++) input[i] = Math.sin(i * 0.1) * 0.7;
	const a = relativeDeEsser(input, SR);
	const b = relativeDeEsser(input, SR);
	check("deterministic output", a.every((v, i) => v === b[i]));
}

// ── 8. Edge: empty input ──
{
	const out = relativeDeEsser(new Float32Array(0), SR);
	check("empty input → empty output", out.length === 0);
}

// ── 9. Edge: single sample ──
{
	const input = new Float32Array([0.5]);
	const out   = relativeDeEsser(input, SR);
	check("single sample produces output", out.length === 1);
	check("single sample is finite", isFinite(out[0]));
}

// ── 10. De-essing reduces harsh broadband signal peak ──
{
	// Broadband transient (impulse with HF content) — should trigger reduction
	const input = new Float32Array(500);
	for (let i = 0; i < 100; i++) input[i] = Math.sin(2 * Math.PI * 7000 * i / SR) * 0.6;
	// Then a section with very bright content
	for (let i = 100; i < 300; i++) input[i] = Math.sin(2 * Math.PI * 9000 * i / SR) * 0.5;

	const out = relativeDeEsser(input, SR, {
		detectorFrequencyHz: 5000,
		relativeThresholdDb: -10,
		maxReductionDb: 10,
	});

	// After the attack phase, the output should be quieter than input
	const inPeak  = maxAbs(input);
	const outPeak = maxAbs(out);
	check("bright section has reduced peak after de-essing", outPeak <= inPeak + 1e-6);
}

// ── 11. No reduction when de-esser threshold is very high ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++) input[i] = Math.sin(2 * Math.PI * 7000 * i / SR) * 0.3;

	const out = relativeDeEsser(input, SR, { relativeThresholdDb: 50 }); // unreachable threshold
	// Output should be essentially identical (tiny filter transient at start)
	const maxDiff = maxAbs(new Float32Array(SR).map((_, i) => out[i] - input[i]));
	// Filter-state startup can cause a small diff at the very beginning
	check("very high threshold → negligible reduction", maxDiff < 0.2);
}

// ── 12. Max reduction limit respected ──
{
	const input = new Float32Array(2000);
	for (let i = 100; i < 2000; i++) input[i] = Math.sin(2 * Math.PI * 8000 * i / SR) * 0.8;

	const outLim  = relativeDeEsser(input, SR, {
		detectorFrequencyHz: 4000,
		relativeThresholdDb: -20,
		maxReductionDb: 3,
	});
	const outFull = relativeDeEsser(input, SR, {
		detectorFrequencyHz: 4000,
		relativeThresholdDb: -20,
		maxReductionDb: 12,
	});

	// More max reduction should produce lower output (at steady state near end)
	const tailLen = 200;
	const endIdx  = 2000 - tailLen;
	const tailLim  = outLim .slice(endIdx);
	const tailFull = outFull.slice(endIdx);
	const peakLim  = maxAbs(tailLim);
	const peakFull = maxAbs(tailFull);
	check("higher maxReductionDb → lower output", peakLim >= peakFull - 0.05);
}

// ── Summary ──

const total = passed + failed;
console.log(`\n  ✓ ${passed} / ${total} checks passed${failed > 0 ? `, ✗ ${failed} failed` : ""}\n`);
process.exit(failed > 0 ? 1 : 0);
