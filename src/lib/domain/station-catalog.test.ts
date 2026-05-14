/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { searchStations, toStationChoice } from "./station-catalog";
import type { StationCatalogEntry } from "./station-catalog";

const entries: StationCatalogEntry[] = [
	{ code: "R0066", name: "R0066", place: "California, United States", network: "AM", knownChannels: ["EHZ", "HDF"] },
	{ code: "R0074", name: "R0074", place: "Jamaica", network: "AM", knownChannels: ["EHE", "EHN", "EHZ"] },
	{ code: "RD432", name: "RD432", place: "Wales, United Kingdom", network: "AM", knownChannels: [] },
];

describe("station catalog", () => {
	test("searches stations by station code", () => {
		expect(searchStations(entries, "rd4").map((station) => station.code)).toEqual(["RD432"]);
	});

	test("searches stations by place", () => {
		expect(searchStations(entries, "california").map((station) => station.code)).toEqual(["R0066"]);
	});

	test("limits empty search to favourites first", () => {
		expect(searchStations(entries, "", ["R0074"], 2).map((station) => station.code)).toEqual(["R0074", "R0066"]);
	});

	test("maps a station catalog entry to an archive station choice", () => {
		expect(toStationChoice(entries[0])).toEqual({
			id: "R0066",
			name: "R0066",
			place: "California, United States",
			channelHint: "AM.R0066.00.EHZ",
			status: "archive",
		});
	});
});
