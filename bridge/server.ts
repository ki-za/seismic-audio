import dgram from "node:dgram";
import { parseDatacastPacket } from "./datacast";
import {
	chooseRenderedSampleRate,
	resample,
	RollingRecorder,
} from "./recorder";
import { loadRaspberryShakeTrace } from "./raspberryshake";
import { startSyntheticFeed } from "./synthetic";
import { createStaticAppResponder } from "./static-app";
import { MAX_PLAYBACK_SECONDS, MAX_WINDOW_SECONDS } from "../src/lib/domain/query-range";

const udpPort       = Number.parseInt(Bun.env.UDP_PORT ?? "8888", 10);
const httpPort      = Number.parseInt(Bun.env.BRIDGE_PORT ?? "8787", 10);
const mode          = (Bun.env.INPUT_MODE ?? "synthetic") as "synthetic" | "udp";
const staticAppDir  = Bun.env.PACKAGED_APP_DIR;
const staticApp     = staticAppDir ? createStaticAppResponder(staticAppDir) : undefined;
const recorder      = new RollingRecorder({ sourceSampleRate: 100, maxHours: 72 });

if (mode === "synthetic") {
	startSyntheticFeed(recorder);
	console.log("synthetic feed started");
} else {
	const udp = dgram.createSocket("udp4");
	udp.on("message", (data) => {
		try {
			const packet = parseDatacastPacket(data);
			recorder.ingest(packet.channel, packet.timestampMs, packet.samples);
		} catch (error) {
			console.warn("bad DATACAST packet", error);
		}
	});
	udp.bind(udpPort, "0.0.0.0", () =>
		console.log(`listening for DATACAST UDP on ${udpPort}`),
	);
}

const cors = { "Access-Control-Allow-Origin": "*" };

const server = Bun.serve({
	port: httpPort,

	async fetch(request, server) {
		if (server.upgrade(request)) return;

		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ ok: true, mode, udpPort, httpPort }, { headers: cors });
		}

		if (url.pathname === "/status") {
			return Response.json(recorder.status(mode, udpPort), { headers: cors });
		}

		if (url.pathname === "/window") {
			const windowSeconds = parseBoundedSeconds(url.searchParams.get("windowSeconds"), 3600, MAX_WINDOW_SECONDS);
			const playbackSeconds = parseBoundedSeconds(url.searchParams.get("playbackSeconds"), 60, MAX_PLAYBACK_SECONDS);
			const channel = url.searchParams.get("channel") ?? undefined;
			const startISO = url.searchParams.get("startISO") ?? undefined;
			const quality = parseQuality(url.searchParams.get("quality"));
			return Response.json(
				recorder.makeWindow({ channel, windowSeconds, playbackSeconds, quality, startISO }),
				{ headers: cors },
			);
		}

		if (url.pathname === "/raspberryshake/window") {
			return handleRaspberryShakeWindow(url);
		}

		const staticResponse = staticApp ? await staticApp(url) : undefined;
		if (staticResponse) return staticResponse;

		return new Response("not found", { status: 404, headers: cors });
	},

	websocket: {
		open(ws)  { ws.subscribe("status"); },
		close(ws) { ws.unsubscribe("status"); },
	},
});

setInterval(() => {
	const message = JSON.stringify(recorder.status(mode, udpPort));
	server.publish("status", message);
}, 1000);

console.log(`seismic bridge listening on http://localhost:${httpPort}`);
if (staticAppDir) console.log(`serving packaged app from ${staticAppDir}`);

async function handleRaspberryShakeWindow(url: URL) {
	try {
		const station       = url.searchParams.get("station") ?? "RD432";
		const windowSeconds = parseBoundedSeconds(url.searchParams.get("windowSeconds"), 3600, MAX_WINDOW_SECONDS);
		const playbackSeconds = parseBoundedSeconds(url.searchParams.get("playbackSeconds"), 60, MAX_PLAYBACK_SECONDS);
		const startISO           = url.searchParams.get("startISO") ?? undefined;
		const quality            = parseQuality(url.searchParams.get("quality"));
		const trace              = await loadRaspberryShakeTrace({ station, windowSeconds, startISO });
		const renderedSampleRate = chooseRenderedSampleRate(
			playbackSeconds,
			quality,
		);
		const outputCount = Math.max(
			1,
			Math.floor(playbackSeconds * renderedSampleRate),
		);

		const samples = resample(trace.samples, outputCount);
		return Response.json({
			channel: trace.channel,
			windowSeconds,
			playbackSeconds,
			sourceSampleRate: trace.sampleRate,
			renderedSampleRate,
			samples,
			availableSeconds : trace.samples.length / trace.sampleRate,
			network          : trace.network,
			station          : trace.station,
			location         : trace.location,
			startISO         : trace.startISO,
			endISO           : trace.endISO,
			source           : "raspberryshake",
			metadata         : trace.metadata,
			metrics          : measureSamples(samples, renderedSampleRate),
		}, { headers: cors });
	} catch (error) {
		return Response.json({
			error: error instanceof Error ? error.message : String(error),
		}, { status: 502, headers: cors });
	}
}

function parseBoundedSeconds(value: string | null, fallback: number, max: number) {
	const parsed = Number.parseFloat(value ?? String(fallback));
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(1, parsed));
}

function parseQuality(value: string | null) {
	if (
		value === "studio" ||
		value === "balanced" ||
		value === "installation-safe"
	)
		return value;
	return "balanced";
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
