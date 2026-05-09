import { audioBufferToWavBlob, CompressedSeismicPlayer, renderProcessedSeismicBuffer } from '$lib/audio/sonifier';
import type { AudioPlayer, AudioRenderer, FileDownloader } from '$lib/ports/audio';

export function createBrowserAudioPlayer(): AudioPlayer {
	return new CompressedSeismicPlayer();
}

export const browserAudioRenderer: AudioRenderer = {
	renderProcessedSeismicBuffer,
	audioBufferToWavBlob
};

export const browserFileDownloader: FileDownloader = {
	downloadBlob(blob, filename) {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}
};
