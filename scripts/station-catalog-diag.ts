import { raspberryShakeStations } from "../src/lib/adapters/raspberry-shake-station-catalog";
import { searchStations, toStationChoice } from "../src/lib/domain/station-catalog";

const favouriteMetadata = [
	{ id: "S99EB", place: "Mexico" },
	{ id: "R9B86", place: "Canada" },
	{ id: "S2C02", place: "South Africa" },
	{ id: "R135F", place: "Iceland" },
	{ id: "R4C3D", place: "China" },
] as const;
const favouriteIds = favouriteMetadata.map((station) => station.id);
const queries = ["", "mexico", "canada", "south africa", "iceland", "china"];

const result = {
	ok: true,
	stationCount: raspberryShakeStations.length,
	favouriteMetadata,
	favourites: searchStations(raspberryShakeStations, "", favouriteIds, 5).map(toStationChoice),
	queries: Object.fromEntries(
		queries.map((query) => [
			query || "<empty>",
			searchStations(raspberryShakeStations, query, favouriteIds, 5).map((station) => ({
				code: station.code,
				place: station.place,
				channelHint: toStationChoice(station).channelHint,
			})),
		]),
	),
};

console.log(JSON.stringify(result, null, 2));
