// ── Application: Chunked Audio Preparation ──
// Wraps the pure domain `prepareSamples` with browser yield points
// so large arrays don't block the UI.
//
// Domain stays pure (sync math only); this adapter concern lives here.

import { prepareSamples, estimateRobustPeak } from "$lib/domain/sonification";
import type { SoundMode } from "$lib/domain/types";

const CHUNK_SIZE = 500_000;

/**
 * Prepare samples in chunks, calling onProgress(pct) after each chunk.
 * Yields to the browser event loop between chunks so the UI stays responsive.
 * Arrays under the chunk threshold are processed synchronously.
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
