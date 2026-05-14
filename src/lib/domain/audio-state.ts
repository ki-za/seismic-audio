import type {
	AudioMetrics,
	AudioSettingsSnapshot,
	AudioWindow,
	CompressionSettings,
	ListeningFocus,
	RenderQuality,
	SoundMode,
} from "$lib/domain/types";
import type { ProviderId } from "$lib/domain/provider-id";

export type AudioRequestKeyInput = {
	provider        : ProviderId;
	stationId       : string;
	channel?        : string;
	windowSeconds   : number;
	playbackSeconds : number;
	renderQuality   : RenderQuality;
	startISO?       : string;
};

export function buildRequestKey(input: AudioRequestKeyInput): string {
	return stableFingerprint({
		provider        : input.provider,
		stationId       : input.stationId,
		channel         : input.channel ?? "",
		windowSeconds   : input.windowSeconds,
		playbackSeconds : input.playbackSeconds,
		renderQuality   : input.renderQuality,
		startISO        : input.startISO ?? "",
	});
}

export function buildWindowId(window: AudioWindow, requestKey: string): string {
	return stableFingerprint({
		requestKey,
		source             : window.source ?? "bridge",
		network            : window.network ?? "",
		station            : window.station ?? "",
		location           : window.location ?? "",
		channel            : window.channel,
		startISO           : window.startISO ?? "",
		endISO             : window.endISO ?? "",
		renderedSampleRate : window.renderedSampleRate,
		sampleCount        : window.samples.length,
	});
}

export function buildAudioSettingsSnapshot(options: {
	soundMode          : SoundMode;
	listeningFocus     : ListeningFocus;
	compression        : CompressionSettings;
	renderQuality      : RenderQuality;
	playbackSeconds    : number;
	renderedSampleRate : number;
}): AudioSettingsSnapshot {
	return { ...options, compression: { ...options.compression } };
}

export function fingerprintAudioSettings(
	snapshot: AudioSettingsSnapshot,
): string {
	return stableFingerprint(snapshot);
}

export function measureAudioSamples(
	samples    : ArrayLike<number>,
	sampleRate : number,
): AudioMetrics {
	let sum       = 0;
	let squares   = 0;
	let peak      = 0;
	let crossings = 0;
	let previous = samples.length > 0 ? samples[0] : 0;
	for (let i = 0; i < samples.length; i += 1) {
		const value = samples[i];
		sum += value;
		squares += value * value;
		peak = Math.max(peak, Math.abs(value));
		if (i > 0 && Math.sign(value) !== Math.sign(previous)) crossings += 1;
		previous = value;
	}
	const sampleCount = samples.length;
	return {
		sampleCount,
		sampleRate,
		durationSeconds : sampleRate > 0 ? sampleCount / sampleRate          : 0,
		rms             : sampleCount > 0 ? Math.sqrt(squares / sampleCount) : 0,
		peak,
		mean             : sampleCount > 0 ? sum / sampleCount             : 0,
		zeroCrossingRate : sampleCount > 1 ? crossings / (sampleCount - 1) : 0,
	};
}

export function isStale(
	selectedRequestKey : string,
	loadedRequestKey   : string | null,
): boolean {
	return Boolean(loadedRequestKey && selectedRequestKey !== loadedRequestKey);
}

function stableFingerprint(value: unknown): string {
	const text = JSON.stringify(sortValue(value));
	let hash   = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		hash  ^= text.charCodeAt(i);
		hash   = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, sortValue(item)]),
		);
	}
	return value;
}
