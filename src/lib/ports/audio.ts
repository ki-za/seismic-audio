import type { AudioWindow, BridgeStatus, CompressionSettings, ListeningFocus, RenderQuality, SoundMode } from '$lib/types';

export type AudioWindowRequest = {
	channel?: string;
	station?: string;
	source?: 'bridge' | 'raspberryshake';
	windowSeconds: number;
	playbackSeconds: number;
	quality?: RenderQuality;
};

export type AudioWindowSource = {
	getStatus(): Promise<BridgeStatus>;
	getAudioWindow(request: AudioWindowRequest): Promise<AudioWindow>;
	connectStatus(onStatus: (status: BridgeStatus) => void, onState?: (state: string) => void): () => void;
};

export type AudioPlayer = {
	setLevelCallback(callback: (level: number) => void): void;
	play(window: AudioWindow, mode: SoundMode, compression: CompressionSettings, focus: ListeningFocus): Promise<void>;
	stop(): void;
};

export type AudioRenderer = {
	renderProcessedSeismicBuffer(window: AudioWindow, mode: SoundMode, compression: CompressionSettings, focus: ListeningFocus): Promise<AudioBuffer>;
	audioBufferToWavBlob(buffer: AudioBuffer): Blob;
};

export type FileDownloader = {
	downloadBlob(blob: Blob, filename: string): void;
};
