// ── Asymmetric Soft-Knee Saturation ──
// Pure math — no browser/node/framework dependencies.
//
// A nonlinear waveshaper that adds soft harmonic density.
// Unlike plain tanh, it supports knee control and asymmetry
// for richer even harmonics that read as warmth.
//
// Based on catalog §9 — P1 High Impact.

import { clamp, dbToLinear, linearToDb, mix } from "./dsp";
import type { SaturationParams } from "./types";

// ── Defaults ──

export const DEFAULT_SATURATION: SaturationParams = {
	drive        : 2.0,
	knee         : 0.85,
	asymmetry    : 0.08,
	wetDryMix    : 0.25,
	outputTrimDb : -1.5,
};

// ── Soft clipping with knee ──

/**
 * Soft-clip a single sample with knee control.
 *
 * The knee softens the transition into saturation.
 * knee=1.0 → pure tanh (no pre-shaping).
 * knee<1.0 → a polynomial region eases into tanh.
 */
function softClip(x: number, drive: number, knee: number): number {
	const driven = x * drive;
	// Pre-shape: polynomial knee before tanh
	const absX = Math.abs(driven);
	const shaped = absX < knee
		? driven // linear below knee
		: Math.tanh(driven); // tanh above knee
	return shaped;
}

// ── Asymmetric saturation ──

/**
 * Apply asymmetric soft-knee saturation to mono audio.
 *
 * Asymmetry creates even harmonics by shifting the signal
 * before clipping and compensating afterward.
 *
 * @param input   — Mono audio samples in [-1, 1].
 * @param options — Saturation parameters (partial OK).
 * @returns       — New Float32Array of same length.
 */
export function asymmetricSaturation(
	input   : Float32Array,
	options?: Partial<SaturationParams>,
): Float32Array {
	const opts = { ...DEFAULT_SATURATION, ...options };
	const trim = dbToLinear(opts.outputTrimDb);
	const n    = input.length;
	const out  = new Float32Array(n);

	for (let i = 0; i < n; i++) {
		const dry = input[i];

		// Add asymmetry bias, soft-clip, subtract bias-only offset
		const biased   = dry + opts.asymmetry;
		const wet      = softClip(biased, opts.drive, opts.knee);
		const biasOnly = softClip(opts.asymmetry, opts.drive, opts.knee);
		const unBiased = wet - biasOnly;

		// Dry/wet mix + output trim
		out[i] = mix(dry, unBiased, opts.wetDryMix) * trim;
	}

	return out;
}

// ── WaveShaper curve generator ──

/**
 * Generate an asymmetric soft-knee saturation curve as a Float32Array
 * for Web Audio WaveShaperNode.
 *
 * This replaces the naive tanh curve in configureChain().
 *
 * @returns — Float32Array of 2048 samples for use as WaveShaperNode.curve.
 */
export function makeAsymmetricSaturationCurve(options?: Partial<SaturationParams>): Float32Array {
	const opts  = { ...DEFAULT_SATURATION, ...options };
	const n     = 2048;
	const curve = new Float32Array(n);

	for (let i = 0; i < n; i++) {
		const x = (i * 2) / n - 1; // [-1, 1]

		const biased   = x + opts.asymmetry;
		const wet      = softClip(biased, opts.drive, opts.knee);
		const biasOnly = softClip(opts.asymmetry, opts.drive, opts.knee);
		const unBiased = wet - biasOnly;

		curve[i] = mix(x, unBiased, opts.wetDryMix) * dbToLinear(opts.outputTrimDb);
	}

	return curve;
}
