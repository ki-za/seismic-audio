// ── Mono-Safe Pseudo-Stereo ──
// Pure math — no browser/node/framework dependencies.
//
// Creates stereo width by generating a side signal from delayed and
// filtered versions of the mono input, then recombining as mid/side.
//
// Mid/side processing keeps the mono sum identical to the original —
// no comb filtering when the gallery sound system collapses to mono.
//
// Based on catalog §15 — P1 High Impact.

import { biquadApply, biquadHPF, biquadLPF, millisecondsToSamples } from "./dsp";
import type { PseudoStereoParams } from "./types";

// ── Defaults ──

export const DEFAULT_PSEUDO_STEREO: PseudoStereoParams = {
	sideDelayMs    : 8,
	sideHighpassHz : 600,
	sideLowpassHz  : 9000,
	width          : 0.2,
};

// ── Mono-safe pseudo-stereo ──

/**
 * Generate a pseudo-stereo signal from mono input.
 *
 * The side signal is created by delaying the mono signal, then bandpassing
 * it through a highpass + lowpass filter pair. The result is mixed as
 * mid/side: left = mid + side * width, right = mid - side * width.
 *
 * The mono sum (left + right) / 2 recovers the original mid signal,
 * making this safe for mono playback systems.
 *
 * @param monoInput — Mono audio samples in [-1, 1].
 * @param sampleRate— Sample rate in Hz.
 * @param options   — Pseudo-stereo parameters (partial OK).
 * @returns         — Object with left and right Float32Array channels.
 */
export function monoSafePseudoStereo(
	monoInput : Float32Array,
	sampleRate: number,
	options  ?: Partial<PseudoStereoParams>,
): { left: Float32Array; right: Float32Array } {
	const opts  = { ...DEFAULT_PSEUDO_STEREO, ...options };
	const n     = monoInput.length;
	const delay = millisecondsToSamples(opts.sideDelayMs, sampleRate);

	// Delay the signal for the side channel
	const delayed = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const srcIdx = i - delay;
		delayed[i] = srcIdx >= 0 ? monoInput[srcIdx] : 0;
	}

	// Filter the side signal: bandpass = highpass + lowpass
	const hpCoeffs = biquadHPF(opts.sideHighpassHz, sampleRate);
	const lpCoeffs = biquadLPF(opts.sideLowpassHz, sampleRate);

	let side = biquadApply(delayed, hpCoeffs);
	side = biquadApply(side, lpCoeffs);

	// Mid/side encoding
	const left  = new Float32Array(n);
	const right = new Float32Array(n);

	for (let i = 0; i < n; i++) {
		const mid  = monoInput[i];
		const s    = side[i] * opts.width;
		left[i]  = mid + s;
		right[i] = mid - s;
	}

	// Mono sum check: (left + right) / 2 == mid  → guaranteed by construction

	return { left, right };
}
