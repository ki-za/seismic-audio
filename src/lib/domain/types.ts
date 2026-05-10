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
