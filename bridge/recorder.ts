import type {
	AudioWindow,
	BridgeStatus,
	RenderQuality,
} from "../src/lib/types";

import type { PolyphaseOptions } from "../src/lib/domain/types";
import { resamplePolyphase, polyphaseOptionsForQuality } from "../src/lib/domain/resampling";

type ChannelBuffer = {
	samples           : number[];
	latestTimestampMs : number | null;
};

export class RollingRecorder {
	readonly startedAtMs = Date.now();
	readonly sourceSampleRate : number;
	readonly maxSamples       : number;
	readonly channels = new Map<string, ChannelBuffer>();

	constructor(options: { sourceSampleRate?: number; maxHours?: number } = {}) {
		this.sourceSampleRate = options.sourceSampleRate ?? 100;
		this.maxSamples = Math.floor(
			(options.maxHours ?? 24) * 60 * 60 * this.sourceSampleRate,
		);
	}

	ingest(channel: string, timestampMs: number, samples: number[]) {
		const buffer = this.channels.get(channel) ?? {
			samples           : [],
			latestTimestampMs : null,
		};
		buffer.samples.push(...samples);
		if (buffer.samples.length > this.maxSamples) {
			buffer.samples.splice(0, buffer.samples.length - this.maxSamples);
		}
		buffer.latestTimestampMs = timestampMs;
		this.channels.set(channel, buffer);
	}

	status(mode: "synthetic" | "udp", udpPort: number): BridgeStatus {
		let samplesStored = 0;
		let latestTimestampMs: number | null = null;
		for (const buffer of this.channels.values()) {
			samplesStored = Math.max(samplesStored, buffer.samples.length);
			latestTimestampMs = Math.max(
				latestTimestampMs ?? 0,
				buffer.latestTimestampMs ?? 0,
			);
		}

		return {
			mode,
			udpPort,
			channels: [...this.channels.keys()],
			samplesStored,
			secondsStored: samplesStored / this.sourceSampleRate,
			latestTimestampMs,
			startedAtMs: this.startedAtMs,
		};
	}

	makeWindow(options: {
		channel?        : string;
		windowSeconds   : number;
		playbackSeconds : number;
		quality?        : RenderQuality;
		startISO?       : string;
	}): AudioWindow {
		const channel =
			options.channel ?? this.channels.keys().next().value ?? "SYN";
		const buffer        = this.channels.get(channel);
		const samplesNeeded = Math.floor(
			options.windowSeconds * this.sourceSampleRate,
		);
		const source = buffer?.samples ?? [];
		const selected = options.startISO && buffer?.latestTimestampMs
			? this.selectRange(source, buffer.latestTimestampMs, options.startISO, samplesNeeded)
			: source.slice(Math.max(0, source.length - samplesNeeded));
		const renderedSampleRate = chooseRenderedSampleRate(
			options.playbackSeconds,
			options.quality ?? "balanced",
		);
		const outputCount = Math.max(
			1,
			Math.floor(options.playbackSeconds * renderedSampleRate),
		);
		const compressed = resamplePolyphase(
			selected,
			outputCount,
			polyphaseOptionsForQuality(options.quality === "installation-safe" ? "preview" : "export"),
		);

		const startMs = options.startISO ? new Date(options.startISO).getTime() : undefined;
		return {
			channel,
			windowSeconds    : options.windowSeconds,
			playbackSeconds  : options.playbackSeconds,
			sourceSampleRate : this.sourceSampleRate,
			renderedSampleRate,
			samples          : compressed,
			availableSeconds : source.length / this.sourceSampleRate,
			startISO         : startMs ? new Date(startMs).toISOString() : undefined,
			endISO           : startMs ? new Date(startMs + options.windowSeconds * 1000).toISOString() : undefined,
			source           : "bridge",
			metadata: {
				loadedAtISO      : new Date().toISOString(),
				actualChannel    : channel,
				requestedChannel : options.channel ?? channel,
			},
			metrics: measureSamples(compressed as unknown as number[], renderedSampleRate),
		};
	}

	private selectRange(
		source            : number[],
		latestTimestampMs : number,
		startISO          : string,
		samplesNeeded     : number,
	) {
		const startMs       = new Date(startISO).getTime();
		const earliestMs    = latestTimestampMs - ((source.length - 1) / this.sourceSampleRate) * 1000;
		const startIndex    = Math.max(0, Math.floor((startMs - earliestMs) / 1000 * this.sourceSampleRate));
		const boundedStart  = Math.min(source.length, startIndex);
		const boundedEnd    = Math.min(source.length, boundedStart + samplesNeeded);
		return source.slice(boundedStart, boundedEnd);
	}
}

export function chooseRenderedSampleRate(
	playbackSeconds : number,
	quality         : RenderQuality,
): number {
	if (quality === "studio") return 48_000;
	if (quality === "installation-safe")
		return playbackSeconds >= 300 ? 12_000 : 32_000;
	return playbackSeconds >= 300 ? 16_000 : 48_000;
}

function measureSamples(samples: ArrayLike<number>, sampleRate: number) {
	let sum     = 0;
	let squares = 0;
	let peak    = 0;
	for (let i = 0; i < samples.length; i += 1) {
		const value = samples[i];
		sum += value;
		squares += value * value;
		peak = Math.max(peak, Math.abs(value));
	}
	return {
		sampleCount: samples.length,
		sampleRate,
		durationSeconds : sampleRate ? samples.length / sampleRate             : 0,
		rms             : samples.length ? Math.sqrt(squares / samples.length) : 0,
		peak,
		mean: samples.length ? sum / samples.length : 0,
	};
}

export function resample(
	input       : ArrayLike<number>,
	outputCount : number,
): number[] {
	if (input.length === 0) return new Array(outputCount).fill(0);
	if (input.length === 1) return new Array(outputCount).fill(input[0]);

	const output = new Array<number>(outputCount);
	const scale  = (input.length - 1) / Math.max(1, outputCount - 1);
	for (let i = 0; i < outputCount; i += 1) {
		const pos  = i * scale;
		const lo   = Math.floor(pos);
		const hi   = Math.min(input.length - 1, lo + 1);
		const frac = pos - lo;
		output[i] = input[lo] * (1 - frac) + input[hi] * frac;
	}
	return output;
}
