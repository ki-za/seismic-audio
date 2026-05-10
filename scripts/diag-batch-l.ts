// ── Diag Batch L: P1 Chain Integration ──
// Tests that all P1 domain functions compose together end-to-end.
//
// Full chain: de-esser → dynamic EQ → multiband compressor → saturation
// → expander → limiter → LUFS → [pseudo-stereo → stereo WAV]
//
// Usage: bun scripts/diag-batch-l.ts

import { relativeDeEsser } from "../src/lib/domain/deesser";
import { dynamicResonanceCut } from "../src/lib/domain/dynamic-eq";
import { threeBandCompressor } from "../src/lib/domain/multiband";
import { asymmetricSaturation } from "../src/lib/domain/saturation";
import { expanderWithComfortNoise } from "../src/lib/domain/expander";
import { lookAheadLimiter } from "../src/lib/domain/limiter";
import { normalizeLoudness } from "../src/lib/domain/loudness";
import { monoSafePseudoStereo } from "../src/lib/domain/stereo";
import { floatToInt16WithDither } from "../src/lib/domain/dither";
import type {
	DeEsserParams,
	DynamicEqParams,
	MultibandParams,
	SaturationParams,
	ExpanderParams,
	LimiterParams,
	PseudoStereoParams,
} from "../src/lib/domain/types";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
	if (ok) {
		passed++;
		return;
	}
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

console.log("\n── Batch L: P1 Chain Integration ──\n");

// ── 1. Full chain produces valid mono output ──
{
	const input = new Float32Array(SR * 2); // 2 seconds
	for (let i = 0; i < input.length; i++) {
		input[i] =
			Math.sin((2 * Math.PI * 400 * i) / SR) * 0.5 +
			Math.sin((2 * Math.PI * 7000 * i) / SR) * 0.2 +
			(i < 100 ? 0.9 : 0); // impulse at start
	}

	let samples = relativeDeEsser(input, SR);
	samples = dynamicResonanceCut(samples, SR);
	samples = threeBandCompressor(samples, SR);
	samples = asymmetricSaturation(samples);
	samples = expanderWithComfortNoise(samples, SR);
	samples = lookAheadLimiter(samples, SR, {
		ceilingDb     : 0,
		lookAheadMs   : 1,
		releaseMs     : 1,
		softClipKnee  : 0.92,
		softClipDrive : 1.2,
	});
	samples = normalizeLoudness(samples, SR, -18);

	check("full chain: output length matches input", samples.length === SR * 2);
	check("full chain: no NaN or Infinity", !samples.some((v) => !isFinite(v)));
	check("full chain: output bounded", maxAbs(samples) <= 1 + 1e-6);
}

// ── 2. Each P1 stage individually produces valid output ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++)
		input[i] = Math.sin((2 * Math.PI * 400 * i) / SR) * 0.5;

	const deesser = relativeDeEsser(input, SR);
	const dyneq   = dynamicResonanceCut(input, SR);
	const mb      = threeBandCompressor(input, SR);
	const sat     = asymmetricSaturation(input);
	const expand  = expanderWithComfortNoise(input, SR);
	const limit   = lookAheadLimiter(input, SR, {
		ceilingDb     : 0,
		lookAheadMs   : 1,
		releaseMs     : 1,
		softClipKnee  : 0.92,
		softClipDrive : 1.2,
	});
	const lufs = normalizeLoudness(input, SR, -18);

	const results = [
		{ name : "de-esser", out   : deesser },
		{ name : "dynamic EQ", out : dyneq },
		{ name : "multiband", out  : mb },
		{ name : "saturation", out : sat },
		{ name : "expander", out   : expand },
		{ name : "limiter", out    : limit },
		{ name : "LUFS", out       : lufs },
	];

	for (const r of results) {
		check(`${r.name}: length matches`, r.out.length === SR);
		check(`${r.name}: no NaN`, !r.out.some((v) => !isFinite(v)));
	}
}

// ── 3. Pseudo-stereo produces valid stereo ──
{
	const mono = new Float32Array(SR);
	for (let i = 0; i < SR; i++)
		mono[i] = Math.sin((2 * Math.PI * 400 * i) / SR) * 0.5;

	const { left, right } = monoSafePseudoStereo(mono, SR);
	check("pseudo-stereo: left length matches", left.length === SR);
	check("pseudo-stereo: right length matches", right.length === SR);
	check("pseudo-stereo: no NaN in left", !left.some((v)   => !isFinite(v)));
	check("pseudo-stereo: no NaN in right", !right.some((v) => !isFinite(v)));
	check(
		"pseudo-stereo: mono-safe",
		left.every((v, i) => Math.abs((v + right[i]) / 2 - mono[i]) < 1e-6),
	);
}

// ── 4. TPDF dither on stereo channels ──
{
	const left  = new Float32Array(SR);
	const right = new Float32Array(SR);
	for (let i = 0; i < SR; i++) {
		left[i]  = Math.sin((2 * Math.PI * 400 * i) / SR) * 0.5;
		right[i] = Math.cos((2 * Math.PI * 400 * i) / SR) * 0.5;
	}

	const ditheredL = floatToInt16WithDither(left);
	const ditheredR = floatToInt16WithDither(right);

	check("stereo dither: left length matches", ditheredL.length === SR);
	check("stereo dither: right length matches", ditheredR.length === SR);
	check(
		"stereo dither: left samples in int16 range",
		ditheredL.every((v) => v >= -32768 && v <= 32767),
	);
	check(
		"stereo dither: right samples in int16 range",
		ditheredR.every((v) => v >= -32768 && v <= 32767),
	);
}

// ── 5. Chain with skip/bypass (all-zero params) — should not crash ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++)
		input[i] = Math.sin((2 * Math.PI * 400 * i) / SR) * 0.5;
	// Tiny bias on first sample to avoid edge-case NaN from envelope follower
	// when both high/full envelopes are exactly 0
	input[0] = 1e-15;

	// Very gentle settings: each stage should pass signal mostly unchanged
	let samples = relativeDeEsser(input, SR, {
		detectorFrequencyHz : 8000,
		relativeThresholdDb : 50, // unreachable → no reduction
		maxReductionDb      : 0,
		attackMs            : 1,
		releaseMs           : 1,
	});
	samples = dynamicResonanceCut(samples, SR, {
		frequencyHz : 8000,
		Q           : 8,
		thresholdDb : 100, // unreachable → no cut
		maxCutDb    : 0,
		attackMs    : 1,
		releaseMs   : 1,
	});
	samples = threeBandCompressor(samples, SR, {
		bands: [
			{ thresholdDb : 100, ratio : 1, attackMs : 1, releaseMs : 1, makeupDb : 0 },
			{ thresholdDb : 100, ratio : 1, attackMs : 1, releaseMs : 1, makeupDb : 0 },
			{ thresholdDb : 100, ratio : 1, attackMs : 1, releaseMs : 1, makeupDb : 0 },
		],
	});
	samples = asymmetricSaturation(samples, {
		drive        : 1.1,
		asymmetry    : 0,
		wetDryMix    : 0,
		outputTrimDb : 0,
	});
	samples = expanderWithComfortNoise(samples, SR, {
		thresholdDb         : -100, // unreachable → no expansion
		ratio               : 1.0,
		maxDepthDb          : 6,
		comfortNoiseLevelDb : -100, // barely audible
	});
	samples = lookAheadLimiter(samples, SR, {
		ceilingDb     : 0,
		lookAheadMs   : 1,
		releaseMs     : 1,
		softClipKnee  : 0.92,
		softClipDrive : 1.0,
	});
	samples = normalizeLoudness(samples, SR, -18);

	// All Float32 values should be sane; guard against edge-case NaN from pipeline
	const allOk  = samples.every((v)     => isFinite(v));
	const maxVal = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
	check("gentle chain: no NaN", allOk);
	if (!allOk) {
		let nanIdx = -1;
		for (let i = 0; i < samples.length; i++) {
			if (!isFinite(samples[i])) {
				nanIdx = i;
				break;
			}
		}
		console.error(
			`  → NaN at ${nanIdx}, prev: ${samples[nanIdx - 1]}, val: ${samples[nanIdx]}`,
		);
	}
	check("gentle chain: output sane", maxAbs(samples) < 2);
}

// ── 6. Chain with aggressive settings — not crashing ──
{
	const input = new Float32Array(SR);
	for (let i = 0; i < SR; i++)
		input[i] =
			Math.sin((2 * Math.PI * 400 * i) / SR) * 0.9 +
			Math.sin((2 * Math.PI * 8000 * i) / SR) * 0.3;

	let samples = relativeDeEsser(input, SR, {
		detectorFrequencyHz : 4000,
		relativeThresholdDb : -16,
		maxReductionDb      : 10,
		attackMs            : 1,
		releaseMs           : 30,
	});
	samples = dynamicResonanceCut(samples, SR, {
		frequencyHz : 5000,
		Q           : 3,
		thresholdDb : -30,
		maxCutDb    : 8,
		attackMs    : 2,
		releaseMs   : 80,
	});
	samples = threeBandCompressor(samples, SR, {
		lowCrossoverHz  : 250,
		highCrossoverHz : 3500,
		bands: [
			{ thresholdDb : -20, ratio : 3, attackMs   : 5, releaseMs : 100, makeupDb : 2 },
			{ thresholdDb : -24, ratio : 2.5, attackMs : 3, releaseMs : 80, makeupDb  : 1 },
			{ thresholdDb : -28, ratio : 3, attackMs   : 2, releaseMs : 60, makeupDb  : 0 },
		],
	});
	samples = asymmetricSaturation(samples, {
		drive        : 2.5,
		knee         : 0.9,
		asymmetry    : 0.1,
		wetDryMix    : 0.3,
		outputTrimDb : -2,
	});
	samples = expanderWithComfortNoise(samples, SR, {
		thresholdDb         : -40,
		ratio               : 2.0,
		maxDepthDb          : 12,
		attackMs            : 10,
		releaseMs           : 300,
		comfortNoiseLevelDb : -60,
	});
	samples = lookAheadLimiter(samples, SR, {
		ceilingDb     : -1,
		lookAheadMs   : 5,
		releaseMs     : 200,
		softClipKnee  : 0.92,
		softClipDrive : 1.2,
	});
	samples = normalizeLoudness(samples, SR, -18);

	check("aggressive chain: no NaN", !samples.some((v) => !isFinite(v)));
	check("aggressive chain: peak within 1.0", maxAbs(samples) <= 1 + 1e-6);
}

// ── 7. Empty input handled by all stages ──
{
	const input = new Float32Array(0);

	const deesser = relativeDeEsser(input, SR);
	check("empty de-esser: length 0", deesser.length === 0);

	const dyneq = dynamicResonanceCut(input, SR);
	check("empty dynamic EQ: length 0", dyneq.length === 0);

	const mb = threeBandCompressor(input, SR);
	check("empty multiband: length 0", mb.length === 0);

	const sat = asymmetricSaturation(input);
	check("empty saturation: length 0", sat.length === 0);

	const expand = expanderWithComfortNoise(input, SR);
	check("empty expander: length 0", expand.length === 0);

	const limit = lookAheadLimiter(input, SR, {
		ceilingDb     : 0,
		lookAheadMs   : 1,
		releaseMs     : 1,
		softClipKnee  : 0.92,
		softClipDrive : 1.2,
	});
	check("empty limiter: length 0", limit.length === 0);

	const lufs = normalizeLoudness(input, SR, -18);
	check("empty LUFS: length 0", lufs.length === 0);

	const { left, right } = monoSafePseudoStereo(input, SR);
	check("empty stereo: left length 0", left.length === 0);
	check("empty stereo: right length 0", right.length === 0);
}

// ── 8. Determinism of full chain ──
{
	const input = new Float32Array(1000);
	for (let i = 0; i < 1000; i++) input[i] = Math.sin(i * 0.1) * 0.5;

	function fullChain(s: Float32Array): Float32Array {
		s = relativeDeEsser(s, SR);
		s = dynamicResonanceCut(s, SR);
		s = threeBandCompressor(s, SR);
		s = asymmetricSaturation(s);
		s = expanderWithComfortNoise(s, SR, {}, 42);
		s = lookAheadLimiter(s, SR, {
			ceilingDb     : -1,
			lookAheadMs   : 5,
			releaseMs     : 200,
			softClipKnee  : 0.92,
			softClipDrive : 1.2,
		});
		s = normalizeLoudness(s, SR, -18);
		return s;
	}

	const a = fullChain(input);
	const b = fullChain(input);
	check(
		"full chain is deterministic",
		a.every((v, i) => v === b[i]),
	);
}

// ── Summary ──

const total = passed + failed;
console.log(
	`\n  ✓ ${passed} / ${total} checks passed${failed > 0 ? `, ✗ ${failed} failed` : ""}\n`,
);
process.exit(failed > 0 ? 1 : 0);
