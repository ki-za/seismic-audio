import type {
	AudioWindow,
	CompressionSettings,
	ListeningFocus,
	SoundMode,
} from "$lib/types";
import {
	applyFocus,
	makeSaturationCurve,
	measureRms,
	prepareSamples,
	dbToGain,
} from "$lib/domain/sonification";

export class CompressedSeismicPlayer {
	private context    : AudioContext | null          = null;
	private active     : AudioBufferSourceNode | null = null;
	private meterTimer : number | null                = null;
	onLevel: (level: number) => void = () => {};

	setLevelCallback(callback: (level: number) => void) {
		this.onLevel = callback;
	}

	async start() {
		this.context ??= new AudioContext();
		if (this.context.state !== "running") await this.context.resume();
	}

	stop() {
		this.active?.stop();
		this.active = null;
		this.stopMeter();
	}

	/**
	 * Play with pre-prepared Float32Array samples (caller already ran DSP).
	 * This is the fast path — no synchronous prepareSamples here.
	 */
	async playPrepared(
		samples            : Float32Array,
		renderedSampleRate : number,
		mode               : SoundMode,
		compression        : CompressionSettings,
		focus              : ListeningFocus,
	) {
		await this.start();
		const context = this.context!;

		this.stop();
		const buffer = context.createBuffer(1, samples.length, renderedSampleRate);
		buffer.getChannelData(0).set(samples);

		const source   = context.createBufferSource();
		const highpass = context.createBiquadFilter();
		const lowpass  = context.createBiquadFilter();
		const shaper   = context.createWaveShaper();
		const limiter  = context.createDynamicsCompressor();
		const gain     = context.createGain();
		const analyser = context.createAnalyser();

		configureChain(
			{ highpass, lowpass, shaper, limiter, gain },
			mode,
			applyFocus(compression, focus),
		);
		analyser.fftSize = 1024;

		source.buffer = buffer;
		source.loop   = true;
		source
			.connect(highpass)
			.connect(lowpass)
			.connect(shaper)
			.connect(limiter)
			.connect(gain)
			.connect(analyser)
			.connect(context.destination);
		source.start();
		this.active = source;
		this.onLevel(measureRms(samples));
		this.startMeter(analyser);
		source.onended = () => {
			if (this.active === source) {
				this.active = null;
				this.stopMeter();
			}
		};
	}

	/** Legacy path — does prepareSamples internally. Kept for backward compat. */
	async play(
		window : AudioWindow,
		mode   : SoundMode,
		compression : CompressionSettings = defaultCompression,
		focus       : ListeningFocus      = "gentle",
	) {
		await this.start();
		this.playPrepared(
			prepareSamples(window.samples, mode),
			window.renderedSampleRate,
			mode,
			compression,
			focus,
		);
	}

	private startMeter(analyser: AnalyserNode) {
		const values = new Float32Array(analyser.fftSize);
		this.meterTimer = window.setInterval(() => {
			analyser.getFloatTimeDomainData(values);
			let sum = 0;
			for (const value of values) sum += value * value;
			this.onLevel(Math.min(1, Math.sqrt(sum / values.length) * 4));
		}, 80);
	}

	private stopMeter() {
		if (this.meterTimer !== null) window.clearInterval(this.meterTimer);
		this.meterTimer = null;
		this.onLevel(0);
	}
}

const defaultCompression: CompressionSettings = {
	thresholdDb : -12,
	ratio       : 16,
	attackMs    : 3,
	releaseMs   : 180,
	makeupDb    : 0,
};

export async function renderProcessedSeismicBuffer(
	window      : AudioWindow,
	mode        : SoundMode,
	compression : CompressionSettings,
	focus: ListeningFocus = "gentle",
): Promise<AudioBuffer> {
	const samples = prepareSamples(window.samples, mode);
	const offline = new OfflineAudioContext(
		1,
		samples.length,
		window.renderedSampleRate,
	);
	const source = offline.createBufferSource();
	const input  = offline.createBuffer(
		1,
		samples.length,
		window.renderedSampleRate,
	);
	const highpass = offline.createBiquadFilter();
	const lowpass  = offline.createBiquadFilter();
	const shaper   = offline.createWaveShaper();
	const limiter  = offline.createDynamicsCompressor();
	const gain     = offline.createGain();

	input.getChannelData(0).set(samples);
	configureChain(
		{ highpass, lowpass, shaper, limiter, gain },
		mode,
		applyFocus(compression, focus),
	);

	source.buffer = input;
	source
		.connect(highpass)
		.connect(lowpass)
		.connect(shaper)
		.connect(limiter)
		.connect(gain)
		.connect(offline.destination);
	source.start();

	return offline.startRendering();
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
	const channels       = buffer.numberOfChannels;
	const sampleRate     = buffer.sampleRate;
	const frames         = buffer.length;
	const bytesPerSample = 2;
	const blockAlign     = channels * bytesPerSample;
	const dataSize       = frames * blockAlign;
	const arrayBuffer    = new ArrayBuffer(44 + dataSize);
	const view           = new DataView(arrayBuffer);
	let offset           = 0;

	writeString(view, offset, "RIFF");
	offset += 4;
	view.setUint32(offset, 36 + dataSize, true);
	offset += 4;
	writeString(view, offset, "WAVE");
	offset += 4;
	writeString(view, offset, "fmt ");
	offset += 4;
	view.setUint32(offset, 16, true);
	offset += 4;
	view.setUint16(offset, 1, true);
	offset += 2;
	view.setUint16(offset, channels, true);
	offset += 2;
	view.setUint32(offset, sampleRate, true);
	offset += 4;
	view.setUint32(offset, sampleRate * blockAlign, true);
	offset += 4;
	view.setUint16(offset, blockAlign, true);
	offset += 2;
	view.setUint16(offset, bytesPerSample * 8, true);
	offset += 2;
	writeString(view, offset, "data");
	offset += 4;
	view.setUint32(offset, dataSize, true);
	offset += 4;

	const channelData = Array.from({ length: channels }, (_, channel) =>
		buffer.getChannelData(channel),
	);
	for (let frame = 0; frame < frames; frame += 1) {
		for (let channel = 0; channel < channels; channel += 1) {
			const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
			view.setInt16(
				offset,
				sample < 0 ? sample * 0x8000 : sample * 0x7fff,
				true,
			);
			offset += 2;
		}
	}

	return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ── Web Audio adapter helpers (depend on browser API) ──

function configureChain(
	nodes: {
		highpass : BiquadFilterNode;
		lowpass  : BiquadFilterNode;
		shaper   : WaveShaperNode;
		limiter  : DynamicsCompressorNode;
		gain     : GainNode;
	},
	mode        : SoundMode,
	compression : CompressionSettings,
) {
	nodes.highpass.type = "highpass";
	nodes.highpass.frequency.value = mode === "raw" ? 8 : 24;
	nodes.lowpass.type = "lowpass";
	nodes.lowpass.frequency.value =
		mode === "soft"
			? 4200
			: mode === "clear"
				? 8000
				: mode === "deep"
					? 2600
					: mode === "bright"
						? 14000
						: 12000;
	nodes.shaper.curve = makeSaturationCurve(
		mode === "soft"
			? 1.4
			: mode === "clear"
				? 2.2
				: mode === "deep"
					? 1.8
					: mode === "bright"
						? 2.6
						: 1.1,
	) as Float32Array<ArrayBuffer>;
	nodes.limiter.threshold.value = compression.thresholdDb;
	nodes.limiter.knee.value      = 12;
	nodes.limiter.ratio.value     = compression.ratio;
	nodes.limiter.attack.value    = compression.attackMs / 1000;
	nodes.limiter.release.value   = compression.releaseMs / 1000;
	nodes.gain.gain.value =
		dbToGain(compression.makeupDb) *
		(mode === "soft"
			? 0.32
			: mode === "clear"
				? 0.42
				: mode === "deep"
					? 0.38
					: mode === "bright"
						? 0.36
						: 0.35);
}

function writeString(view: DataView, offset: number, value: string) {
	for (let i = 0; i < value.length; i += 1)
		view.setUint8(offset + i, value.charCodeAt(i));
}
