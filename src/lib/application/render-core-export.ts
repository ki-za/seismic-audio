// ── Application: Render Core Export Orchestrator ──
// Orchestrates the P0 domain DSP chain for offline WAV export.
//
// Signal flow:
//   prepareSamples → suppressImpulses → lookAheadLimiter → normalizeLoudness
//
// The caller is responsible for:
//   - Running polyphase resampling (bridge/recorder.ts)
//   - Applying the Web Audio chain (filters, saturation, compressor — sonifier.ts)
//   - Dither + PCM encoding (floatToInt16WithDither + audioBufferToWavBlob)
//
// This orchestrator replaces the inline chain in renderProcessedSeismicBuffer
// by running P0 domain algorithms BEFORE the OfflineAudioContext rendering,
// so the domain chain is pure Float32Array math with no Web Audio dependency.

import type {
	CompressionSettings,
	ImpulseParams,
	LimiterParams,
	ListeningFocus,
	LufsParams,
	SoundMode,
} from "$lib/domain/types";
import { prepareSamples } from "$lib/domain/sonification";
import { suppressImpulses } from "$lib/domain/impulse";
import { lookAheadLimiter } from "$lib/domain/limiter";
import { normalizeLoudness, measureIntegratedLUFS } from "$lib/domain/loudness";

// ── Export options ──

export type RenderCoreExportOptions = {
	/** Raw seismic samples from AudioWindow (before prepareSamples). */
	inputSamples     : number[];
	/** Sound mode for prepareSamples gain/fade. */
	mode             : SoundMode;
	/** Volume/mix parameters passed through (unused in P0 chain but kept for API symmetry). */
	compression      : CompressionSettings;
	/** Listening focus (unused in P0 chain). */
	focus            : ListeningFocus;
	/** Rendered sample rate in Hz. */
	sampleRate       : number;
	/** Impulse suppressor options. Falls back to sensible defaults. */
	impulseOptions?  : Partial<ImpulseParams>;
	/** Look-ahead limiter options. Falls back to standard preset. */
	limiterOptions?  : Partial<LimiterParams>;
	/** LUFS target. Defaults to -18 LUFS. */
	targetLUFS?      : number;
	/** Full LUFS params for override. */
	lufsParams?      : Partial<LufsParams>;
	/** If true, skip impulse suppression (bypass). */
	skipImpulse?     : boolean;
	/** If true, skip look-ahead limiter (bypass). */
	skipLimiter?     : boolean;
	/** If true, skip LUFS normalisation (bypass). */
	skipLoudness?    : boolean;
};

// ── Sensible defaults ──

const DEFAULT_IMPULSE: ImpulseParams = {
	radius          : 3,
	thresholdMAD    : 8,
	maxRepairLength : 3,
	blend           : 1.0,
};

const DEFAULT_LIMITER: LimiterParams = {
	ceilingDb     : -1,
	lookAheadMs   : 5,
	releaseMs     : 200,
	softClipKnee  : 0.92,
	softClipDrive : 1.2,
};

// ── Export metrics ──

export type RenderCoreExportMetrics = {
	/** Integrated LUFS of the final output. */
	integratedLUFS : number;
	/** Peak sample level (absolute max). */
	peak           : number;
	/** Root-mean-square level. */
	rms            : number;
	/** Crest factor = peak / RMS, unitless. */
	crestFactor    : number;
	/** LUFS of the input signal (before any processing). */
	inputLUFS      : number;
	/** Gain applied by LUFS normalisation in dB. */
	loudnessGainDb : number;
};

// ── Orchestrator ──

/**
 * Run the P0 core export chain on raw seismic samples.
 *
 * Steps:
 *   1. prepareSamples — DC offset removal, robust peak normalisation, edge fades
 *   2. suppressImpulses — Hampel-based click repair (skippable)
 *   3. lookAheadLimiter — mastering-style peak limiter (skippable)
 *   4. normalizeLoudness — BS.1770 integrated LUFS normalisation (skippable)
 *
 * @returns { samples, metrics } where samples is the final Float32Array (pre-dither).
 */
export function renderCoreExport(options: RenderCoreExportOptions): {
	samples : Float32Array;
	metrics : RenderCoreExportMetrics;
} {
	const {
		inputSamples,
		mode,
		sampleRate,
		targetLUFS = -18,
		skipImpulse  = false,
		skipLimiter  = false,
		skipLoudness = false,
	} = options;

	// 1. Prepare samples (DC offset, normalise, fade)
	const prepared = prepareSamples(inputSamples, mode);

	if (prepared.length === 0) {
		return {
			samples : new Float32Array(0),
			metrics : {
				integratedLUFS  : -Infinity,
				peak            : 0,
				rms             : 0,
				crestFactor     : 0,
				inputLUFS       : -Infinity,
				loudnessGainDb  : 0,
			},
		};
	}

	// Measure input LUFS for reporting
	const inputLUFS = measureIntegratedLUFS(prepared, sampleRate);

	// 2. Impulse suppression
	const deClicked = skipImpulse
		? prepared
		: suppressImpulses(prepared, { ...DEFAULT_IMPULSE, ...options.impulseOptions });

	// 3. Look-ahead limiter
	const limited = skipLimiter
		? deClicked
		: lookAheadLimiter(deClicked, sampleRate, { ...DEFAULT_LIMITER, ...options.limiterOptions });

	// 4. LUFS normalisation
	const normalized = skipLoudness
		? limited
		: normalizeLoudness(limited, sampleRate, targetLUFS, options.lufsParams);

	// Compute output metrics
	const metrics = computeExportMetrics(normalized, sampleRate, inputLUFS, targetLUFS);

	return { samples: normalized, metrics };
}

// ── Metrics helper ──

function computeExportMetrics(
	samples    : Float32Array,
	sampleRate : number,
	inputLUFS  : number,
	targetLUFS : number,
): RenderCoreExportMetrics {
	const n = samples.length;
	if (n === 0) {
		return {
			integratedLUFS  : -Infinity,
			peak            : 0,
			rms             : 0,
			crestFactor     : 0,
			inputLUFS,
			loudnessGainDb  : 0,
		};
	}

	const integratedLUFS = measureIntegratedLUFS(samples, sampleRate);

	let peak = 0;
	let sumSq = 0;
	for (let i = 0; i < n; i++) {
		const abs = Math.abs(samples[i]);
		if (abs > peak) peak = abs;
		sumSq += samples[i] * samples[i];
	}

	const rms = Math.sqrt(sumSq / n);
	const crestFactor = rms > 1e-15 ? peak / rms : 0;

	// Estimate loudness gain = target - measured (with measure being input)
	// This is the gain that was applied; negative means the signal was reduced
	const loudnessGainDb = isFinite(integratedLUFS)
		? targetLUFS - inputLUFS
		: 0;

	return {
		integratedLUFS,
		peak,
		rms,
		crestFactor,
		inputLUFS,
		loudnessGainDb: isFinite(loudnessGainDb) ? loudnessGainDb : 0,
	};
}
