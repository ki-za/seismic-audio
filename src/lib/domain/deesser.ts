// ── Relative-Threshold De-Esser ──
// Pure math — no browser/node/framework dependencies.
//
// Detects when the high-frequency band becomes too dominant relative to
// the full signal, then reduces that high band dynamically.
//
// Based on catalog §12 — P1 High Impact.

import { biquadApply, biquadHPF, linearToDb, dbToLinear, smoothEnvelope } from "./dsp";
import type { DeEsserParams } from "./types";

// ── Defaults ──

export const DEFAULT_DEESSER: DeEsserParams = {
	detectorFrequencyHz : 6000,
	relativeThresholdDb : -8,
	maxReductionDb      : 6,
	attackMs            : 2,
	releaseMs           : 100,
};

// ── Relative de-esser ──

/**
 * Apply a relative-threshold de-esser to mono audio.
 *
 * Splits the signal into a high band (above detectorFrequencyHz) and
 * low band (everything else). When the high band envelope exceeds a
 * relative threshold vs the full-signal envelope, gain is reduced on
 * the high band only.
 *
 * This preserves detail during balanced sections and only reduces
 * brightness spikes when they dominate.
 *
 * @param input     — Mono audio samples in [-1, 1].
 * @param sampleRate— Sample rate in Hz.
 * @param options   — De-esser parameters (partial OK).
 * @returns         — New Float32Array of same length.
 */
export function relativeDeEsser(
	input     : Float32Array,
	sampleRate: number,
	options  ?: Partial<DeEsserParams>,
): Float32Array {
	const opts = { ...DEFAULT_DEESSER, ...options };
	const n    = input.length;
	const out  = new Float32Array(n);

	// Compute high band via high-pass filter
	const hpCoeffs  = biquadHPF(opts.detectorFrequencyHz, sampleRate);
	const highBand  = biquadApply(input, hpCoeffs);

	let highEnvelope      = 0;
	let fullEnvelope      = 0;
	let smoothedReduction = 0;

	const smoothingAlpha = 0.9; // smoothing coefficient for gain reduction

	for (let i = 0; i < n; i++) {
		const sample     = input[i];
		const highSample = highBand[i];

		// Track envelopes
		highEnvelope = smoothEnvelope(highEnvelope, Math.abs(highSample), opts.attackMs, opts.releaseMs, sampleRate);
		fullEnvelope = smoothEnvelope(fullEnvelope, Math.abs(sample), opts.attackMs, opts.releaseMs, sampleRate);

		// Relative brightness: how loud is the high band vs the full signal?
		const relativeBrightnessDb = linearToDb(highEnvelope / (fullEnvelope + 1e-15));

		let targetReductionDb = 0;
		if (relativeBrightnessDb > opts.relativeThresholdDb) {
			const excess = relativeBrightnessDb - opts.relativeThresholdDb;
			targetReductionDb = -Math.min(excess, opts.maxReductionDb);
		}

		// Smooth the gain reduction to avoid pumping
		smoothedReduction = smoothingAlpha * smoothedReduction + (1 - smoothingAlpha) * targetReductionDb;

		// Apply reduction to high band only
		const highGain     = dbToLinear(smoothedReduction);
		const lowPart      = sample - highSample;
		const controlledHigh = highSample * highGain;

		out[i] = lowPart + controlledHigh;
	}

	return out;
}
