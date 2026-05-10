// ── Cross-boundary types ──
// DTOs, port data contracts, and UI shapes that cross hexagon boundaries.

import type {
	SoundMode,
	RenderQuality,
	ListeningFocus,
	CompressionSettings,
	AudioMetrics,
	AudioSettingsSnapshot,
	AudioWindow,
	AudioLoadMetadata,
	ChannelAttempt,
} from "$lib/domain/types";

// Re-export domain types for backward compatibility
export type {
	SoundMode,
	RenderQuality,
	ListeningFocus,
	CompressionSettings,
	AudioMetrics,
	AudioSettingsSnapshot,
	AudioWindow,
	AudioLoadMetadata,
	ChannelAttempt,
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



export type PlaybackState = {
	state                : "stopped" | "starting" | "playing" | "failed";
	startedAtMs?         : number;
	contextState?        : AudioContextState;
	activeFingerprint?   : string;
	activeWindowId?      : string;
	meterLevel           : number;
	lastMeterChangeAtMs? : number;
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
