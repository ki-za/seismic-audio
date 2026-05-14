// ── Downward Expander With Comfort Noise ──
// Pure math — no browser/node/framework dependencies.
//
// Reduces low-level noise during quiet passages, but adds a very quiet
// shaped noise bed so silence does not feel digitally dead.
//
// Based on catalog §14 — P1 High Impact.

import { clamp, dbToLinear, linearToDb, smoothEnvelope } from "./dsp";
import { createXorshift32 } from "./prng";
import type { ExpanderParams } from "./types";

// ── Defaults ──

export const DEFAULT_EXPANDER: ExpanderParams = {
	thresholdDb         : -45,
	ratio               : 2.0,
	maxDepthDb          : 12,
	attackMs            : 20,
	releaseMs           : 400,
	comfortNoiseLevelDb : -60,
	noiseColor          : "pink",
};

// ── Expander with comfort noise ──

/**
 * Apply a downward expander with comfort noise to mono audio.
 *
 * Quiet passages are expanded downward (reduced in level), and a subtle
 * shaped comfort noise bed fills the resulting silence to keep the
 * space feeling alive.
 *
 * @param input      — Mono audio samples in [-1, 1].
 * @param sampleRate — Sample rate in Hz.
 * @param options    — Expander parameters (partial OK).
 * @param rngSeed    — Optional seed for deterministic comfort noise.
 *                     Defaults to 42.
 * @returns          — New Float32Array of same length.
 */
export function expanderWithComfortNoise(
	input     : Float32Array,
	sampleRate: number,
	options  ?: Partial<ExpanderParams>,
	rngSeed   : number = 42,
): Float32Array {
	const opts = { ...DEFAULT_EXPANDER, ...options };
	const n    = input.length;
	const out  = new Float32Array(n);

	const rng      = createXorshift32(rngSeed);
	let envelope   = 0;
	let smoothedDb = 0;
	let noiseState = 0;

	for (let i = 0; i < n; i++) {
		const sample = input[i];

		// Track signal envelope
		envelope = smoothEnvelope(envelope, Math.abs(sample), opts.attackMs, opts.releaseMs, sampleRate);

		const levelDb = linearToDb(envelope);

		// Expander: how much gain reduction?
		let targetGainDb = 0;
		if (levelDb < opts.thresholdDb) {
			const belowThreshold = opts.thresholdDb - levelDb;
			targetGainDb = -Math.min(opts.maxDepthDb, belowThreshold * (opts.ratio - 1));
		}

		// Smooth gain reduction
		smoothedDb = 0.98 * smoothedDb + 0.02 * targetGainDb;

		// Apply expansion
		const expanded = sample * dbToLinear(smoothedDb);

		// Comfort noise — feels like "air" in the space
		// Guard against division by zero when maxDepthDb=0 (disabled expansion)
		const quietAmount = opts.maxDepthDb > 0
			? clamp(-smoothedDb / opts.maxDepthDb, 0, 1)
			: 0;

		const whiteNoise = rng() * 2 - 1; // [-1, 1]

		let shapedNoise: number;
		if (opts.noiseColor === "pink") {
			// Simple pink noise: one-pole lowpass of white noise
			noiseState = 0.98 * noiseState + 0.02 * whiteNoise;
			shapedNoise = noiseState;
		} else {
			shapedNoise = whiteNoise;
		}

		const comfort = shapedNoise * dbToLinear(opts.comfortNoiseLevelDb);

		out[i] = expanded + comfort * quietAmount;
	}

	return out;
}
