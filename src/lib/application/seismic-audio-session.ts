import { buildAudioSettingsSnapshot, buildWindowId, fingerprintAudioSettings, measureAudioSamples } from '$lib/domain/audio-state';
import { transitionLoadState, type LoadStateSnapshot } from '$lib/domain/load-state';
import { nslcForStation, type StationId } from '$lib/domain/station';
import { isArchiveProvider, providerLabel, type ProviderId } from '$lib/domain/provider-id';
import type { AudioPlayer, AudioRenderer, AudioWindowSource, FileDownloader } from '$lib/ports/audio';
import type { AudioSettingsSnapshot, AudioWindow, CompressionSettings, ListeningFocus, RenderQuality, SoundMode } from '$lib/types';

export type LoadAudioWindowCommand = {
	source: AudioWindowSource;
	requestKey: string;
	request: Parameters<AudioWindowSource['getAudioWindow']>[0];
	settings: {
		soundMode: SoundMode;
		listeningFocus: ListeningFocus;
		compression: CompressionSettings;
		renderQuality: RenderQuality;
		playbackSeconds: number;
	};
};

export type LoadedAudioWindow = {
	window: AudioWindow;
	requestKey: string;
	windowId: string;
	settingsSnapshot: AudioSettingsSnapshot;
	settingsFingerprint: string;
};

export async function loadAudioWindow(command: LoadAudioWindowCommand): Promise<LoadedAudioWindow> {
	const window = await command.source.getAudioWindow(command.request);
	window.metrics ??= measureAudioSamples(window.samples, window.renderedSampleRate);
	const settingsSnapshot = buildAudioSettingsSnapshot({
		...command.settings,
		renderedSampleRate: window.renderedSampleRate
	});
	return {
		window,
		requestKey: command.requestKey,
		windowId: buildWindowId(window, command.requestKey),
		settingsSnapshot,
		settingsFingerprint: fingerprintAudioSettings(settingsSnapshot)
	};
}

export async function playAudioWindow(command: {
	player: AudioPlayer;
	window: AudioWindow;
	soundMode: SoundMode;
	compression: CompressionSettings;
	listeningFocus: ListeningFocus;
}): Promise<void> {
	await command.player.play(command.window, command.soundMode, command.compression, command.listeningFocus);
}

/**
 * Play with pre-prepared samples.
 * Caller runs prepareSamplesChunked first, then passes the result here.
 * This avoids synchronous blocking inside the player.
 */
export async function playPreparedAudioWindow(command: {
	player: AudioPlayer;
	samples: Float32Array;
	renderedSampleRate: number;
	soundMode: SoundMode;
	compression: CompressionSettings;
	listeningFocus: ListeningFocus;
}): Promise<void> {
	await command.player.playPrepared(command.samples, command.renderedSampleRate, command.soundMode, command.compression, command.listeningFocus);
}

export type ExportNameInput = {
	stationId: string;
	channel: string;
	windowSeconds: number;
	playbackSeconds: number;
	soundMode: SoundMode;
	renderQuality: RenderQuality;
};

export function makeExportName(input: ExportNameInput, extension: 'wav' | 'json'): string {
	const channel = input.channel.replace(/[^a-z0-9_-]/gi, '-');
	return `seismic-${input.stationId}-${channel}-${input.windowSeconds}s-to-${input.playbackSeconds}s-${input.soundMode}-${input.renderQuality}.${extension}`;
}

export type ExportMetadataInput = {
	window: AudioWindow;
	soundMode: SoundMode;
	renderQuality: RenderQuality;
	listeningFocus: ListeningFocus;
	compression: CompressionSettings;
	windowId: string;
	settingsFingerprint: string;
};

export function makeExportMetadata(input: ExportMetadataInput) {
	return {
		source: input.window.source ?? 'bridge',
		network: input.window.network,
		station: input.window.station,
		location: input.window.location,
		channel: input.window.channel,
		startISO: input.window.startISO,
		endISO: input.window.endISO,
		windowSeconds: input.window.windowSeconds,
		playbackSeconds: input.window.playbackSeconds,
		availableSeconds: input.window.availableSeconds,
		sourceSampleRate: input.window.sourceSampleRate,
		renderedSampleRate: input.window.renderedSampleRate,
		soundMode: input.soundMode,
		renderQuality: input.renderQuality,
		listeningFocus: input.listeningFocus,
		compression: input.compression,
		loadedWindowId: input.windowId,
		audioSettingsFingerprint: input.settingsFingerprint,
		renderMetrics: input.window.metrics ?? null,
		loadMetadata: input.window.metadata,
		processing: ['linear resample to playback duration', 'mean removal', '98th-percentile normalization', 'edge fade', 'high-pass', 'low-pass', 'tanh saturation', 'dynamics compression', 'gain'],
		exportedAtISO: new Date().toISOString()
	};
}

export async function exportAudioWindow(command: {
	renderer: AudioRenderer;
	downloader: FileDownloader;
	window: AudioWindow;
	soundMode: SoundMode;
	compression: CompressionSettings;
	listeningFocus: ListeningFocus;
	wavFilename: string;
	metadataFilename: string;
	metadata: unknown;
}): Promise<void> {
	const wavFile = await command.renderer.renderWavFile(command.window, command.soundMode, command.compression, command.listeningFocus, command.wavFilename);
	command.downloader.downloadFile(wavFile);
	command.downloader.downloadFile({
		filename: command.metadataFilename,
		content: JSON.stringify(command.metadata, null, 2),
		contentType: 'application/json'
	});
}

// ── Tier 2 use cases ──

export type ProviderInfo = {
	id: ProviderId;
	label: string;
	isArchive: boolean;
};

/**
 * Return provider metadata for a given station id.
 * Orchestrates domain value objects — no I/O.
 */
export function selectProvider(stationId: StationId): ProviderInfo {
	const id = stationId === 'local' ? 'bridge' : 'raspberryshake';
	return {
		id,
		label: providerLabel(id),
		isArchive: isArchiveProvider(id)
	};
}

export type SettingsComparison = {
	soundModeChanged: boolean;
	listeningFocusChanged: boolean;
	compressionChanged: boolean;
	renderQualityChanged: boolean;
	playbackSecondsChanged: boolean;
	anyChanged: boolean;
	changedLabels: string[];
};

/**
 * Compare two audio settings snapshots and return what changed.
 * Pure — no I/O.
 */
export function compareAudioSettings(
	current: AudioSettingsSnapshot,
	loaded: AudioSettingsSnapshot | null
): SettingsComparison {
	if (!loaded) {
		return {
			soundModeChanged: false,
			listeningFocusChanged: false,
			compressionChanged: false,
			renderQualityChanged: false,
			playbackSecondsChanged: false,
			anyChanged: false,
			changedLabels: []
		};
	}

	const changedLabels: string[] = [];

	const soundModeChanged = current.soundMode !== loaded.soundMode;
	if (soundModeChanged) changedLabels.push('sound mode');

	const listeningFocusChanged = current.listeningFocus !== loaded.listeningFocus;
	if (listeningFocusChanged) changedLabels.push('focus');

	const compressionChanged =
		current.compression.thresholdDb !== loaded.compression.thresholdDb ||
		current.compression.ratio !== loaded.compression.ratio ||
		current.compression.attackMs !== loaded.compression.attackMs ||
		current.compression.releaseMs !== loaded.compression.releaseMs ||
		current.compression.makeupDb !== loaded.compression.makeupDb;
	if (compressionChanged) changedLabels.push('compression');

	const renderQualityChanged = current.renderQuality !== loaded.renderQuality;
	if (renderQualityChanged) changedLabels.push('quality');

	const playbackSecondsChanged = current.playbackSeconds !== loaded.playbackSeconds;
	if (playbackSecondsChanged) changedLabels.push('playback length');

	return {
		soundModeChanged,
		listeningFocusChanged,
		compressionChanged,
		renderQualityChanged,
		playbackSecondsChanged,
		anyChanged: changedLabels.length > 0,
		changedLabels
	};
}

/**
 * Advance the load state machine after an audio window load attempt.
 */
export function advanceLoadState(
	prev: LoadStateSnapshot,
	result: { ok: true; requestedChannel: string; actualChannel: string } | { ok: false; error: string }
): LoadStateSnapshot {
	if (result.ok) {
		return transitionLoadState(prev, {
			kind: 'LOAD_SUCCEEDED',
			requestedChannel: result.requestedChannel,
			actualChannel: result.actualChannel
		});
	}
	return transitionLoadState(prev, { kind: 'LOAD_FAILED', error: result.error });
}

/**
 * Get the NSLC for a station, if known.
 */
export function getStationNSLC(stationId: StationId) {
	return nslcForStation(stationId);
}
