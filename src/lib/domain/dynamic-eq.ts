// ── Dynamic EQ / Adaptive Resonance Cut ──
// Pure math — no browser/node/framework dependencies.
//
// A narrow or shelving EQ band whose gain changes dynamically based on
// the energy in that band. Cuts harshness only when it appears.
//
// Based on catalog §13 — P1 High Impact.

import { biquadApply, biquadBPF, linearToDb, dbToLinear, smoothEnvelope } from "./dsp";
import type { DynamicEqParams } from "./types";

// ── Defaults ──

export const DEFAULT_DYNAMIC_EQ: DynamicEqParams = {
	frequencyHz : 4000,
	Q           : 2.5,
	thresholdDb : -25,
	maxCutDb    : 5,
	attackMs    : 5,
	releaseMs   : 150,
};

// ── Dynamic resonance cut ──

/**
 * Apply a dynamic resonance cut to mono audio.
 *
 * Monitors the energy in a specific frequency band (via a bandpass filter).
 * When that band exceeds a threshold, gain reduction is applied only to
 * that band, leaving other frequencies unaffected.
 *
 * This is a "dynamic notch" — it cuts only when the band gets rude,
 * preserving detail during quiet or balanced sections.
 *
 * @param input      — Mono audio samples in [-1, 1].
 * @param sampleRate — Sample rate in Hz.
 * @param options    — Dynamic EQ parameters (partial OK).
 * @returns          — New Float32Array of same length.
 */
export function dynamicResonanceCut(
	input     : Float32Array,
	sampleRate: number,
	options  ?: Partial<DynamicEqParams>,
): Float32Array {
	const opts = { ...DEFAULT_DYNAMIC_EQ, ...options };
	const n    = input.length;
	const out  = new Float32Array(n);

	// Bandpass filter for the target frequency
	const bpCoeffs  = biquadBPF(opts.frequencyHz, opts.Q, sampleRate);
	const targetBand = biquadApply(input, bpCoeffs);

	let envelope      = 0;
	let smoothedCutDb = 0;

	const smoothingAlpha = 0.9;

	for (let i = 0; i < n; i++) {
		const sample = input[i];
		const band  = targetBand[i];

		// Track energy in the target band
		envelope = smoothEnvelope(envelope, Math.abs(band), opts.attackMs, opts.releaseMs, sampleRate);

		const levelDb = linearToDb(envelope);

		let targetCutDb = 0;
		if (levelDb > opts.thresholdDb) {
			const excess = levelDb - opts.thresholdDb;
			targetCutDb = -Math.min(excess, opts.maxCutDb);
		}

		// Smooth gain reduction
		smoothedCutDb = smoothingAlpha * smoothedCutDb + (1 - smoothingAlpha) * targetCutDb;

		// Cut only the band content from the signal
		// smoothedCutDb is negative (e.g. -5 dB). dbToLinear(-5) ≈ 0.56.
		// We remove 1 - 0.56 = 0.44 of the band energy.
		// output = (sample - band) + band * dbToLinear(smoothedCutDb)
		//        = sample - band * (1 - dbToLinear(smoothedCutDb))
		const bandGain     = dbToLinear(smoothedCutDb);
		const cutFraction  = 1 - bandGain;
		out[i] = sample - band * cutFraction;
	}

	return out;
}
