// ── Polyphase Windowed-Sinc Resampler ──
// Pure math — no browser/node/framework dependencies.
// Replaces linear-interpolation resampling with an anti-aliased polyphase filter.

import type { PolyphaseOptions, WindowType } from "./types";
import { clamp } from "./dsp";

// ── Module-level filter cache ──
// Keyed by `${phaseCount}-${taps}-${cutoff}-${window}[-${kaiserBeta}]`.
// Null while no table has been built.
const _tableCache = new Map<string, Float32Array[]>();

/** Clear the filter table cache. Useful for memory management or testing. */
export function clearFilterCache(): void {
	_tableCache.clear();
}

/**
 * Evaluate a window function at normalised index `i` (0 → start, 1 → end).
 */
export function evaluateWindow(i: number, total: number, type: WindowType, kaiserBeta = 6): number {
	if (total <= 1) return 1;

	const x = (2 * i) / (total - 1) - 1; // -1 .. 1

	switch (type) {
	case "hann":
		return 0.5 + 0.5 * Math.cos(Math.PI * x);

	case "blackman": {
		// Blackman: w(n) = 0.42 - 0.5 cos(2πn/(N-1)) + 0.08 cos(4πn/(N-1))
		const cos2 = Math.cos((2 * Math.PI * i) / (total - 1));
		const cos4 = Math.cos((4 * Math.PI * i) / (total - 1));
		return 0.42 - 0.5 * cos2 + 0.08 * cos4;
	}

	case "lanczos":
		if (Math.abs(x) < 1e-15) return 1;
		return Math.sin(Math.PI * x) / (Math.PI * x); // Lanczos with a=1

	case "kaiser": {
		// Kaiser: I0(β*sqrt(1 - ((2n/(N-1) - 1)^2)) / I0(β)
		const t = 2 * i / (total - 1) - 1;
		const r = 1 - t * t;
		if (r <= 0) return 1e-15;
		return modifiedBesselI0(kaiserBeta * Math.sqrt(r)) / modifiedBesselI0(kaiserBeta);
	}
	}
}

/**
 * Modified Bessel function I0(x) — used by Kaiser window.
 * Approximation good to ~1.5e-7.
 */
function modifiedBesselI0(x: number): number {
	let sum  = 1;
	let term = 1;
	for (let k = 1; k <= 50; k++) {
		term *= (x / (2 * k)) ** 2;
		sum += term;
		if (term < 1e-15 * sum) break;
	}
	return sum;
}

/**
 * Normalised sinc: sin(πx)/(πx)
 */
export function sinc(x: number): number {
	if (Math.abs(x) < 1e-15) return 1;
	const pix = Math.PI * x;
	return Math.sin(pix) / pix;
}

/**
 * Build a polyphase windowed-sinc filter table.
 *
 * Returns an array of `phaseCount` sub-arrays, each of length `taps`.
 * Each sub-array is a normalised set of filter coefficients for one fractional phase.
 */
export function buildWindowedSincTable(
	phaseCount : number,
	taps       : number,
	cutoff     : number,
	window     : WindowType,
	kaiserBeta = 6,
): Float32Array[] {
	const cacheKey = `${phaseCount}-${taps}-${cutoff}-${window}-${kaiserBeta}`;
	const cached = _tableCache.get(cacheKey);
	if (cached) return cached;

	const halfTaps  = Math.floor(taps / 2);
	const table     = new Array<Float32Array>(phaseCount);

	for (let phase = 0; phase < phaseCount; phase++) {
		const fracOffset = phase / phaseCount;
		const coeffs     = new Float32Array(taps);
		let sum = 0;

		for (let t = 0; t < taps; t++) {
			const x      = t - halfTaps - fracOffset;
			const sincV  = sinc(cutoff * x);
			const winV   = evaluateWindow(t, taps, window, kaiserBeta);
			const c      = cutoff * sincV * winV;
			coeffs[t] = c;
			sum += c;
		}

		// Normalise so the sum is 1 (DC gain = 1)
		if (sum > 1e-15) {
			for (let t = 0; t < taps; t++) coeffs[t] /= sum;
		}

		table[phase] = coeffs;
	}

	_tableCache.set(cacheKey, table);
	return table;
}

/**
 * Polyphase windowed-sinc resampler.
 *
 * Accepts either number[] or Float32Array input. Returns a Float32Array
 * of length `outputLength`. Uses a cached polyphase filter table.
 *
 * @param input        Source samples (time-domain, arbitrary levels).
 * @param outputLength Desired output length in samples.
 * @param options      Filter parameters (taps, phases, cutoff, window type).
 */
export function resamplePolyphase(
	input        : ArrayLike<number>,
	outputLength : number,
	options      : PolyphaseOptions,
): Float32Array {
	if (input.length === 0 || outputLength === 0) {
		return new Float32Array(outputLength);
	}

	if (input.length === 1) {
		const out = new Float32Array(outputLength);
		for (let i = 0; i < outputLength; i++) out[i] = input[0];
		return out;
	}

	const ratio      = input.length / outputLength;
	const filterTable = buildWindowedSincTable(
		options.phaseCount,
		options.filterTaps,
		options.cutoff,
		options.window,
		options.kaiserBeta ?? 6,
	);
	const halfTaps    = Math.floor(options.filterTaps / 2);
	const output      = new Float32Array(outputLength);

	for (let oi = 0; oi < outputLength; oi++) {
		const sourcePos = oi * ratio;
		const center    = Math.floor(sourcePos);
		const frac      = sourcePos - center;
		const phaseIdx  = Math.round(frac * (options.phaseCount - 1));
		const coeffs    = filterTable[phaseIdx];

		let acc = 0;
		for (let t = 0; t < options.filterTaps; t++) {
			const srcIdx = center + (t - halfTaps);
			const sample = (srcIdx >= 0 && srcIdx < input.length)
				? input[srcIdx]
				: input[clamp(srcIdx, 0, input.length - 1)]; // edge mirror
			acc += sample * coeffs[t];
		}

		// Coefficients are normalised, but accumulate rounding — clamp to stable range
		output[oi] = acc;
	}

	return output;
}

/**
 * High-level quality presets for resampling.
 */
export function polyphaseOptionsForQuality(
	quality   : "preview" | "export",
	windowType?: WindowType,
): PolyphaseOptions {
	if (quality === "preview") {
		return {
			filterTaps : 32,
			phaseCount : 512,
			cutoff     : 0.90,
			window     : windowType ?? "kaiser",
			kaiserBeta : 6,
		};
	}
	return {
		filterTaps : 128,
		phaseCount : 2048,
		cutoff     : 0.92,
		window     : windowType ?? "kaiser",
		kaiserBeta : 8,
	};
}
