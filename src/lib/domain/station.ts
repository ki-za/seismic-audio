// ── Domain: StationId + NSLC ──
// Pure value objects. No I/O, no framework dependencies.

import type { ProviderId } from "$lib/domain/provider-id";

export type StationId = string;

export type NSLC = {
	network  : string;
	station  : string;
	location : string;
	channel  : string;
};

/**
 * Build the standard SEED channel hint: "NET.STA.LOC.CHAN"
 */
export function nslcToChannelHint(nslc: NSLC): string {
	return `${nslc.network}.${nslc.station}.${nslc.location}.${nslc.channel}`;
}

/**
 * Parse a channel hint string like "AM.RD432.00.EHZ" into NSLC.
 * Returns null if the string doesn't match the expected 4-part format.
 */
export function parseChannelHint(hint: string): NSLC | null {
	const parts = hint.split(".");
	if (parts.length !== 4) return null;
	return {
		network  : parts[0],
		station  : parts[1],
		location : parts[2],
		channel  : parts[3],
	};
}

/**
 * Known Raspberry Shake stations with their default NSLC.
 */
export const RASPBERRY_SHAKE_NSLC: Record<string, NSLC> = {
	RD432 : { network : "AM", station : "RD432", location : "00", channel : "EHZ" },
	R5022 : { network : "AM", station : "R5022", location : "00", channel : "EHZ" },
	RCA97 : { network : "AM", station : "RCA97", location : "00", channel : "EHZ" },
	R83E1 : { network : "AM", station : "R83E1", location : "00", channel : "EHZ" },
	R5156 : { network : "AM", station : "R5156", location : "00", channel : "EHZ" },
};

/**
 * Get the NSLC for a station id.
 * Returns null for 'local' (bridge has no fixed NSLC).
 */
export function nslcForStation(stationId: StationId): NSLC | null {
	if (stationId === "local") return null;
	return RASPBERRY_SHAKE_NSLC[stationId] ?? null;
}

/**
 * Get the channel hint string for a station, either from known NSLC or as-is.
 */
export function channelHintForStation(stationId: StationId): string {
	const nslc = nslcForStation(stationId);
	return nslc ? nslcToChannelHint(nslc) : stationId;
}
