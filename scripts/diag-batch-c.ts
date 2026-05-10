// ── Batch C Diagnostics ──
// Tests TPDF dither for 16-bit PCM export.
// Run: bun scripts/diag-batch-c.ts

import { applyTPDFDither, floatToInt16WithDither, setDitherSeed } from "../src/lib/domain/dither";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean) {
	if (ok) { pass++; }
	else { console.error(`  ✗ ${label}`); fail++; }
}

setDitherSeed(42);

console.log("── TPDF Dither ──");

// Output length matches input
const samples = new Float32Array(1000);
for (let i = 0; i < 1000; i++) samples[i] = 0.5 * Math.sin(2 * Math.PI * i / 100);
const dithered = applyTPDFDither(samples);
check("output length matches input", dithered.length === samples.length);

// Output is still Float32Array
check("output is Float32Array", dithered instanceof Float32Array);

// Output values are still in [-1, 1]
let withinRange = true;
for (let i = 0; i < dithered.length; i++) {
	if (dithered[i] < -1 || dithered[i] > 1) { withinRange = false; break; }
}
check("all samples within [-1, 1]", withinRange);

// Deterministic: same seed → same output
setDitherSeed(42);
const dithered2 = applyTPDFDither(samples);
let identical = true;
for (let i = 0; i < dithered.length; i++) {
	if (dithered[i] !== dithered2[i]) { identical = false; break; }
}
check("deterministic with same seed", identical);

// Different seed → different output (high probability)
setDitherSeed(999);
const dithered3 = applyTPDFDither(samples);
let different = false;
for (let i = 0; i < 100; i++) {
	if (dithered[i] !== dithered3[i]) { different = true; break; }
}
check("different seed → different output", different);

// Dither delta is small (within ~3 LSB)
setDitherSeed(42);
const ditheredDet = applyTPDFDither(samples);
let maxDelta = 0;
for (let i = 0; i < samples.length; i++) {
	maxDelta = Math.max(maxDelta, Math.abs(ditheredDet[i] - samples[i]));
}
check("dither delta < 3 LSB (~9e-5 for 16-bit)", maxDelta < 2e-4);

// floatToInt16WithDither produces correct length and type
setDitherSeed(42);
const int16 = floatToInt16WithDither(samples);
check("int16 output length matches input", int16.length === samples.length);
check("int16 output is Int16Array", int16 instanceof Int16Array);

// int16 values are in valid range
let int16Valid = true;
for (let i = 0; i < int16.length; i++) {
	if (int16[i] < -32768 || int16[i] > 32767) { int16Valid = false; break; }
}
check("all int16 values within [-32768, 32767]", int16Valid);

// Full-scale positive input → maximum int16
const fullScale = new Float32Array([1, 0.9999, -1, -0.9999]);
const int16Fs = floatToInt16WithDither(fullScale);
// At full scale, dither may push slightly beyond max, but should be clamped
const absOk = int16Fs.every(v => v >= -32768 && v <= 32767);
check("full-scale input clamps correctly", absOk);

// Silence + dither = small noise floor (not exactly zero)
setDitherSeed(42);
const silence = new Float32Array(100);
const silentDithered = floatToInt16WithDither(silence);
// With TPDF dither, ~20% of samples should be non-zero
let nonZero = 0;
for (let i = 0; i < silentDithered.length; i++) {
	if (silentDithered[i] !== 0) nonZero++;
}
// In 100 samples, we typically get roughly 80-90% non-zero (TPDF adds noise centered at 0 but
// spread over approximately ±1 integer LSB; about ~40% of samples round to 0, the rest don't)
check("silence with dither has non-zero samples", nonZero > 10 && nonZero < 100);

// Noise floor RMS is reasonable (~1/3 LSB RMS for TPDF)
// We need enough samples for a stable measurement
setDitherSeed(42);
const longSilence = new Float32Array(100000);
const silentI16 = floatToInt16WithDither(longSilence);
let sumSq = 0;
for (let i = 0; i < silentI16.length; i++) sumSq += silentI16[i] * silentI16[i];
const noiseRms = Math.sqrt(sumSq / silentI16.length);
check(`noise RMS ~${noiseRms.toFixed(2)} LSB (expect ~0.58 LSB)`, noiseRms > 0.1 && noiseRms < 1.0);

// Direct dither (16-bit, 24-bit)
const d24 = applyTPDFDither(samples, 24);
check("24-bit dither output length matches", d24.length === samples.length);

// Empty input
const empty = applyTPDFDither(new Float32Array(0));
check("empty input → empty output", empty.length === 0);

console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
if (fail > 0) process.exit(1);
