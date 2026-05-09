// ── Domain: Sonification DSP ──
// Pure math — no browser/node/framework dependencies.
// These functions prepare and shape seismic samples into listenable audio.

import type {
	CompressionSettings,
	ListeningFocus,
	SoundMode,
} from "$lib/domain/types";

/**
 * Remove DC offset, normalize to 98th-percentile peak, apply edge fades.
 * Pure numeric transform — does not touch Web Audio API.
 */
export function prepareSamples(input: number[], mode: SoundMode): Float32Array {
	const output = new Float32Array(input.length);
	if (input.length === 0) return output;

	let sum = 0;
	for (let i = 0; i < input.length; i += 1) sum += input[i];
	const mean       = sum / input.length;
	const robustPeak = estimateRobustPeak(input, mean);
	const gain = (mode === "raw" ? 0.7 : 0.9) / robustPeak;
	const fadeSamples = Math.min(Math.floor(input.length * 0.03), 48_000);

	for (let i = 0; i < input.length; i += 1) {
		const fadeIn = fadeSamples > 0 ? Math.min(1, i / fadeSamples) : 1;
		const fadeOut =
			fadeSamples > 0 ? Math.min(1, (input.length - i - 1) / fadeSamples) : 1;
		output[i] =
			Math.max(-1, Math.min(1, (input[i] - mean) * gain)) *
			Math.min(fadeIn, fadeOut);
	}

	return output;
}

/**
 * 98th-percentile peak estimator, safe for large arrays (subsamples to 100k).
 */
export function estimateRobustPeak(input: number[], mean: number): number {
	const maxSamples = 100_000;
	const stride     = Math.max(1, Math.floor(input.length / maxSamples));
	const values     = new Array<number>(Math.ceil(input.length / stride));
	let count        = 0;

	for (let i = 0; i < input.length; i += stride) {
		values[count] = Math.abs(input[i] - mean);
		count += 1;
	}
	values.length = count;
	values.sort((a, b) => a - b);
	return values[Math.floor(values.length * 0.98)] || 1;
}

/**
 * Transform compression settings based on listening focus.
 * Gentle = pass-through. Event = lighter compression. Texture = heavier. Scientific = minimal.
 */
export function applyFocus(
	compression : CompressionSettings,
	focus       : ListeningFocus,
): CompressionSettings {
	if (focus === "event")
		return {
			...compression,
			thresholdDb : Math.min(compression.thresholdDb + 4, -4),
			ratio       : Math.max(2, compression.ratio * 0.75),
		};
	if (focus === "texture")
		return {
			...compression,
			thresholdDb : compression.thresholdDb - 6,
			ratio       : compression.ratio + 2,
			makeupDb    : compression.makeupDb + 2,
		};
	if (focus === "scientific")
		return { ...compression, thresholdDb: -6, ratio: 2, makeupDb: 0 };
	return compression;
}

// ── Chunked preparation for large arrays ──
// Yields to the browser event loop between chunks so the UI stays responsive.
// Arrays under the chunk threshold are processed synchronously (same as prepareSamples).

const CHUNK_SIZE = 500_000;

/**
 * Prepare samples in chunks, calling onProgress(pct) after each chunk.
 * Returns a Promise that resolves to the prepared Float32Array.
 */
export async function prepareSamplesChunked(
	input : number[],
	mode  : SoundMode,
	onProgress: (pct: number) => void,
): Promise<Float32Array> {
	if (input.length <= CHUNK_SIZE) {
		onProgress(1);
		return prepareSamples(input, mode);
	}

	// Phase 1: compute mean and robustPeak (small overhead, synchronous)
	let sum = 0;
	for (let i = 0; i < input.length; i += 1) sum += input[i];
	const mean       = sum / input.length;
	const robustPeak = estimateRobustPeak(input, mean);
	const gain = (mode === "raw" ? 0.7 : 0.9) / robustPeak;
	const fadeSamples = Math.min(Math.floor(input.length * 0.03), 48_000);

	onProgress(0.05);

	// Phase 2: process in chunks
	const output      = new Float32Array(input.length);
	const totalChunks = Math.ceil(input.length / CHUNK_SIZE);

	for (let chunk = 0; chunk < totalChunks; chunk += 1) {
		const start = chunk * CHUNK_SIZE;
		const end   = Math.min(start + CHUNK_SIZE, input.length);

		for (let i = start; i < end; i += 1) {
			const fadeIn = fadeSamples > 0 ? Math.min(1, i / fadeSamples) : 1;
			const fadeOut =
				fadeSamples > 0 ? Math.min(1, (input.length - i - 1) / fadeSamples) : 1;
			output[i] =
				Math.max(-1, Math.min(1, (input[i] - mean) * gain)) *
				Math.min(fadeIn, fadeOut);
		}

		const pct = 0.05 + ((chunk + 1) / totalChunks) * 0.95;
		onProgress(pct);

		if (chunk < totalChunks - 1) {
			await yieldToBrowser();
		}
	}

	return output;
}

/** Yield control back to the browser event loop for one tick. */
function yieldToBrowser(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * RMS level from a Float32Array, scaled 0-1 with a 4x multiplier matching the live meter.
 */
export function measureRms(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

/**
 * Convert dB to linear gain.
 */
export function dbToGain(db: number): number {
	return 10 ** (db / 20);
}

/**
 * Generate a tanh saturation curve as a Float32Array for WaveShaperNode.
 * Returns pure data — the caller wires it into a Web Audio node.
 */
export function makeSaturationCurve(amount: number): Float32Array {
	const samples = 2048;
	const curve   = new Float32Array(samples);
	for (let i = 0; i < samples; i += 1) {
		const x = (i * 2) / samples - 1;
		curve[i] = Math.tanh(x * amount);
	}
	return curve;
}
