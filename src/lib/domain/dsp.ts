// ── Shared DSP Helpers ──
// Pure math — no browser/node/framework dependencies.
// Shared by all domain DSP algorithms.

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

/**
 * Convert dB to linear gain. 0 dB → 1.0.
 */
export function dbToLinear(db: number): number {
	return 10 ** (db / 20);
}

/**
 * Convert linear gain to dB. Avoids log(0).
 */
export function linearToDb(value: number): number {
	const safe = Math.max(Math.abs(value), 1e-15);
	return 20 * Math.log10(safe);
}

/**
 * Exponential smoothing coefficient from time constant.
 * Returns the coefficient such that:
 *   envelope = coeff * previous + (1 - coeff) * target
 */
export function smoothingCoefficient(timeMs: number, sampleRate: number): number {
	const seconds = timeMs / 1000;
	return Math.exp(-1 / (seconds * sampleRate));
}

/**
 * One-pole envelope follower with separate attack/release rates.
 *
 * @returns The new envelope value after one sample.
 */
export function smoothEnvelope(
	previous   : number,
	target     : number,
	attackMs   : number,
	releaseMs  : number,
	sampleRate : number,
): number {
	const coeff = target > previous
		? smoothingCoefficient(attackMs, sampleRate)
		: smoothingCoefficient(releaseMs, sampleRate);
	return coeff * previous + (1 - coeff) * target;
}

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
	return a * (1 - t) + b * t;
}

/**
 * Dry/wet mix. amount=0 → full dry, amount=1 → full wet.
 */
export function mix(dry: number, wet: number, amount: number): number {
	return dry * (1 - amount) + wet * amount;
}

/**
 * Median of a sorted numeric array.
 * Returns a copy; sort is destructive so caller should sort first.
 */
export function median(sorted: Float64Array | number[]): number {
	const n = sorted.length;
	if (n === 0) return 0;
	if (n % 2 === 1) return sorted[(n - 1) / 2];
	return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * Convert milliseconds to integer sample count at a given sample rate.
 */
export function millisecondsToSamples(ms: number, sampleRate: number): number {
	return Math.max(1, Math.round((ms / 1000) * sampleRate));
}

/**
 * Convert sample count to milliseconds.
 */
export function samplesToMilliseconds(samples: number, sampleRate: number): number {
	return (samples / sampleRate) * 1000;
}

// ── Biquad Filter ──

/**
 * Pre-computed biquad filter coefficients for direct-form I.
 * Standard: H(z) = (b0 + b1*z^-1 + b2*z^-2) / (a0 + a1*z^-1 + a2*z^-2)
 */
export type BiquadCoefficients = {
	b0: number; b1: number; b2: number;
	a0: number; a1: number; a2: number;
};

/**
 * Apply a biquad filter (direct form I) to a Float32Array in-place.
 * Returns the same array for chaining.
 */
export function biquadApply(
	input  : Float32Array,
	coeffs : BiquadCoefficients,
	output?: Float32Array,
): Float32Array {
	const out = output ?? new Float32Array(input.length);
	const { b0, b1, b2, a0, a1, a2 } = coeffs;
	// Normalised to a0 = a0 (we don't divide, caller provides normalised)
	const a0inv = 1 / a0;

	let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

	for (let i = 0; i < input.length; i++) {
		const x0 = input[i];
		const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) * a0inv;
		out[i] = y0;
		x2 = x1; x1 = x0;
		y2 = y1; y1 = y0;
	}

	return out;
}

/**
 * Normalise biquad coefficients so a0 = 1.
 */
function normalise(c: BiquadCoefficients): BiquadCoefficients {
	return {
		b0: c.b0 / c.a0, b1: c.b1 / c.a0, b2: c.b2 / c.a0,
		a0: 1,
		a1: c.a1 / c.a0, a2: c.a2 / c.a0,
	};
}

// ── Standard biquad design functions ──
// All return normalised coefficients (a0 = 1).
// Formulas from Robert Bristow-Johnson's "Cookbook formulae for audio EQ biquad filters".

/**
 * Low-pass filter (2-pole).
 */
export function biquadLPF(cutoffHz: number, sampleRate: number, Q = 0.707): BiquadCoefficients {
	const w0 = 2 * Math.PI * cutoffHz / sampleRate;
	const alpha = Math.sin(w0) / (2 * Q);
	const cosw0 = Math.cos(w0);

	const b0 = (1 - cosw0) / 2;
	const b1 = 1 - cosw0;
	const b2 = (1 - cosw0) / 2;
	const a0 = 1 + alpha;
	const a1 = -2 * cosw0;
	const a2 = 1 - alpha;

	return normalise({ b0, b1, b2, a0, a1, a2 });
}

/**
 * High-pass filter (2-pole).
 */
export function biquadHPF(cutoffHz: number, sampleRate: number, Q = 0.707): BiquadCoefficients {
	const w0 = 2 * Math.PI * cutoffHz / sampleRate;
	const alpha = Math.sin(w0) / (2 * Q);
	const cosw0 = Math.cos(w0);

	const b0 = (1 + cosw0) / 2;
	const b1 = -(1 + cosw0);
	const b2 = (1 + cosw0) / 2;
	const a0 = 1 + alpha;
	const a1 = -2 * cosw0;
	const a2 = 1 - alpha;

	return normalise({ b0, b1, b2, a0, a1, a2 });
}

/**
 * Peaking EQ filter.
 */
export function biquadPeak(cutoffHz: number, gainDb: number, Q: number, sampleRate: number): BiquadCoefficients {
	const w0 = 2 * Math.PI * cutoffHz / sampleRate;
	const A = 10 ** (gainDb / 40);
	const alpha = Math.sin(w0) / (2 * Q);
	const cosw0 = Math.cos(w0);

	const b0 = 1 + alpha * A;
	const b1 = -2 * cosw0;
	const b2 = 1 - alpha * A;
	const a0 = 1 + alpha / A;
	const a1 = -2 * cosw0;
	const a2 = 1 - alpha / A;

	return normalise({ b0, b1, b2, a0, a1, a2 });
}

/**
 * High-shelf filter.
 * slope: 0.5 (gentle) to 1.0 (steep). Standard value is 0.5 (shelf slope = 1/sqrt(2)).
 */
export function biquadHighShelf(cutoffHz: number, gainDb: number, slope: number, sampleRate: number): BiquadCoefficients {
	const w0 = 2 * Math.PI * cutoffHz / sampleRate;
	const A = 10 ** (gainDb / 40);
	const alpha = Math.sin(w0) / 2 * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
	const cosw0 = Math.cos(w0);
	const twoSqrtA = 2 * Math.sqrt(A);
	const b0 = A * ((A + 1) + (A - 1) * cosw0 + twoSqrtA * alpha);
	const b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
	const b2 = A * ((A + 1) + (A - 1) * cosw0 - twoSqrtA * alpha);
	const a0 = (A + 1) - (A - 1) * cosw0 + twoSqrtA * alpha;
	const a1 = 2 * ((A - 1) - (A + 1) * cosw0);
	const a2 = (A + 1) - (A - 1) * cosw0 - twoSqrtA * alpha;

	return normalise({ b0, b1, b2, a0, a1, a2 });
}
