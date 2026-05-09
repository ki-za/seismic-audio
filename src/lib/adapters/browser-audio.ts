import {
	audioBufferToWavBlob,
	CompressedSeismicPlayer,
	renderProcessedSeismicBuffer,
} from "$lib/audio/sonifier";
import type {
	AudioPlayer,
	AudioRenderer,
	FileDownloader,
} from "$lib/ports/audio";

export function createBrowserAudioPlayer(): AudioPlayer {
	return new CompressedSeismicPlayer();
}

export const browserAudioRenderer: AudioRenderer = {
	async renderWavFile(window, mode, compression, focus, filename) {
		const buffer = await renderProcessedSeismicBuffer(
			window,
			mode,
			compression,
			focus,
		);
		const blob = audioBufferToWavBlob(buffer);
		return {
			filename,
			content     : await blob.arrayBuffer(),
			contentType : blob.type,
		};
	},
};

export const browserFileDownloader: FileDownloader = {
	downloadFile(file) {
		const blob = new Blob([file.content], { type: file.contentType });
		const url    = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href     = url;
		anchor.download = file.filename;
		anchor.click();
		URL.revokeObjectURL(url);
	},
};
