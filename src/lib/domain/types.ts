// ── Domain types ──
// Pure value types owned by the domain.
// These have no browser/node/framework dependencies.

export type SoundMode      = "soft" | "clear" | "raw" | "deep" | "bright";
export type RenderQuality  = "studio" | "balanced" | "installation-safe";
export type ListeningFocus = "gentle" | "event" | "texture" | "scientific";

export type CompressionSettings = {
	thresholdDb : number;
	ratio       : number;
	attackMs    : number;
	releaseMs   : number;
	makeupDb    : number;
};

export type AudioMetrics = {
	sampleCount       : number;
	sampleRate        : number;
	durationSeconds   : number;
	rms               : number;
	peak              : number;
	mean              : number;
	zeroCrossingRate? : number;
};

export type AudioSettingsSnapshot = {
	soundMode          : SoundMode;
	listeningFocus     : ListeningFocus;
	compression        : CompressionSettings;
	renderQuality      : RenderQuality;
	playbackSeconds    : number;
	renderedSampleRate : number;
};

// ── P0 DSP Algorithm Types ──

export type WindowType = "kaiser" | "hann" | "blackman" | "lanczos";

export type PolyphaseOptions = {
	filterTaps  : number;     // 16–256; preview=16–32, export=64–256
	phaseCount  : number;     // 512–4096
	cutoff      : number;     // 0.90–0.96 of Nyquist
	window      : WindowType;
	kaiserBeta? : number;     // 5–10, only for kaiser
};

export type ImpulseParams = {
	radius          : number; // 3–8 samples
	thresholdMAD    : number; // 6–12 (MAD units)
	maxRepairLength : number; // 1–5 samples
	blend           : number; // 0.5–1.0
};

export type LimiterParams = {
	ceilingDb     : number;   // -3 to -0.5 dB
	lookAheadMs   : number;   // 1–10 ms
	releaseMs     : number;   // 50–300 ms
	softClipKnee  : number;   // 0.75–0.98
	softClipDrive : number;   // 1.0–1.5
};

export type LufsParams = {
	targetLUFS        : number; // -20 to -16, recommended -18
	truePeakCeilingDb : number; // -1 dB
	blockLengthMs     : number; // 400 ms
	hopMs             : number; // 100 ms
	absoluteGate      : number; // -70 LUFS
};

// ── P1 DSP Algorithm Types ──

export type SaturationParams = {
	drive        : number; // 1.1–3.0
	knee         : number; // 0.6–0.95
	asymmetry    : number; // 0.0–0.2
	wetDryMix    : number; // 0.05–0.4
	outputTrimDb : number; // -3 to 0 dB
};

export type DeEsserParams = {
	detectorFrequencyHz : number;  // 2000–8000 Hz
	relativeThresholdDb : number;  // -20 to 0 dB
	maxReductionDb      : number;  // 3–12 dB
	attackMs            : number;  // 0.5–5 ms
	releaseMs           : number;  // 30–200 ms
};

export type BandCompressorParams = {
	thresholdDb : number;
	ratio       : number;
	attackMs    : number;
	releaseMs   : number;
	makeupDb    : number;
};

export type MultibandParams = {
	lowCrossoverHz  : number;                      // 150–350 Hz
	highCrossoverHz : number;                      // 2000–5000 Hz
	bands           : [BandCompressorParams, BandCompressorParams, BandCompressorParams];
};

export type DynamicEqParams = {
	frequencyHz : number; // 500–9000 Hz
	Q           : number; // 0.5–8
	thresholdDb : number; // -40 to -12 dB
	maxCutDb    : number; // 1–9 dB
	attackMs    : number; // 2–20 ms
	releaseMs   : number; // 80–300 ms
};

export type NoiseColor = "white" | "pink";

export type ExpanderParams = {
	thresholdDb          : number;    // -60 to -35 dB
	ratio                : number;    // 1.2–2.5
	maxDepthDb           : number;    // 6–18 dB
	attackMs             : number;    // 10–50 ms
	releaseMs            : number;    // 200–1000 ms
	comfortNoiseLevelDb  : number;    // -70 to -55 dB
	noiseColor           : NoiseColor;
};

export type PseudoStereoParams = {
	sideDelayMs    : number; // 3–12 ms
	sideHighpassHz : number; // 500–1000 Hz
	sideLowpassHz  : number; // 6000–12000 Hz
	width          : number; // 0.05–0.35
};

// ── Cross-Boundary Types (defined here so domain can reference them) ──

/**
 * Metadata about a single attempted channel load.
 */
export type ChannelAttempt = {
	channel : string;
	status  : "ok" | "empty" | "error";
	error?  : string;
};

/**
 * Metadata about how/where the audio window was loaded.
 */
export type AudioLoadMetadata = {
	loadedAtISO           : string;
	requestHost?          : string;
	delayMinutes?         : number;
	requestedStartISO?    : string;
	requestedEndISO?      : string;
	requestedChannel?     : string;
	actualChannel         : string;
	channelFallbackOrder? : string[];
	attemptedChannels?    : ChannelAttempt[];
};

/**
 * Audio window — the core data contract flowing across boundaries.
 * Defined in the domain so domain functions can reference it without
 * depending on cross-boundary types.
 */
export type AudioWindow = {
	channel            : string;
	windowSeconds      : number;
	playbackSeconds    : number;
	sourceSampleRate   : number;
	renderedSampleRate : number;
	samples            : number[];
	availableSeconds   : number;
	network?           : string;
	station?           : string;
	location?          : string;
	startISO?          : string;
	endISO?            : string;
	source?            : "bridge" | "raspberryshake";
	metadata?          : AudioLoadMetadata;
	metrics?           : AudioMetrics;
};
