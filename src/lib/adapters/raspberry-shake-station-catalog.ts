import stationData from "../../../static/data/raspberry-shake-stations-live.json";
import type { StationCatalogEntry } from "$lib/domain/station-catalog";

type RawStationCatalog = {
	stations: StationCatalogEntry[];
};

export const raspberryShakeStations: StationCatalogEntry[] = (stationData as RawStationCatalog).stations;
