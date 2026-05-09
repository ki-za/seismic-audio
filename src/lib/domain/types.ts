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
