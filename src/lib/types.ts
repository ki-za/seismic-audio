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

export type AudioWindow = {
	channel: string;
	windowSeconds: number;
	playbackSeconds: number;
	sourceSampleRate: number;
	renderedSampleRate: number;
	samples: number[];
	availableSeconds: number;
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
	status: 'live' | 'stub' | 'archive';
};
