/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { MAX_PLAYBACK_SECONDS, MAX_WINDOW_SECONDS, clampQuerySeconds, formatQueryDuration, isoFromDateTimeLocal, queryRangeSummary } from "./query-range";

describe("query range", () => {
	test("clamps request length and compressed duration to supported maximums", () => {
		expect(clampQuerySeconds({ windowSeconds: 13 * 60 * 60, playbackSeconds: 20 * 60 })).toEqual({
			windowSeconds   : MAX_WINDOW_SECONDS,
			playbackSeconds : MAX_PLAYBACK_SECONDS,
		});
	});

	test("formats source and compressed durations for the query UI", () => {
		expect(formatQueryDuration(45)).toBe("45 sec");
		expect(formatQueryDuration(5 * 60)).toBe("5 min");
		expect(formatQueryDuration(90 * 60)).toBe("1.5 hr");
	});

	test("converts local date and time controls into an ISO start timestamp", () => {
		expect(isoFromDateTimeLocal("2026-05-14", "09:30")).toBe(new Date("2026-05-14T09:30").toISOString());
	});

	test("summarises start timestamp, end timestamp, and compression ratio", () => {
		expect(queryRangeSummary({ startISO: "2026-05-14T09:00:00.000Z", windowSeconds: 2 * 60 * 60, playbackSeconds: 45 })).toEqual({
			endISO            : "2026-05-14T11:00:00.000Z",
			windowLabel       : "2 hr",
			playbackLabel     : "45 sec",
			compressionRatio  : "160x",
		});
	});
});
