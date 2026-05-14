import { applyFocus } from "$lib/domain/sonification";
import {
	audioBufferToWavBlob,
	CompressedSeismicPlayer,
	configureChain,
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
		// Run the full P0 domain chain (prepareSamples → impulse → limiter → LUFS)
		// via renderProcessedSeismicBuffer with skipWebAudio=true.
		let buffer = await renderProcessedSeismicBuffer(
			window,
			mode,
			compression,
			focus,
			true,  // skipWebAudio — run domain-only P0 chain
		);

		// For non-raw modes, apply Web Audio tone shaping (filters, saturation, compressor)
		// on top of the domain-processed samples.
		if (mode !== "raw") {
			const samples   = buffer.getChannelData(0);
			const offline   = new OfflineAudioContext(1, samples.length, window.renderedSampleRate);
			const source    = offline.createBufferSource();
			const inputBuf  = offline.createBuffer(1, samples.length, window.renderedSampleRate);
			inputBuf.getChannelData(0).set(samples);

			const highpass    = offline.createBiquadFilter();
			const lowpass     = offline.createBiquadFilter();
			const shaper      = offline.createWaveShaper();
			const webLimiter  = offline.createDynamicsCompressor();
			const gain        = offline.createGain();

			configureChain(
				{ highpass, lowpass, shaper, limiter: webLimiter, gain },
				mode,
				applyFocus(compression, focus),
			);

			source.buffer = inputBuf;
			source
				.connect(highpass)
				.connect(lowpass)
				.connect(shaper)
				.connect(webLimiter)
				.connect(gain)
				.connect(offline.destination);
			source.start();

			buffer = await offline.startRendering();
		}

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
