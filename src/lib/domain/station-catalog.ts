import type { StationChoice } from "$lib/types";

export type StationCatalogEntry = {
	code          : string;
	name          : string;
	place         : string;
	network       : string;
	location?     : string;
	knownChannels : string[];
	online?        : boolean;
	deviceName?    : string | null;
	geophoneType?  : string | null;
	latitude?      : number | null;
	longitude?     : number | null;
};

const DEFAULT_CHANNEL = "EHZ";
const DEFAULT_LOCATION = "00";

export function searchStations(
	stations     : StationCatalogEntry[],
	query        : string,
	favouriteIds : string[] = [],
	limit        = 50,
): StationCatalogEntry[] {
	const normalizedQuery = normalize(query);
	const favouriteRank = new Map(favouriteIds.map((id, index) => [id, index]));
	const matchingStations = normalizedQuery
		? stations.filter((station) => searchableText(station).includes(normalizedQuery))
		: stations;

	return [...matchingStations]
		.sort((left, right) => stationRank(left, normalizedQuery, favouriteRank) - stationRank(right, normalizedQuery, favouriteRank))
		.slice(0, limit);
}

export function toStationChoice(station: StationCatalogEntry): StationChoice {
	const channel = station.knownChannels.includes(DEFAULT_CHANNEL)
		? DEFAULT_CHANNEL
		: station.knownChannels[0] ?? DEFAULT_CHANNEL;
	return {
		id          : station.code,
		name        : station.name || station.code,
		place       : station.place,
		channelHint : `${station.network}.${station.code}.${station.location || DEFAULT_LOCATION}.${channel}`,
		status      : "archive",
	};
}

function stationRank(station: StationCatalogEntry, query: string, favouriteRank: Map<string, number>) {
	const favourite = favouriteRank.has(station.code) ? favouriteRank.get(station.code)! : 10_000;
	if (!query) return favourite;
	const code = normalize(station.code);
	if (code === query) return favourite - 1_000_000;
	if (code.startsWith(query)) return favourite - 100_000;
	if (normalize(station.place).startsWith(query)) return favourite - 10_000;
	return favourite;
}

function searchableText(station: StationCatalogEntry) {
	return normalize(`${station.code} ${station.name} ${station.place}`);
}

function normalize(value: string) {
	return value.trim().toLowerCase();
}
