// ── Look-Ahead Limiter With Soft Clip Safety ──
// Pure math — no browser/node/framework dependencies.
//
// A mastering-style limiter that:
//   1. Scans ahead to detect upcoming peaks.
//   2. Reduces gain before the peak arrives (look-ahead).
//   3. Recovers gain smoothly during quiet sections (release).
//   4. Applies a final soft-clip knee for extra safety.

import type { LimiterParams } from "./types";
import { clamp, dbToLinear, smoothingCoefficient } from "./dsp";

/**
 * Soft-clip waveshaper: linear up to `knee`, then tanh rolloff.
 *
 * @param sample The input sample (pre-gain).
 * @param drive  Pre-clip gain boost. >1 pushes into clipping.
 * @param knee   Where soft clipping starts (0.75–0.98 of full scale).
 */
export function softClip(sample: number, drive: number, knee: number): number {
	const driven    = sample * drive;
	const magnitude = Math.abs(driven);

	if (magnitude <= knee) return driven;

	const excess           = magnitude - knee;
	const availableHeadroom = 1 - knee;
	const curved = knee + availableHeadroom * Math.tanh(excess / Math.max(availableHeadroom, 1e-15));

	return (driven >= 0 ? 1 : -1) * curved;
}

/**
 * Look-ahead limiter with soft-clip safety.
 *
 * Uses a delay line to see `lookAheadMs` into the future, computes
 * the required gain reduction, and applies it smoothly with an
 * exponential release envelope.  A final soft-clip knee catches any
 * remaining transient overshoot.
 *
 * @param input     Mono audio buffer, range [-1, 1].
 * @param sampleRate Current sample rate in Hz.
 * @param options   Limiter parameters (ceiling, release, look-ahead, soft clip knee/drive).
 * @returns New Float32Array with peaks limited.
 */
export function lookAheadLimiter(
	input      : Float32Array,
	sampleRate : number,
	options?   : Partial<LimiterParams>,
): Float32Array {
	const n                = input.length;
	if (n === 0) return new Float32Array(0);

	const opts: LimiterParams = {
		ceilingDb     : options?.ceilingDb     ?? 0,
		lookAheadMs   : options?.lookAheadMs   ?? 5,
		releaseMs     : options?.releaseMs     ?? 200,
		softClipKnee  : options?.softClipKnee  ?? 0.92,
		softClipDrive : options?.softClipDrive ?? 1.0,
	};

	const output            = new Float32Array(n);
	const ceiling           = dbToLinear(opts.ceilingDb);
	const lookAheadSamples  = Math.max(1, Math.round((opts.lookAheadMs / 1000) * sampleRate));
	const releaseCoeff      = smoothingCoefficient(opts.releaseMs, sampleRate);
	const knee              = clamp(opts.softClipKnee, 0.1, 0.99);
	const drive             = Math.max(1, opts.softClipDrive);

	let currentGain = 1;

	for (let i = 0; i < n; i++) {
		// Look ahead to find the peak in the future window
		let futurePeak = 0;
		const lookEnd  = Math.min(n, i + lookAheadSamples);

		for (let j = i; j < lookEnd; j++) {
			const abs = Math.abs(input[j]);
			if (abs > futurePeak) futurePeak = abs;
		}

		// Compute target gain from peak
		const targetGain = futurePeak > ceiling ? ceiling / futurePeak : 1;

		// Attack is instant when reducing gain; release is smooth
		if (targetGain < currentGain) {
			currentGain = targetGain;
		} else {
			currentGain = releaseCoeff * currentGain + (1 - releaseCoeff) * targetGain;
		}

		// Apply gain to the delayed sample
		const delayedIdx = i - lookAheadSamples;
		if (delayedIdx >= 0) {
			const limited = input[delayedIdx] * currentGain;
			const clipped = softClip(limited, drive, knee);
			output[delayedIdx] = clamp(clipped, -ceiling, ceiling);
		}
	}

	// Fill tail samples (where look-ahead window extended past end)
	// These get processed with the same gain but no future look-ahead.
	for (let i = Math.max(0, n - lookAheadSamples); i < n; i++) {
		const limited = input[i] * currentGain;
		const clipped = softClip(limited, drive, knee);
		output[i] = clamp(clipped, -ceiling, ceiling);
	}

	return output;
}

/**
 * Apply a mastering-style limiter with sensible defaults for seismic audio.
 *
 * Presets:
 *   "gentle"   → -2 dB ceiling, 3 ms look-ahead, 150 ms release
 *   "standard" → -1 dB ceiling, 5 ms look-ahead, 200 ms release
 *   "brickwall" → -0.5 dB ceiling, 10 ms look-ahead, 300 ms release
 */
export function limiterPreset(preset: "gentle" | "standard" | "brickwall"): LimiterParams {
	switch (preset) {
	case "gentle":
		return { ceilingDb: -2, lookAheadMs: 3, releaseMs: 150, softClipKnee: 0.85, softClipDrive: 1.0 };
	case "brickwall":
		return { ceilingDb: -0.5, lookAheadMs: 10, releaseMs: 300, softClipKnee: 0.98, softClipDrive: 1.5 };
	default:
		return { ceilingDb: -1, lookAheadMs: 5, releaseMs: 200, softClipKnee: 0.92, softClipDrive: 1.2 };
	}
}
