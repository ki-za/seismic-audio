import { buildAudioSettingsSnapshot, buildWindowId, fingerprintAudioSettings, measureAudioSamples } from '$lib/domain/audio-state';
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
