import { buildAudioSettingsSnapshot, buildWindowId, fingerprintAudioSettings, measureAudioSamples } from '$lib/domain/audio-state';
import type { AudioWindowSource } from '$lib/ports/audio';
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
