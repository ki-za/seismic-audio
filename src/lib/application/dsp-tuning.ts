// ── Application: DSP Tuning Pipeline ──
// Wraps the P0 + most useful P1 domain algorithms into a configurable
// pipeline for live playback. Each stage can be individually enabled/disabled
// so the user can A/B individual effects in real time.
//
// Signal flow:
//   prepareSamples
//   → [impulse suppression]  (P0)
//   → [saturation]           (P1)
//   → [expander/noise gate]  (P1)
//   → ready for Web Audio

import type {
	ExpanderParams,
	ImpulseParams,
	SaturationParams,
} from "$lib/domain/types";
import { prepareSamples } from "$lib/domain/sonification";
import { suppressImpulses } from "$lib/domain/impulse";
import { asymmetricSaturation } from "$lib/domain/saturation";
import { expanderWithComfortNoise } from "$lib/domain/expander";
import type { SoundMode } from "$lib/domain/types";

// ── DSP Tuning State ──
// One object holds every knob the user can tweak.
// This is the single source of truth for the DSP tuning UI.

export type DspTuningState = {
	impulse   : { enabled: boolean } & ImpulseParams;
	saturation: { enabled: boolean } & SaturationParams;
	expander  : { enabled: boolean } & ExpanderParams;
};

// ── Sensible defaults (conservative, gallery-friendly) ──

export const DEFAULT_DSP_TUNING: DspTuningState = {
	impulse: {
		enabled         : true,
		radius          : 3,
		thresholdMAD    : 8,
		maxRepairLength : 3,
		blend           : 1.0,
	},
	saturation: {
		enabled      : false,
		drive        : 1.6,
		knee         : 0.80,
		asymmetry    : 0.06,
		wetDryMix    : 0.20,
		outputTrimDb : -1.5,
	},
	expander: {
		enabled             : false,
		thresholdDb         : -50,
		ratio               : 1.8,
		maxDepthDb          : 10,
		attackMs            : 25,
		releaseMs           : 350,
		comfortNoiseLevelDb : -62,
		noiseColor          : "pink",
	},
};

// ── Pipeline ──

/**
 * Apply all enabled DSP tuning stages to raw seismic samples.
 *
 * Call this BEFORE Web Audio chain (the output goes straight to
 * AudioBufferSourceNode + your existing Web Audio nodes).
 *
 * @param inputSamples — Raw seismic samples (from AudioWindow).
 * @param mode         — Sound mode (affects prepareSamples gain/fade).
 * @param sampleRate   — Sample rate for time-parameterised algorithms.
 * @param tuning       — DSP tuning state (partial OK).
 * @returns            — Processed Float32Array ready for Web Audio.
 */
export function applyDspTuning(
	inputSamples : number[],
	mode         : SoundMode,
	sampleRate   : number,
	tuning?      : Partial<DspTuningState>,
): Float32Array {
	const opts = deepMerge(DEFAULT_DSP_TUNING, tuning ?? {});

	let samples = prepareSamples(inputSamples, mode);

	// Stage 1: Impulse suppression (P0)
	if (opts.impulse.enabled) {
		samples = suppressImpulses(samples, {
			radius          : opts.impulse.radius,
			thresholdMAD    : opts.impulse.thresholdMAD,
			maxRepairLength : opts.impulse.maxRepairLength,
			blend           : opts.impulse.blend,
		});
	}

	// Stage 2: Asymmetric saturation (P1)
	if (opts.saturation.enabled) {
		samples = asymmetricSaturation(samples, {
			drive        : opts.saturation.drive,
			knee         : opts.saturation.knee,
			asymmetry    : opts.saturation.asymmetry,
			wetDryMix    : opts.saturation.wetDryMix,
			outputTrimDb : opts.saturation.outputTrimDb,
		});
	}

	// Stage 3: Downward expander with comfort noise (P1)
	if (opts.expander.enabled) {
		samples = expanderWithComfortNoise(samples, sampleRate, {
			thresholdDb         : opts.expander.thresholdDb,
			ratio               : opts.expander.ratio,
			maxDepthDb          : opts.expander.maxDepthDb,
			attackMs            : opts.expander.attackMs,
			releaseMs           : opts.expander.releaseMs,
			comfortNoiseLevelDb : opts.expander.comfortNoiseLevelDb,
			noiseColor          : opts.expander.noiseColor,
		});
	}

	return samples;
}

// ── Deep merge helper ──
// Only overwrites keys that are actually provided in the partial.

function deepMerge<T extends Record<string, unknown>>(
	base   : T,
	partial: Partial<T>,
): T {
	const result = { ...base };
	for (const key of Object.keys(partial) as (keyof T)[]) {
		const val = partial[key];
		if (val !== undefined) {
			if (typeof val === "object" && val !== null && !Array.isArray(val)) {
				result[key] = deepMerge(
					base[key] as Record<string, unknown>,
					val as Record<string, unknown>,
				) as T[typeof key];
			} else {
				result[key] = val as T[typeof key];
			}
		}
	}
	return result;
}
