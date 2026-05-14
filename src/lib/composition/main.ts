import { createBrowserAudioPlayer, browserAudioRenderer, browserFileDownloader } from '$lib/adapters/browser-audio';
import { loadAudioWindow, makeExportName, makeExportMetadata, playAudioWindow, playPreparedAudioWindow, exportAudioWindow, selectProvider, compareAudioSettings, advanceLoadState, getStationNSLC } from '$lib/application/seismic-audio-session';
import { isAppError } from '$lib/core/errors';
import { buildAudioSettingsSnapshot, buildRequestKey, fingerprintAudioSettings, isStale } from '$lib/domain/audio-state';
import { prepareSamplesChunked } from '$lib/application/chunked-preparation';
import { bridgeAudioWindowSource } from '$lib/adapters/bridge-client';
import { raspberryShakeStations } from '$lib/adapters/raspberry-shake-station-catalog';
import { searchStations, toStationChoice } from '$lib/domain/station-catalog';
import type { AudioPlayer, AudioRenderer, AudioWindowSource, FileDownloader } from '$lib/ports/audio';
import type { AudioWindow, CompressionSettings, ListeningFocus, RenderQuality, SoundMode } from '$lib/types';
import { type LoadStateSnapshot, initialLoadState } from '$lib/domain/load-state';
import { type ProviderId } from '$lib/domain/provider-id';
import type { StationId } from '$lib/domain/station';

// ── wired adapters (singleton scope) ──

const audioWindowSource: AudioWindowSource = bridgeAudioWindowSource;
const audioPlayer: AudioPlayer = createBrowserAudioPlayer();
const audioRenderer: AudioRenderer = browserAudioRenderer;
const fileDownloader: FileDownloader = browserFileDownloader;

audioPlayer.setLevelCallback(() => {});
// caller patches setLevelCallback() on the returned player after obtaining it

// ── use cases ──

export { isAppError, buildAudioSettingsSnapshot, buildRequestKey, fingerprintAudioSettings, isStale, makeExportName, makeExportMetadata, selectProvider, compareAudioSettings, advanceLoadState, getStationNSLC, prepareSamplesChunked, raspberryShakeStations, searchStations, toStationChoice };
export type { ExportNameInput, ExportMetadataInput, ProviderInfo, SettingsComparison } from '$lib/application/seismic-audio-session';
export const getAudioPlayer = () => audioPlayer;
export const getBridgeStatus = () => audioWindowSource.getStatus();
export const connectBridgeStatus = (
	onStatus: Parameters<AudioWindowSource['connectStatus']>[0],
	onState?: Parameters<AudioWindowSource['connectStatus']>[1]
) => audioWindowSource.connectStatus(onStatus, onState);

export async function loadWindow(requestKey: string, request: Parameters<AudioWindowSource['getAudioWindow']>[0], settings: {
	soundMode: SoundMode;
	listeningFocus: ListeningFocus;
	compression: CompressionSettings;
	renderQuality: RenderQuality;
	playbackSeconds: number;
}) {
	return loadAudioWindow({ source: audioWindowSource, requestKey, request, settings });
}

export async function play(window: AudioWindow, soundMode: SoundMode, compression: CompressionSettings, listeningFocus: ListeningFocus) {
	return playAudioWindow({ player: audioPlayer, window, soundMode, compression, listeningFocus });
}

/** Play with pre-prepared samples (caller ran prepareSamplesChunked first). */
export async function playPrepared(samples: Float32Array, renderedSampleRate: number, soundMode: SoundMode, compression: CompressionSettings, listeningFocus: ListeningFocus): Promise<void> {
	await playPreparedAudioWindow({ player: audioPlayer, samples, renderedSampleRate, soundMode, compression, listeningFocus });
}

export async function exportWav(opts: {
	window: AudioWindow;
	soundMode: SoundMode;
	compression: CompressionSettings;
	listeningFocus: ListeningFocus;
	wavFilename: string;
	metadataFilename: string;
	metadata: unknown;
}) {
	return exportAudioWindow({
		renderer: audioRenderer,
		downloader: fileDownloader,
		...opts
	});
}
