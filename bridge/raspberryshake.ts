import stationCatalog from "../static/data/raspberry-shake-stations-live.json";

export const DEFAULT_NETWORK       = "AM";
export const DEFAULT_LOCATION      = "00";
export const DEFAULT_CHANNEL       = "EHZ";
export const DEFAULT_DELAY_MINUTES = 35;

type StationCatalogEntry = {
	code          : string;
	network       : string;
	location?     : string;
	knownChannels : string[];
};

type StationConfig = {
	network        : string;
	station        : string;
	location       : string;
	defaultChannel : string;
	channels       : readonly string[];
};

const stationCatalogByCode = new Map(
	(stationCatalog.stations as StationCatalogEntry[]).map((station) => [station.code, station]),
);

export const AUTO_CHANNELS = [
	"EHZ",
	"SHZ",
	"EHE",
	"EHN",
	"HHE",
	"HHN",
	"HHZ",
	"HDF",
	"ENZ",
	"ENE",
	"ENN",
] as const;

export type RaspberryShakeStation = string;

export type ChannelAttempt = {
	channel : string;
	status  : "ok" | "empty" | "error";
	error?  : string;
};

export type SeismicTrace = {
	samples    : Float32Array;
	sampleRate : number;
	network    : string;
	station    : string;
	location   : string;
	channel    : string;
	startISO   : string;
	endISO     : string;
	metadata: {
		loadedAtISO          : string;
		requestHost          : string;
		delayMinutes         : number;
		requestedStartISO    : string;
		requestedEndISO      : string;
		requestedChannel     : string;
		actualChannel        : string;
		channelFallbackOrder : string[];
		attemptedChannels    : ChannelAttempt[];
	};
};

export function isKnownStation(station: string): station is RaspberryShakeStation {
	return stationCatalogByCode.has(station);
}

function stationConfigFor(stationCode: string): StationConfig {
	const catalogEntry = stationCatalogByCode.get(stationCode);
	if (!catalogEntry) throw new Error(`Unknown Raspberry Shake station: ${stationCode}`);
	const channels = uniqueChannels([
		...catalogEntry.knownChannels,
		...AUTO_CHANNELS,
	]);
	return {
		network        : catalogEntry.network || DEFAULT_NETWORK,
		station        : catalogEntry.code,
		location       : catalogEntry.location || DEFAULT_LOCATION,
		defaultChannel : channels[0] ?? DEFAULT_CHANNEL,
		channels,
	};
}

function uniqueChannels(channels: readonly string[]) {
	return channels.filter((channel, index) => channel && channels.indexOf(channel) === index);
}

export async function loadRaspberryShakeTrace(options: {
	station       : string;
	windowSeconds : number;
	delayMinutes? : number;
	channels?     : readonly string[];
	startISO?     : string;
}): Promise<SeismicTrace> {
	const station      = stationConfigFor(options.station);
	const delayMinutes = options.delayMinutes ?? DEFAULT_DELAY_MINUTES;
	const start        = options.startISO ? new Date(options.startISO) : new Date(Date.now() - delayMinutes * 60_000 - options.windowSeconds * 1000);
	const end          = new Date(start.getTime() + options.windowSeconds * 1000);
	const channels     = options.channels ?? station.channels;
	const attemptedChannels : ChannelAttempt[] = [];
	let lastError           : unknown          = null;

	const sp = await loadSeisplotjs();

	for (const channel of channels) {
		try {
			const query = new sp.fdsndataselect.DataSelectQuery(
				"data.raspberryshake.org",
			);
			query
				.protocol("https")
				.networkCode(station.network)
				.stationCode(station.station)
				.locationCode(station.location)
				.channelCode(channel)
				.startTime(start.toISOString())
				.endTime(end.toISOString())
				.nodata(404)
				.timeout(20);

			const seismograms = await query.querySeismograms();
			const seis        = seismograms[0];
			if (!seis) {
				attemptedChannels.push({ channel, status: "empty" });
				continue;
			}

			const samples = extractSamples(seis);
			if (samples.length === 0) {
				attemptedChannels.push({ channel, status: "empty" });
				continue;
			}

			attemptedChannels.push({ channel, status: "ok" });
			return {
				samples,
				sampleRate : extractSampleRate(seis),
				network    : station.network,
				station    : station.station,
				location   : station.location,
				channel,
				startISO : start.toISOString(),
				endISO   : end.toISOString(),
				metadata: {
					loadedAtISO : new Date().toISOString(),
					requestHost : "data.raspberryshake.org",
					delayMinutes,
					requestedStartISO    : start.toISOString(),
					requestedEndISO      : end.toISOString(),
					requestedChannel     : station.defaultChannel,
					actualChannel        : channel,
					channelFallbackOrder : [...channels],
					attemptedChannels,
				},
			};
		} catch (error) {
			lastError = error;
			attemptedChannels.push({
				channel,
				status: "error",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	throw new Error(
		`No data returned for ${station.network}.${station.station}.${station.location} on channels ${channels.join(", ")}. ${lastError instanceof Error ? lastError.message : ""}`,
	);
}

async function loadSeisplotjs() {
	const nativeFetch = globalThis.fetch.bind(globalThis);
	const safeFetch: typeof fetch = (input, init) => {
		const cleaned = init ? { ...init, referrer: undefined } : init;
		return nativeFetch(input, cleaned);
	};
	const global = globalThis as typeof globalThis & {
		HTMLDivElement?: typeof HTMLElement;
		customElements?: { define: () => void };
		window?: { fetch: typeof fetch };
	};
	global.HTMLDivElement ??= class {} as typeof HTMLElement;
	global.customElements ??= { define: () => {} };
	global.window ??= { fetch: safeFetch };
	global.fetch = safeFetch;
	return import("seisplotjs/nodeonly");
}

function extractSamples(seis: unknown): Float32Array {
	const candidate = seis as {
		y?: ArrayLike<number>;
		seismogram?    : { y?       : ArrayLike<number> };
		segments?      : Array<{ y? : ArrayLike<number> }>;
		segmentArray?  : Array<{ y? : ArrayLike<number> }>;
		_segmentArray? : Array<{ y? : ArrayLike<number> }>;
	};

	if (candidate.y) return Float32Array.from(candidate.y);
	if (candidate.seismogram?.y) return Float32Array.from(candidate.seismogram.y);

	const segments =
		candidate.segments ??
		candidate.segmentArray ??
		candidate._segmentArray ??
		[];
	const total = segments.reduce(
		(sum, segment) => sum + (segment.y?.length ?? 0),
		0,
	);
	const samples = new Float32Array(total);
	let offset    = 0;
	for (const segment of segments) {
		if (!segment.y) continue;
		samples.set(Float32Array.from(segment.y), offset);
		offset += segment.y.length;
	}
	return samples;
}

function extractSampleRate(seis: unknown): number {
	const candidate = seis as {
		sampleRate?: number;
		segments?      : Array<{ sampleRate? : number }>;
		segmentArray?  : Array<{ sampleRate? : number }>;
		_segmentArray? : Array<{ sampleRate? : number }>;
	};
	if (candidate.sampleRate) return Number(candidate.sampleRate);
	const segments =
		candidate.segments ??
		candidate.segmentArray ??
		candidate._segmentArray ??
		[];
	return Number(segments[0]?.sampleRate ?? 100);
}
