export type SoundMode = 'soft' | 'clear' | 'raw' | 'deep' | 'bright';
export type RenderQuality = 'studio' | 'balanced' | 'installation-safe';
export type ListeningFocus = 'gentle' | 'event' | 'texture' | 'scientific';

export type BridgeStatus = {
	mode: 'synthetic' | 'udp';
	udpPort: number;
	channels: string[];
	samplesStored: number;
	secondsStored: number;
	latestTimestampMs: number | null;
	startedAtMs: number;
};

export type ChannelAttempt = {
	channel: string;
	status: 'ok' | 'empty' | 'error';
	error?: string;
};

export type AudioLoadMetadata = {
	loadedAtISO: string;
	requestHost?: string;
	delayMinutes?: number;
	requestedStartISO?: string;
	requestedEndISO?: string;
	requestedChannel?: string;
	actualChannel: string;
	channelFallbackOrder?: string[];
	attemptedChannels?: ChannelAttempt[];
};

export type AudioMetrics = {
	sampleCount: number;
	sampleRate: number;
	durationSeconds: number;
	rms: number;
	peak: number;
	mean: number;
	zeroCrossingRate?: number;
};

export type AudioSettingsSnapshot = {
	soundMode: SoundMode;
	listeningFocus: ListeningFocus;
	compression: CompressionSettings;
	renderQuality: RenderQuality;
	playbackSeconds: number;
	renderedSampleRate: number;
};

export type PlaybackState = {
	state: 'stopped' | 'starting' | 'playing' | 'failed';
	startedAtMs?: number;
	contextState?: AudioContextState;
	activeFingerprint?: string;
	activeWindowId?: string;
	meterLevel: number;
	lastMeterChangeAtMs?: number;
};

export type AudioWindow = {
	channel: string;
	windowSeconds: number;
	playbackSeconds: number;
	sourceSampleRate: number;
	renderedSampleRate: number;
	samples: number[];
	availableSeconds: number;
	network?: string;
	station?: string;
	location?: string;
	startISO?: string;
	endISO?: string;
	source?: 'bridge' | 'raspberryshake';
	metadata?: AudioLoadMetadata;
	metrics?: AudioMetrics;
};

export type WindowChoice = {
	label: string;
	seconds: number;
};

export type PlaybackChoice = {
	label: string;
	seconds: number;
};

export type CompressionSettings = {
	thresholdDb: number;
	ratio: number;
	attackMs: number;
	releaseMs: number;
	makeupDb: number;
};

export type StationChoice = {
	id: string;
	name: string;
	place: string;
	channelHint: string;
	status: 'live' | 'synthetic' | 'archive';
};
