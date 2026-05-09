// ── Cross-boundary types ──
// DTOs, port data contracts, and UI shapes that cross hexagon boundaries.

import type {
	SoundMode,
	RenderQuality,
	ListeningFocus,
	CompressionSettings,
	AudioMetrics,
	AudioSettingsSnapshot,
} from "$lib/domain/types";

// Re-export domain types for backward compatibility
export type {
	SoundMode,
	RenderQuality,
	ListeningFocus,
	CompressionSettings,
	AudioMetrics,
	AudioSettingsSnapshot,
};

export type BridgeStatus = {
	mode              : "synthetic" | "udp";
	udpPort           : number;
	channels          : string[];
	samplesStored     : number;
	secondsStored     : number;
	latestTimestampMs : number | null;
	startedAtMs       : number;
};

export type ChannelAttempt = {
	channel : string;
	status  : "ok" | "empty" | "error";
	error?  : string;
};

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

export type PlaybackState = {
	state                : "stopped" | "starting" | "playing" | "failed";
	startedAtMs?         : number;
	contextState?        : AudioContextState;
	activeFingerprint?   : string;
	activeWindowId?      : string;
	meterLevel           : number;
	lastMeterChangeAtMs? : number;
};

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

export type WindowChoice = {
	label   : string;
	seconds : number;
};

export type PlaybackChoice = {
	label   : string;
	seconds : number;
};

export type StationChoice = {
	id          : string;
	name        : string;
	place       : string;
	channelHint : string;
	status      : "live" | "synthetic" | "archive";
};
