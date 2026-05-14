// ── TPDF Dither for PCM Export ──
// Pure math — no browser/node/framework dependencies.
//
// Triangular Probability Density Function dither adds a tiny amount
// of shaped noise before truncation to avoid quantization distortion.
//
// Dither must be the *last* processing step before PCM encoding.
// No processing after dither.

import { clamp } from "./dsp";
import { createXorshift32 } from "./prng";

// ── Seeded deterministic RNG ──
// Ensures identical dither for identical input (noise is deterministic
// across runs, not cryptographic). Seed is fixed by default but
// overridable for testing.

let _ditherRng = createXorshift32(42);

/**
 * Override the dither RNG seed. Useful for deterministic testing.
 */
export function setDitherSeed(seed: number): void {
	_ditherRng = createXorshift32(seed);
}

/**
 * Get next uniform random value [0, 1) from the dither RNG.
 */
function seededRandom(): number {
	return _ditherRng();
}

/**
 * Apply triangular probability density function (TPDF) dither.
 *
 * TPDF noise is the sum of two uniform random values, producing a
 * triangular distribution centred at 0 with range [-1 LSB, +1 LSB].
 *
 * @param input    Floating-point samples, range [-1, 1].
 * @param bitDepth Target bit depth (default 16).
 * @returns Dithered float samples — final output before int conversion.
 */
export function applyTPDFDither(
	input    : Float32Array,
	bitDepth = 16,
): Float32Array {
	const n        = input.length;
	const output   = new Float32Array(n);
	const lsb      = 1 / (2 ** (bitDepth - 1) - 1);

	for (let i = 0; i < n; i++) {
		const r1     = seededRandom();
		const r2     = seededRandom();
		const noise  = (r1 - r2) * lsb;
		output[i] = clamp(input[i] + noise, -1, 1);
	}

	return output;
}

/**
 * Convert floating-point samples to 16-bit PCM integers with TPDF dither.
 *
 * Combines dither + truncation to avoid an extra buffer pass.
 *
 * @param input Floating-point samples, range [-1, 1].
 * @returns Dithered Int16Array ready for WAV encoding.
 */
export function floatToInt16WithDither(input: Float32Array): Int16Array {
	const n         = input.length;
	const output    = new Int16Array(n);
	const maxInt    = 32767;
	const minInt    = -32768;
	const lsb       = 1 / maxInt;

	for (let i = 0; i < n; i++) {
		const r1    = seededRandom();
		const r2    = seededRandom();
		const noise = (r1 - r2) * lsb;
		const dithered = clamp(input[i] + noise, -1, 1);
		output[i] = clamp(
			Math.round(dithered * maxInt),
			minInt,
			maxInt,
		);
	}

	return output;
}

/**
 * Descriptive name for this dither type.
 */
export const ditherName = "TPDF (triangular probability density function)";
