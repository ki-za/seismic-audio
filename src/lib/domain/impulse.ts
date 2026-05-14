// ── Hampel / Median Impulse Suppressor ──
// Pure math — no browser/node/framework dependencies.
// Detects isolated outlier samples using local median & MAD,
// then repairs runs of outliers with linear interpolation.

import type { ImpulseParams } from "./types";
import { clamp, lerp, mix } from "./dsp";

// Pre-allocated scratch buffer to avoid GC pressure at runtime.
// Sized for the maximum window (2 * radius + 1 minus center = 2 * radius).
// radius max is 8 → max window = 16. We allocate 32 for safety.
const _scratch64 = new Float64Array(32);
const _scratchCount = new Float32Array(16); // for repair-run local median store

/**
 * Detect and repair impulse outliers using the Hampel identifier.
 *
 * Algorithm:
 *   For each sample, compute the local median and MAD of its neighborhood.
 *   If the sample deviates by more than `thresholdMAD` MAD units,
 *   repair the run of outliers by linearly interpolating between
 *   the nearest good samples on either side.
 *
 * @param input   Mono audio buffer, range [-1, 1].
 * @param options Radius, threshold, repair length, blend.
 * @returns New Float32Array with impulses suppressed.
 */
export function suppressImpulses(
	input   : Float32Array,
	options : ImpulseParams,
): Float32Array {
	const n              = input.length;
	const output         = new Float32Array(n);
	const radius         = Math.max(1, Math.min(8, options.radius));
	const threshold      = Math.max(2, options.thresholdMAD);
	const maxRepairLen   = Math.max(1, Math.min(10, options.maxRepairLength));
	const blend          = clamp(options.blend, 0, 1);
	const windowSize     = 2 * radius; // neighborhood excludes center
	let idx              = radius;

	// Copy input to output initially; we'll overwrite repaired regions
	for (let i = 0; i < n; i++) output[i] = input[i];

	while (idx < n - radius) {
		// Collect neighborhood values (exclude center)
		let count = 0;
		for (let off = -radius; off <= radius; off++) {
			if (off === 0) continue;
			_scratch64[count] = input[idx + off];
			count++;
		}

		// Sort for median
		_scratch64.subarray(0, count).sort();

		const localMedian = count % 2 === 1
			? _scratch64[(count - 1) / 2]
			: (_scratch64[count / 2 - 1] + _scratch64[count / 2]) / 2;

		// Compute MAD (median absolute deviation)
		for (let j = 0; j < count; j++) {
			_scratch64[j] = Math.abs(_scratch64[j] - localMedian);
		}
		_scratch64.subarray(0, count).sort();

		const mad = count % 2 === 1
			? _scratch64[(count - 1) / 2]
			: (_scratch64[count / 2 - 1] + _scratch64[count / 2]) / 2;

		const safeMad = Math.max(mad, 1e-15);
		const score   = Math.abs(input[idx] - localMedian) / safeMad;

		if (score > threshold) {
			// Extend the repair run
			let repairStart = idx;
			let repairEnd   = idx;

			while (repairEnd + 1 < n - radius) {
				const nextIdx  = repairEnd + 1;
				let nextCount  = 0;
				for (let off = -radius; off <= radius; off++) {
					if (off === 0) continue;
					_scratchCount[nextCount] = input[nextIdx + off];
					nextCount++;
				}
				// Quick median via sort of subarray
				const win = Float64Array.from(_scratchCount.subarray(0, nextCount));
				win.sort();
				const nextMedian = win.length % 2 === 1
					? win[(win.length - 1) / 2]
					: (win[win.length / 2 - 1] + win[win.length / 2]) / 2;

				for (let j = 0; j < nextCount; j++) {
					win[j] = Math.abs(win[j] - nextMedian);
				}
				win.sort();
				const nextMad = win.length % 2 === 1
					? win[(win.length - 1) / 2]
					: (win[win.length / 2 - 1] + win[win.length / 2]) / 2;

				const nextScore = Math.abs(input[nextIdx] - nextMedian) / Math.max(nextMad, 1e-15);
				if (nextScore <= threshold) break;
				if (repairEnd - repairStart + 1 >= maxRepairLen) break;
				repairEnd++;
			}

			// Linear interpolation between the good neighbours
			const leftVal  = input[repairStart - 1];
			const rightVal = input[Math.min(repairEnd + 1, n - 1)];
			const runLen   = repairEnd - repairStart + 1;

			for (let ri = repairStart; ri <= repairEnd; ri++) {
				const t       = (ri - repairStart + 1) / (runLen + 1);
				const repaired = lerp(leftVal, rightVal, t);
				output[ri] = mix(input[ri], repaired, blend);
			}

			idx = repairEnd + 1;
		} else {
			idx++;
		}
	}

	return output;
}
