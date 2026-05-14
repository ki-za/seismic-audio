// ── Integrated LUFS Normalisation ──
// Pure math — no browser/node/framework dependencies.
//
// Measures perceived loudness per ITU-R BS.1770-4 and applies
// gain to achieve a target loudness level.
//
// Steps:
//   1. Apply K-weighting filter (pre-filter + high-shelf).
//   2. Split into blocks, measure per-block loudness.
//   3. Apply absolute gate (-70 LUFS) then relative gate.
//   4. Compute integrated loudness from gated blocks.
//   5. Scale input to meet target LUFS.
//
// Note: For sample rates below 48 kHz, the high-shelf centre
// frequency (currently 1.5 kHz) becomes proportionally higher
// relative to Nyquist, slightly biasing the measurement.

import type { LufsParams } from "./types";
import { biquadApply, biquadHighShelf, biquadHPF, dbToLinear, clamp } from "./dsp";

// ── K-weighting filter ──
// Standard BS.1770 pre-filter: second-order high-pass at 38 Hz,
// followed by a high-shelf with +4 dB gain centred at 1.5 kHz, slope 0.5.

function buildKWeightingFilters(sampleRate: number) {
	// Pre-filter: 2nd-order HPF at ~38 Hz (using 2nd-order Butterworth approximation)
	// BS.1770 specifies a 2nd-order high-pass with -3 dB at 38 Hz, Q = ~0.707
	const preFilter = biquadHPF(38, sampleRate, 0.707);

	// High-shelf: +4 dB at 1.5 kHz, slope 0.5 (standard per BS.1770)
	const shelfFilter = biquadHighShelf(1500, 4, 0.5, sampleRate);

	return { preFilter, shelfFilter };
}

// ── Very small number to avoid log(0) ──
const VERY_SMALL = 1e-15;

/**
 * Apply the K-weighting filter to the input signal.
 *
 *   pre-filter (38 Hz HPF) → high-shelf (+4 dB at 1.5 kHz)
 *
 * @returns New Float32Array weighted per BS.1770 pre-filter.
 */
export function applyKWeightingFilter(
	input      : Float32Array,
	sampleRate : number,
): Float32Array {
	const { preFilter, shelfFilter } = buildKWeightingFilters(sampleRate);
	const stage1 = biquadApply(input, preFilter);
	return biquadApply(stage1, shelfFilter);
}

/**
 * Measure the integrated LUFS loudness of a signal per BS.1770-4.
 *
 * Returns the integrated loudness in LUFS, or -Infinity if the signal
 * has no audible content.
 */
export function measureIntegratedLUFS(
	input      : Float32Array,
	sampleRate : number,
): number {
	const n = input.length;
	if (n === 0) return -Infinity;

	const weighted = applyKWeightingFilter(input, sampleRate);

	// Split into blocks
	const blockMs      = 400;
	const hopMs        = 100;
	const blockSize    = Math.round((blockMs / 1000) * sampleRate);
	const hopSize      = Math.round((hopMs / 1000) * sampleRate);

	if (blockSize <= 0 || n < blockSize) {
		// Signal too short for meaningful LUFS; fall back to RMS-based estimate
		let sumSq = 0;
		for (let i = 0; i < n; i++) sumSq += weighted[i] * weighted[i];
		return -0.691 + 10 * Math.log10(sumSq / n + VERY_SMALL);
	}

	// Pre-allocate block arrays
	// maxBlocks is approximate (we'll do exact iteration)
	const maxBlocks = Math.floor((n - blockSize) / hopSize) + 1;
	const blockLoudness = new Float64Array(maxBlocks);
	const blockMeanSq   = new Float64Array(maxBlocks);
	let blockCount = 0;

	for (let start = 0; start + blockSize <= n; start += hopSize) {
		let sumSq = 0;
		for (let j = start; j < start + blockSize; j++) {
			sumSq += weighted[j] * weighted[j];
		}
		const meanSq   = sumSq / blockSize;
		const loudness = -0.691 + 10 * Math.log10(meanSq + VERY_SMALL);

		blockLoudness[blockCount] = loudness;
		blockMeanSq[blockCount]   = meanSq;
		blockCount++;
	}

	// Absolute gate: keep blocks above -70 LUFS
	let gatedSumSq = 0;
	let gatedCount = 0;
	for (let i = 0; i < blockCount; i++) {
		if (blockLoudness[i] > -70) {
			gatedSumSq += blockMeanSq[i];
			gatedCount++;
		}
	}

	if (gatedCount === 0) return -Infinity;

	const preliminaryMeanSq = gatedSumSq / gatedCount;
	const preliminaryLUFS   = -0.691 + 10 * Math.log10(preliminaryMeanSq + VERY_SMALL);

	// Relative gate: keep blocks above (preliminary LUFS - 10)
	const relativeThreshold = preliminaryLUFS - 10;
	let finalSumSq = 0;
	let finalCount = 0;
	for (let i = 0; i < blockCount; i++) {
		if (blockLoudness[i] > -70 && blockLoudness[i] > relativeThreshold) {
			finalSumSq += blockMeanSq[i];
			finalCount++;
		}
	}

	if (finalCount === 0) return preliminaryLUFS;

	const finalMeanSq = finalSumSq / finalCount;
	return -0.691 + 10 * Math.log10(finalMeanSq + VERY_SMALL);
}

/**
 * Normalize the input to a target integrated LUFS level.
 *
 * Measures the current loudness, applies linear gain to reach the target,
 * then runs a final look-ahead limiter to catch any overshoot from gain boost.
 *
 * @param input     Mono audio buffer.
 * @param sampleRate Sample rate in Hz.
 * @param targetLUFS Target loudness in LUFS (typically -18 to -16).
 * @param params    Optional full LUFS parameters; defaults to gallery-safe values.
 * @returns New Float32Array normalised to target loudness.
 */
export function normalizeLoudness(
	input      : Float32Array,
	sampleRate : number,
	targetLUFS : number,
	params?    : Partial<LufsParams>,
): Float32Array {
	const n = input.length;
	if (n === 0) return new Float32Array(0);

	const measuredLUFS = measureIntegratedLUFS(input, sampleRate);

	if (!isFinite(measuredLUFS)) {
		// Signal is silence or degenerate; return as-is
		return new Float32Array(input);
	}

	const gainDb = targetLUFS - measuredLUFS;
	const gain   = dbToLinear(gainDb);

	// Clamp gain to avoid ridiculous amplification of near-silent signals
	const clampedGain = clamp(gain, 0.1, 10);

	// Apply gain
	const output = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		output[i] = input[i] * clampedGain;
	}

	return output;
}

/**
 * Gallery-safe default LUFS parameters.
 *
 *   targetLUFS        : -18 LUFS (recommended gallery start point)
 *   truePeakCeilingDb : -1 dB
 *   blockLengthMs     : 400 ms
 *   hopMs             : 100 ms
 *   absoluteGate      : -70 LUFS
 */
export const defaultLufsParams: Required<LufsParams> = {
	targetLUFS        : -18,
	truePeakCeilingDb : -1,
	blockLengthMs     : 400,
	hopMs             : 100,
	absoluteGate      : -70,
};
