import type { AudioWindow, CompressionSettings, ListeningFocus, SoundMode } from '$lib/types';

export class CompressedSeismicPlayer {
	private context: AudioContext | null = null;
	private active: AudioBufferSourceNode | null = null;
	private meterTimer: number | null = null;
	private onLevel: (level: number) => void = () => {};

	setLevelCallback(callback: (level: number) => void) {
		this.onLevel = callback;
	}

	async start() {
		this.context ??= new AudioContext();
		if (this.context.state !== 'running') await this.context.resume();
	}

	stop() {
		this.active?.stop();
		this.active = null;
		this.stopMeter();
	}

	async play(window: AudioWindow, mode: SoundMode, compression: CompressionSettings = defaultCompression, focus: ListeningFocus = 'gentle') {
		await this.start();
		const context = this.context;
		if (!context) return;

		this.stop();
		const samples = prepareSamples(window.samples, mode);
		const buffer = context.createBuffer(1, samples.length, window.renderedSampleRate);
		buffer.getChannelData(0).set(samples);

		const source = context.createBufferSource();
		const highpass = context.createBiquadFilter();
		const lowpass = context.createBiquadFilter();
		const shaper = context.createWaveShaper();
		const limiter = context.createDynamicsCompressor();
		const gain = context.createGain();
		const analyser = context.createAnalyser();

		configureChain({ highpass, lowpass, shaper, limiter, gain }, mode, applyFocus(compression, focus));
		analyser.fftSize = 1024;

		source.buffer = buffer;
		source.loop = true;
		source.connect(highpass).connect(lowpass).connect(shaper).connect(limiter).connect(gain).connect(analyser).connect(context.destination);
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
	thresholdDb: -12,
	ratio: 16,
	attackMs: 3,
	releaseMs: 180,
	makeupDb: 0
};

export async function renderProcessedSeismicBuffer(
	window: AudioWindow,
	mode: SoundMode,
	compression: CompressionSettings,
	focus: ListeningFocus = 'gentle'
): Promise<AudioBuffer> {
	const samples = prepareSamples(window.samples, mode);
	const offline = new OfflineAudioContext(1, samples.length, window.renderedSampleRate);
	const source = offline.createBufferSource();
	const input = offline.createBuffer(1, samples.length, window.renderedSampleRate);
	const highpass = offline.createBiquadFilter();
	const lowpass = offline.createBiquadFilter();
	const shaper = offline.createWaveShaper();
	const limiter = offline.createDynamicsCompressor();
	const gain = offline.createGain();

	input.getChannelData(0).set(samples);
	configureChain({ highpass, lowpass, shaper, limiter, gain }, mode, applyFocus(compression, focus));

	source.buffer = input;
	source.connect(highpass).connect(lowpass).connect(shaper).connect(limiter).connect(gain).connect(offline.destination);
	source.start();

	return offline.startRendering();
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
	const channels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const frames = buffer.length;
	const bytesPerSample = 2;
	const blockAlign = channels * bytesPerSample;
	const dataSize = frames * blockAlign;
	const arrayBuffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(arrayBuffer);
	let offset = 0;

	writeString(view, offset, 'RIFF');
	offset += 4;
	view.setUint32(offset, 36 + dataSize, true);
	offset += 4;
	writeString(view, offset, 'WAVE');
	offset += 4;
	writeString(view, offset, 'fmt ');
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
	writeString(view, offset, 'data');
	offset += 4;
	view.setUint32(offset, dataSize, true);
	offset += 4;

	const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
	for (let frame = 0; frame < frames; frame += 1) {
		for (let channel = 0; channel < channels; channel += 1) {
			const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
			view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			offset += 2;
		}
	}

	return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function prepareSamples(input: number[], mode: SoundMode): Float32Array {
	const output = new Float32Array(input.length);
	if (input.length === 0) return output;

	let sum = 0;
	for (let i = 0; i < input.length; i += 1) sum += input[i];
	const mean = sum / input.length;
	const robustPeak = estimateRobustPeak(input, mean);
	const gain = (mode === 'raw' ? 0.7 : 0.9) / robustPeak;
	const fadeSamples = Math.min(Math.floor(input.length * 0.03), 48_000);

	for (let i = 0; i < input.length; i += 1) {
		const fadeIn = fadeSamples > 0 ? Math.min(1, i / fadeSamples) : 1;
		const fadeOut = fadeSamples > 0 ? Math.min(1, (input.length - i - 1) / fadeSamples) : 1;
		output[i] = Math.max(-1, Math.min(1, (input[i] - mean) * gain)) * Math.min(fadeIn, fadeOut);
	}

	return output;
}

function estimateRobustPeak(input: number[], mean: number): number {
	const maxSamples = 100_000;
	const stride = Math.max(1, Math.floor(input.length / maxSamples));
	const values = new Array<number>(Math.ceil(input.length / stride));
	let count = 0;
	for (let i = 0; i < input.length; i += stride) {
		values[count] = Math.abs(input[i] - mean);
		count += 1;
	}
	values.length = count;
	values.sort((a, b) => a - b);
	return values[Math.floor(values.length * 0.98)] || 1;
}

function configureChain(
	nodes: {
		highpass: BiquadFilterNode;
		lowpass: BiquadFilterNode;
		shaper: WaveShaperNode;
		limiter: DynamicsCompressorNode;
		gain: GainNode;
	},
	mode: SoundMode,
	compression: CompressionSettings
) {
	nodes.highpass.type = 'highpass';
	nodes.highpass.frequency.value = mode === 'raw' ? 8 : 24;
	nodes.lowpass.type = 'lowpass';
	nodes.lowpass.frequency.value = mode === 'soft' ? 4200 : mode === 'clear' ? 8000 : mode === 'deep' ? 2600 : mode === 'bright' ? 14000 : 12000;
	nodes.shaper.curve = makeSaturationCurve(mode === 'soft' ? 1.4 : mode === 'clear' ? 2.2 : mode === 'deep' ? 1.8 : mode === 'bright' ? 2.6 : 1.1);
	nodes.limiter.threshold.value = compression.thresholdDb;
	nodes.limiter.knee.value = 12;
	nodes.limiter.ratio.value = compression.ratio;
	nodes.limiter.attack.value = compression.attackMs / 1000;
	nodes.limiter.release.value = compression.releaseMs / 1000;
	nodes.gain.gain.value = dbToGain(compression.makeupDb) * (mode === 'soft' ? 0.32 : mode === 'clear' ? 0.42 : mode === 'deep' ? 0.38 : mode === 'bright' ? 0.36 : 0.35);
}

function applyFocus(compression: CompressionSettings, focus: ListeningFocus): CompressionSettings {
	if (focus === 'event') return { ...compression, thresholdDb: Math.min(compression.thresholdDb + 4, -4), ratio: Math.max(2, compression.ratio * 0.75) };
	if (focus === 'texture') return { ...compression, thresholdDb: compression.thresholdDb - 6, ratio: compression.ratio + 2, makeupDb: compression.makeupDb + 2 };
	if (focus === 'scientific') return { ...compression, thresholdDb: -6, ratio: 2, makeupDb: 0 };
	return compression;
}

function measureRms(samples: Float32Array) {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

function dbToGain(db: number) {
	return 10 ** (db / 20);
}

function makeSaturationCurve(amount: number) {
	const samples = 2048;
	const curve = new Float32Array(samples);
	for (let i = 0; i < samples; i += 1) {
		const x = (i * 2) / samples - 1;
		curve[i] = Math.tanh(x * amount);
	}
	return curve;
}

function writeString(view: DataView, offset: number, value: string) {
	for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}
