import { MAX_PLAYBACK_SECONDS, MAX_WINDOW_SECONDS, clampQuerySeconds, formatQueryDuration, isoFromDateTimeLocal, queryRangeSummary } from "../src/lib/domain/query-range";

const startISO = isoFromDateTimeLocal("2026-05-14", "09:00");
const requested = clampQuerySeconds({
	windowSeconds   : 13 * 60 * 60,
	playbackSeconds : 20 * 60,
});
const normal = clampQuerySeconds({
	windowSeconds   : 2 * 60 * 60,
	playbackSeconds : 45,
});
const summary = queryRangeSummary({ startISO, ...normal });
const params = new URLSearchParams({
	startISO,
	windowSeconds   : String(normal.windowSeconds),
	playbackSeconds : String(normal.playbackSeconds),
	quality         : "balanced",
});

console.log("Query controls diagnostic");
console.log("limits", {
	maxWindow: formatQueryDuration(MAX_WINDOW_SECONDS),
	maxPlayback: formatQueryDuration(MAX_PLAYBACK_SECONDS),
});
console.log("clamped oversized request", requested);
console.log("granular request", {
	startISO,
	endISO: summary.endISO,
	window: summary.windowLabel,
	playback: summary.playbackLabel,
	compression: summary.compressionRatio,
});
console.log("bridge URL", `/raspberryshake/window?${params}`);
