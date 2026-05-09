#!/usr/bin/env bun
/**
 * diagnostics/channel-mismatch
 *
 * Purpose: determine why LoadState almost always shows "fallback"
 * by comparing requestedChannel (what the UI sends) vs actualChannel
 * (what the bridge returns).
 *
 * Hypotheses under test:
 *   1. Raspberry Shake: activeChannel = "AM.RD432.00.EHZ" (NSLC) but
 *      window.channel = "EHZ" (short code) → constant mismatch
 *   2. Local bridge: activeChannel from status.channels[0] may differ
 *      from the channel the synthetic feed writes to
 *   3. Server-side bug: recorder.makeWindow returns a different channel
 *      than requested
 */

const bridgePort = Number(process.env.BRIDGE_PORT ?? 8787);
const bridgeBase = `http://127.0.0.1:${bridgePort}`;
const STATIONS   = ["RD432", "R5022", "RCA97", "R83E1", "R5156"] as const;

// ── helpers ────────────────────────────────────────────────────────

async function json<T>(url: string): Promise<T> {
	const response = await fetch(url);
	const text     = await response.text();
	if (!response.ok)
		throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
	return JSON.parse(text) as T;
}

function indent(lines: string): string {
	return lines
		.split("\n")
		.map((l) => "  " + l)
		.join("\n");
}

// ── types ──────────────────────────────────────────────────────────

type BridgeStatus = {
	mode          : string;
	channels      : string[];
	samplesStored : number;
	secondsStored : number;
};

type AudioWindow = {
	channel            : string;
	windowSeconds      : number;
	playbackSeconds    : number;
	sourceSampleRate   : number;
	renderedSampleRate : number;
	samples            : number[];
	availableSeconds   : number;
	source?            : string;
	station?           : string;
	network?           : string;
	location?          : string;
	metadata?: {
		requestedChannel?     : string;
		actualChannel?        : string;
		channelFallbackOrder? : string[];
		attemptedChannels?: Array<{ channel: string; status: string }>;
	};
};

// ── UI mirror: activeChannel derivation logic ──────────────────────

function deriveActiveChannelLocal(status: BridgeStatus): string {
	return status?.channels[0] ?? "bridge channel";
}

function deriveActiveChannelArchive(stationId: string): string {
	// mirrors +page.svelte station choice channelHint
	const hints: Record<string, string> = {
		local : "bridge channel",
		RD432 : "AM.RD432.00.EHZ",
		R5022 : "AM.R5022.00.EHZ",
		RCA97 : "AM.RCA97.00.EHZ",
		R83E1 : "AM.R83E1.00.EHZ",
		R5156 : "AM.R5156.00.EHZ",
	};
	return hints[stationId] ?? "unknown";
}

// ── main ───────────────────────────────────────────────────────────

async function main() {
	console.log("═══ Channel Mismatch Diagnostic ═══");
	console.log(`Bridge: ${bridgeBase}`);
	console.log();

	// ── 1. Bridge status ────────────────────────────────────────────

	let status: BridgeStatus;
	try {
		status = await json<BridgeStatus>(`${bridgeBase}/status`);
	} catch (error) {
		console.log(`✗ Bridge unreachable: ${error}`);
		process.exit(1);
	}

	console.log("─── Bridge Status ───");
	console.log(`  mode:           ${status.mode}`);
	console.log(`  channels:       [${status.channels.join(", ") || "(none)"}]`);
	console.log(`  samplesStored:  ${status.samplesStored.toLocaleString()}`);
	console.log(`  secondsStored:  ${status.secondsStored.toFixed(1)}`);
	console.log();

	// ── 2. Local bridge /window endpoint ───────────────────────────

	console.log("─── Local Bridge /window ───");

	const localRequests = [
		{
			windowSeconds   : 900,
			playbackSeconds : 10,
			channel         : status.channels[0] ?? undefined,
		},
		{ windowSeconds : 900, playbackSeconds : 10, channel : undefined },
		{ windowSeconds : 900, playbackSeconds : 60, channel : "SYN" },
	];

	for (const req of localRequests) {
		const params = new URLSearchParams({
			windowSeconds   : String(req.windowSeconds),
			playbackSeconds : String(req.playbackSeconds),
			quality         : "balanced",
		});
		if (req.channel) params.set("channel", req.channel);

		const url = `${bridgeBase}/window?${params}`;
		const win = await json<AudioWindow>(url);

		const activeChannelUI = deriveActiveChannelLocal(status);
		const match           = activeChannelUI === win.channel;

		console.log(
			`  Request: channel=${req.channel ?? "(none, defaults to first)"} windowSeconds=${req.windowSeconds} playbackSeconds=${req.playbackSeconds}`,
		);
		console.log(
			`  Response: channel="${win.channel}" source=${win.source ?? "?"} station=${win.station ?? "?"}`,
		);
		console.log(`  UI activeChannel="${activeChannelUI}"`);
		console.log(
			`  Match: ${match ? "✓ YES" : '✗ MISMATCH → LoadState would show "fallback"'}`,
		);
		if (win.metadata) {
			console.log(`  Metadata: ${JSON.stringify(win.metadata)}`);
		}
		console.log();
	}

	// ── 3. Raspberry Shake archive /window endpoint ─────────────────

	console.log("─── Raspberry Shake Archive /raspberryshake/window ───");

	for (const stationId of STATIONS) {
		const params = new URLSearchParams({
			station         : stationId,
			windowSeconds   : "900",
			playbackSeconds : "10",
			quality         : "installation-safe",
		});
		const url = `${bridgeBase}/raspberryshake/window?${params}`;

		try {
			const win = await json<AudioWindow>(url);

			const activeChannelUI = deriveActiveChannelArchive(stationId);
			const match           = activeChannelUI === win.channel;

			console.log(`  Station: ${stationId}`);
			console.log(`  Response channel:               "${win.channel}"`);
			console.log(
				`  Response network.station.loc:    ${win.network ?? "?"}.${win.station ?? "?"}.${win.location ?? "?"}`,
			);
			console.log(`  UI activeChannel (channelHint):  "${activeChannelUI}"`);
			console.log(
				`  Match: ${match ? "✓ YES" : '✗ MISMATCH → LoadState would show "fallback"'}`,
			);
			console.log(
				`  Reason: UI sends NSLC "${activeChannelUI}" but bridge returns short code "${win.channel}"`,
			);

			if (win.metadata) {
				console.log(`  Server metadata:`);
				console.log(indent(JSON.stringify(win.metadata, null, 2)));
			}
		} catch (error) {
			console.log(`  Station: ${stationId}`);
			console.log(`  ✗ Error: ${error}`);
		}
		console.log();
	}

	// ── 4. Summary ──────────────────────────────────────────────────

	console.log("─── Root Cause Analysis ───");
	console.log();
	console.log(
		"  The activeChannel derivation in +page.svelte uses the station's",
	);
	console.log(
		'  channelHint, which is a full NSLC string like "AM.RD432.00.EHZ".',
	);
	console.log();
	console.log(
		"  The server returns window.channel from the actual seismogram,",
	);
	console.log('  which is a short channel code like "EHZ".');
	console.log();
	console.log(
		"  Result: requestedChannel !== actualChannel on every archive load,",
	);
	console.log('  so transitionLoadState always sets state = "fallback".');
	console.log();
	console.log("  Possible fixes (choose one):");
	console.log("  1. Change activeChannel derivation to extract the short code");
	console.log('     from the NSLC (split on "." and take the last segment)');
	console.log(
		"  2. Change the server to return the full NSLC for archive loads",
	);
	console.log("  3. Change the comparison in transitionLoadState to use a");
	console.log("     case-insensitive endsWith() instead of strict equality");
	console.log(
		"  4. Remove the fallback distinction entirely if it adds no value",
	);
	console.log();
}

main().catch((error) => {
	console.error("Diagnostic failed:", error);
	process.exit(1);
});
