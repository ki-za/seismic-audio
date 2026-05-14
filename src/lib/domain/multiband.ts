// ── Three-Band Multiband Compressor ──
// Pure math — no browser/node/framework dependencies.
//
// Splits the signal into low, mid, and high bands via Linkwitz-Riley
// 4th-order crossovers, compresses each independently, then recombines.
//
// Based on catalog §11 — P1 High Impact.

import {
	linkwitzRileyLowpass,
	subtractBuffers,
	smoothEnvelope,
	linearToDb,
	dbToLinear,
} from "./dsp";
import type { BandCompressorParams, MultibandParams } from "./types";

// ── Defaults ──

export const DEFAULT_MULTIBAND: MultibandParams = {
	lowCrossoverHz  : 250,
	highCrossoverHz : 3500,
	bands           : [
		{ thresholdDb: -18, ratio: 2.5, attackMs: 10,  releaseMs: 150, makeupDb: 2 },
		{ thresholdDb: -22, ratio: 2.0, attackMs: 5,   releaseMs: 100, makeupDb: 1 },
		{ thresholdDb: -24, ratio: 2.5, attackMs: 3,   releaseMs: 80,  makeupDb: 0 },
	],
};

// ── Single-band compressor ──

/**
 * Compress a single frequency band with envelope-following dynamics.
 *
 * @param input      — Mono audio samples.
 * @param sampleRate — Sample rate in Hz.
 * @param params     — Compression parameters.
 * @returns          — New Float32Array of same length.
 */
export function compressSingleBand(
	input     : Float32Array,
	sampleRate: number,
	params    : BandCompressorParams,
): Float32Array {
	const n   = input.length;
	const out = new Float32Array(n);

	let envelope       = 0;
	let smoothedGainDb = 0;

	for (let i = 0; i < n; i++) {
		const sample = input[i];

		envelope = smoothEnvelope(envelope, Math.abs(sample), params.attackMs, params.releaseMs, sampleRate);

		const levelDb = linearToDb(envelope);
		let gainReductionDb = 0;
		if (levelDb > params.thresholdDb) {
			const overDb = levelDb - params.thresholdDb;
			const compressedOver = overDb / params.ratio;
			gainReductionDb = compressedOver - overDb; // negative
		}

		// Smooth gain reduction to avoid pumping
		smoothedGainDb = 0.95 * smoothedGainDb + 0.05 * gainReductionDb;

		const gain = dbToLinear(smoothedGainDb + params.makeupDb);
		out[i] = sample * gain;
	}

	return out;
}

// ── Three-band compressor ──

/**
 * Apply three-band multiband compression to mono audio.
 *
 * Uses Linkwitz-Riley 4th-order crossovers for phase-coherent
 * band splitting. Each band is compressed independently.
 *
 * @param input      — Mono audio samples in [-1, 1].
 * @param sampleRate — Sample rate in Hz.
 * @param options    — Multiband parameters (partial OK).
 * @returns          — New Float32Array of same length.
 */
export function threeBandCompressor(
	input     : Float32Array,
	sampleRate: number,
	options  ?: Partial<MultibandParams>,
): Float32Array {
	const opts = { ...DEFAULT_MULTIBAND, ...options };
	const n    = input.length;

	// Split into bands using Linkwitz-Riley crossovers
	const lowBand  = linkwitzRileyLowpass(input, sampleRate, opts.lowCrossoverHz);
	const noLow    = subtractBuffers(input, lowBand);
	const midBand  = linkwitzRileyLowpass(noLow, sampleRate, opts.highCrossoverHz);
	const highBand = subtractBuffers(noLow, midBand);

	// Compress each band
	const compressedLow  = compressSingleBand(lowBand,  sampleRate, opts.bands[0]);
	const compressedMid  = compressSingleBand(midBand,  sampleRate, opts.bands[1]);
	const compressedHigh = compressSingleBand(highBand, sampleRate, opts.bands[2]);

	// Sum bands
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = compressedLow[i] + compressedMid[i] + compressedHigh[i];
	}

	return out;
}
