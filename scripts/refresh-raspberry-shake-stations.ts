type RawStation = {
	code          : string;
	country?      : string;
	region?       : string;
	online?        : boolean;
	deviceName?    : string;
	geophoneType?  : string;
	latitude?      : number;
	longitude?     : number;
	channels?      : Array<{ code?: string }>;
};

const source = "https://dataview.raspberryshake.org/stations?net=AM";
const outputPath = process.env.RASPBERRY_SHAKE_STATIONS_OUT ?? "static/data/raspberry-shake-stations-live.json";
const response = await fetch(source);
if (!response.ok) throw new Error(`${source} -> HTTP ${response.status}`);

const rawStations = (await response.json()) as RawStation[];
const stations = rawStations
	.map((station) => ({
		code          : station.code,
		name          : station.code,
		place         : [station.region, station.country].filter(Boolean).join(", ") || station.country || "",
		network       : "AM",
		location      : "00",
		online        : Boolean(station.online),
		deviceName    : station.deviceName ?? null,
		geophoneType  : station.geophoneType ?? null,
		latitude      : station.latitude ?? null,
		longitude     : station.longitude ?? null,
		knownChannels : [...new Set((station.channels ?? []).map((channel) => channel.code).filter((code): code is string => Boolean(code)))],
	}))
	.sort((left, right) => left.code.localeCompare(right.code));

const catalog = {
	metadata: {
		source,
		stationCount                 : stations.length,
		stationsWithKnownChannels    : stations.filter((station) => station.knownChannels.length).length,
		stationsWithoutKnownChannels : stations.filter((station) => !station.knownChannels.length).length,
		network                      : "AM",
		defaultLocation              : "00",
		knownChannelNames            : [...new Set(stations.flatMap((station) => station.knownChannels))].sort(),
	},
	stations,
};

await Bun.write(outputPath, JSON.stringify(catalog, null, 2) + "\n");
console.log(JSON.stringify({ outputPath, ...catalog.metadata }, null, 2));
