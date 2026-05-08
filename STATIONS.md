# STATIONS.md

# Raspberry Shake Station Connection Notes

## Overview

This project connects to Raspberry Shake seismic stations using the standard seismic naming pattern:

```text
NetworkCode.StationCode.LocationCode.ChannelCode
```

For these stations, we will use the Raspberry Shake public network:

```text
AM
```

Default location code:

```text
00
```

Primary channel to try first:

```text
EHZ
```

So the usual connection string looks like:

```text
AM.<STATION>.00.EHZ
```

Example:

```text
AM.RD432.00.EHZ
```

---

## Stations Used by This Project

| Station | Network | Location | Preferred channel strategy | Default stream |
|---|---|---|---|---|
| `RD432` | `AM` | `00` | `EHZ` first, then auto-fallback | `AM.RD432.00.EHZ` |
| `R5022` | `AM` | `00` | `EHZ` first, then auto-fallback | `AM.R5022.00.EHZ` |
| `RCA97` | `AM` | `00` | `EHZ` first, then auto-fallback | `AM.RCA97.00.EHZ` |
| `R83E1` | `AM` | `00` | `EHZ` first, then auto-fallback | `AM.R83E1.00.EHZ` |
| `R5156` | `AM` | `00` | `EHZ` first, then auto-fallback | `AM.R5156.00.EHZ` |

---

## Recommended Channel Order

Use `EHZ` first because it is the common vertical geophone channel on many Raspberry Shake units.

Recommended fallback order:

```js
const AUTO_CHANNELS = [
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
  "ENN"
];
```

Practical meaning:

| Channel | Meaning |
|---|---|
| `EHZ` | Vertical weak-motion geophone, up/down |
| `SHZ` | Vertical short-period geophone |
| `EHE` | East-west weak-motion geophone |
| `EHN` | North-south weak-motion geophone |
| `HHE` | East-west high broadband geophone |
| `HHN` | North-south high broadband geophone |
| `HHZ` | Vertical high broadband geophone |
| `HDF` | Infrasound / air-pressure channel |
| `ENZ` | Vertical strong-motion accelerometer |
| `ENE` | East-west strong-motion accelerometer |
| `ENN` | North-south strong-motion accelerometer |

For sonification, start with `EHZ`. It usually gives the clearest single-channel earthquake/listening signal.

---

## Station List Constant

Use this in the app:

```ts
export const STATIONS = [
  "RD432",
  "R5022",
  "RCA97",
  "R83E1",
  "R5156"
] as const;
```

Optionally include station metadata:

```ts
export const RASPBERRY_SHAKE_STATIONS = [
  { network: "AM", station: "RD432", location: "00", defaultChannel: "EHZ" },
  { network: "AM", station: "R5022", location: "00", defaultChannel: "EHZ" },
  { network: "AM", station: "RCA97", location: "00", defaultChannel: "EHZ" },
  { network: "AM", station: "R83E1", location: "00", defaultChannel: "EHZ" },
  { network: "AM", station: "R5156", location: "00", defaultChannel: "EHZ" },
] as const;
```

---

## Seisplotjs Connection Pattern

Use `seisplotjs` with Raspberry Shake's FDSN dataselect endpoint.

```ts
import * as sp from "seisplotjs";

const dsQuery = new sp.fdsndataselect.DataSelectQuery(
  "data.raspberryshake.org"
);

dsQuery
  .protocol("https")
  .networkCode("AM")
  .stationCode("RD432")
  .locationCode("00")
  .channelCode("EHZ")
  .timeRange(timeWindow)
  .nodata(404);

const seismograms = await dsQuery.querySeismograms();
```

The important parts are:

```text
networkCode("AM")
stationCode("<STATION>")
locationCode("00")
channelCode("<CHANNEL>")
```

---

## Time Window Rules

Raspberry Shake FDSN access is not true real-time streaming.

Recommended project defaults:

```ts
const windowMinutes = 60;
const delayMinutes = 35;
```

This means:

```text
end time   = now - 35 minutes
start time = end time - 60 minutes
```

Why delay the request?

Because FDSN data availability can lag behind live time. A 30–35 minute delay is safer than asking for “right now”.

---

## Building a Time Window

```ts
const endDate = new Date(Date.now() - delayMinutes * 60 * 1000);
const startDate = new Date(
  endDate.getTime() - windowMinutes * 60 * 1000
);

const startISO = startDate.toISOString();
const endISO = endDate.toISOString();

const timeWindow = sp.util.startDuration(
  startISO,
  windowMinutes * 60
);
```

---

## Auto-Fallback Channel Loader

Use this when a station may not have the requested channel.

```ts
const AUTO_CHANNELS = [
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
  "ENN"
];

export async function loadFirstAvailableChannel(params: {
  station: string;
  network?: string;
  location?: string;
  channels?: string[];
  timeWindow: unknown;
}) {
  const network = params.network ?? "AM";
  const location = params.location ?? "00";
  const channels = params.channels ?? AUTO_CHANNELS;

  let lastError: unknown = null;

  for (const channel of channels) {
    try {
      const dsQuery = new sp.fdsndataselect.DataSelectQuery(
        "data.raspberryshake.org"
      );

      dsQuery
        .protocol("https")
        .networkCode(network)
        .stationCode(params.station)
        .locationCode(location)
        .channelCode(channel)
        .timeRange(params.timeWindow)
        .nodata(404);

      const seismograms = await dsQuery.querySeismograms();

      if (seismograms?.length) {
        return {
          network,
          station: params.station,
          location,
          channel,
          seismograms
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `No data returned for ${network}.${params.station}.${location} on channels: ${channels.join(", ")}`
  );
}
```

---

## DataView Links

These are useful for manual checking in the Raspberry Shake browser viewer.

| Station | DataView EHZ URL |
|---|---|
| `RD432` | `https://dataview.raspberryshake.org/#/AM/RD432/00/EHZ` |
| `R5022` | `https://dataview.raspberryshake.org/#/AM/R5022/00/EHZ` |
| `RCA97` | `https://dataview.raspberryshake.org/#/AM/RCA97/00/EHZ` |
| `R83E1` | `https://dataview.raspberryshake.org/#/AM/R83E1/00/EHZ` |
| `R5156` | `https://dataview.raspberryshake.org/#/AM/R5156/00/EHZ` |

If a station does not show `EHZ`, open the station in DataView and inspect available channels.

---

## FDSN URL Shape

The raw FDSN dataselect URL shape is:

```text
https://data.raspberryshake.org/fdsnws/dataselect/1/query
```

Typical parameters:

```text
network=AM
station=RD432
location=00
channel=EHZ
starttime=2026-05-08T10:00:00Z
endtime=2026-05-08T11:00:00Z
```

Example shape:

```text
https://data.raspberryshake.org/fdsnws/dataselect/1/query?network=AM&station=RD432&location=00&channel=EHZ&starttime=<START_ISO>&endtime=<END_ISO>
```

For this app, prefer `seisplotjs` over hand-building the URL.

---

## Expected Input Data

The returned seismogram should contain:

```ts
type SeismicTrace = {
  samples: Float32Array | number[];
  sampleRate: number;
  network: "AM";
  station: string;
  location: string;
  channel: string;
  startISO: string;
  endISO: string;
};
```

The sonification layer expects only:

```ts
samples: Float32Array | number[];
sampleRate: number;
```

Everything else is metadata.

---

## Project Defaults

```ts
export const DEFAULT_NETWORK = "AM";
export const DEFAULT_LOCATION = "00";
export const DEFAULT_CHANNEL = "EHZ";

export const DEFAULT_WINDOW_MINUTES = 60;
export const DEFAULT_DELAY_MINUTES = 35;

export const DEFAULT_STATION = "RD432";
```

---

## Connection Checklist

When a station fails to load:

1. Confirm the station code is correct.
2. Try `EHZ`.
3. Try `SHZ`.
4. Try horizontal channels: `EHE`, `EHN`.
5. Try broadband channels: `HHE`, `HHN`, `HHZ`.
6. Try a longer delay, for example `45` or `60` minutes.
7. Try a shorter window, for example `10` minutes.
8. Open the station in DataView and inspect available channels.
9. Watch for service limits: keep requests modest and avoid rapid repeated polling.

---

## Notes for This Project

The app should not assume every station has every channel.

Good behaviour:

```text
station selected
    ↓
try EHZ
    ↓
if unavailable, try fallback channels
    ↓
use first returned seismogram
    ↓
store active channel in metadata
```

This keeps the UI simple and robust.

---

---

## Python vs TypeScript Connection Model

This project will connect from TypeScript/Svelte, but the data model is the same as the common Python/ObsPy workflow.

Both approaches request the same thing:

```text
Network.Station.Location.Channel + StartTime + EndTime
```

Example stream:

```text
AM.RD432.00.EHZ
```

The difference is mostly library shape.

---

## Python / ObsPy Style

A typical Python version uses ObsPy's FDSN client:

```py
from obspy import UTCDateTime
from obspy.clients.fdsn import Client

client = Client("RASPISHAKE")

end = UTCDateTime.now() - 35 * 60
start = end - 60 * 60

stream = client.get_waveforms(
    network="AM",
    station="RD432",
    location="00",
    channel="EHZ",
    starttime=start,
    endtime=end,
)
```

ObsPy returns a `Stream`.

A `Stream` contains one or more `Trace` objects:

```py
trace = stream[0]

samples = trace.data
sample_rate = trace.stats.sampling_rate
network = trace.stats.network
station = trace.stats.station
location = trace.stats.location
channel = trace.stats.channel
starttime = trace.stats.starttime
endtime = trace.stats.endtime
```

Conceptually:

```text
ObsPy Stream
    └── Trace
          ├── trace.data                 # numeric samples
          └── trace.stats.sampling_rate  # Hz
```

For this sonification app, the important Python fields are:

| Python / ObsPy | Meaning | TypeScript equivalent |
|---|---|---|
| `trace.data` | Seismic samples | `Float32Array` or `number[]` |
| `trace.stats.sampling_rate` | Original seismic sample rate | `sampleRate` |
| `trace.stats.network` | Network code | `network` |
| `trace.stats.station` | Station code | `station` |
| `trace.stats.location` | Location code | `location` |
| `trace.stats.channel` | Channel code | `channel` |
| `trace.stats.starttime` | Trace start time | `startISO` |
| `trace.stats.endtime` | Trace end time | `endISO` |

---

## TypeScript / Seisplotjs Style

The TypeScript/Svelte version should use `seisplotjs`:

```ts
import * as sp from "seisplotjs";

const dsQuery = new sp.fdsndataselect.DataSelectQuery(
  "data.raspberryshake.org"
);

dsQuery
  .protocol("https")
  .networkCode("AM")
  .stationCode("RD432")
  .locationCode("00")
  .channelCode("EHZ")
  .timeRange(timeWindow)
  .nodata(404);

const seismograms = await dsQuery.querySeismograms();
```

`seisplotjs` returns seismogram-like objects rather than ObsPy `Trace` objects.

The sample array may be found in one of several places depending on the object shape:

```ts
seis.y
seis.seismogram.y
seis.segments[0].y
seis.segmentArray[0].y
```

So the TypeScript app should normalize the object into a simple internal shape.

Recommended internal shape:

```ts
export type SeismicTrace = {
  samples: Float32Array;
  sampleRate: number;
  network: string;
  station: string;
  location: string;
  channel: string;
  startISO: string;
  endISO: string;
};
```

After that, the audio code should not care whether the source was Python or TypeScript.

---

## Side-by-Side Flow

| Step | Python / ObsPy | TypeScript / Seisplotjs |
|---|---|---|
| Client | `Client("RASPISHAKE")` | `new DataSelectQuery("data.raspberryshake.org")` |
| Time type | `UTCDateTime` | `Date` + ISO string |
| Request | `get_waveforms(...)` | `querySeismograms()` |
| Returned container | `Stream` | `Seismogram[]` |
| Single trace | `stream[0]` | `seismograms[0]` |
| Samples | `trace.data` | `seis.y` / segment `.y` |
| Sample rate | `trace.stats.sampling_rate` | `seis.sampleRate` / segment sample rate |
| Metadata | `trace.stats.*` | query values + seismogram metadata |
| Audio transform | Usually NumPy array processing | `Float32Array` processing |
| WAV export | `scipy.io.wavfile.write` or `soundfile.write` | `AudioBuffer` + WAV encoder |

---

## Important Difference: Python Usually Resamples, Browser Code Usually Re-labels Sample Rate

In Python, sonification code often explicitly resamples the data:

```py
# conceptual
audio = resample(seismic_samples, target_audio_length)
wavfile.write("out.wav", audio_sample_rate, audio)
```

That means Python may create a new sample array.

In the current browser/TypeScript approach, the code does something simpler:

```ts
const audioRate = seismicSampleRate * sonifyFactor;

const audioBuffer = audioCtx.createBuffer(
  1,
  normalizedSamples.length,
  audioRate
);

audioBuffer.copyToChannel(normalizedSamples, 0);
```

This does not create new interpolated samples.

Instead, it tells the browser:

```text
play these same samples at a much higher sample rate
```

That compresses time and raises pitch.

Both methods are valid for sonification.

The browser method is simpler and fast. The Python resampling method gives more control if you need filtering, anti-aliasing, or fixed export sample rates like `44100 Hz` or `48000 Hz`.

---

## Shared Sonification Algorithm

Whether the source is Python or TypeScript, the core transformation should be the same:

```text
fetch waveform
    ↓
extract samples and sample rate
    ↓
remove mean / DC offset
    ↓
normalize amplitude to [-1, +1]
    ↓
speed up by sonify factor
    ↓
play or export as WAV
```

Equivalent Python-style processing:

```py
import numpy as np

samples = trace.data.astype(np.float32)

samples = samples - np.mean(samples)

max_abs = np.max(np.abs(samples))
if max_abs == 0:
    max_abs = 1.0

normalized = samples / max_abs
```

Equivalent TypeScript-style processing:

```ts
const centered = removeMean(samples);
const normalized = normalize(centered);
const audioBuffer = seismicToAudioBuffer({
  audioCtx,
  samples: normalized,
  seismicSampleRate: sampleRate,
  speedFactor: sonifyFactor
});
```

---

## Recommended TypeScript Adapter

Use an adapter layer that converts `seisplotjs` output into a stable app format.

```ts
export function extractSamples(seis: any): Float32Array {
  if (seis?.y) {
    return Float32Array.from(seis.y);
  }

  if (seis?.seismogram?.y) {
    return Float32Array.from(seis.seismogram.y);
  }

  const segments =
    seis?.segments ??
    seis?.segmentArray ??
    seis?._segmentArray ??
    [];

  if (segments.length) {
    const arrays = segments
      .map((segment: any) => segment.y)
      .filter(Boolean)
      .map((y: ArrayLike<number>) => Array.from(y));

    const flat = arrays.flat();

    return Float32Array.from(flat);
  }

  throw new Error("Could not extract samples from seismogram.");
}
```

Sample-rate extraction:

```ts
export function extractSampleRate(seis: any): number {
  if (seis?.sampleRate) {
    return Number(seis.sampleRate);
  }

  const segments =
    seis?.segments ??
    seis?.segmentArray ??
    seis?._segmentArray ??
    [];

  if (segments.length && segments[0]?.sampleRate) {
    return Number(segments[0].sampleRate);
  }

  return 100;
}
```

Then create the internal trace:

```ts
export function toSeismicTrace(params: {
  seis: any;
  network: string;
  station: string;
  location: string;
  channel: string;
  startISO: string;
  endISO: string;
}): SeismicTrace {
  return {
    samples: extractSamples(params.seis),
    sampleRate: extractSampleRate(params.seis),
    network: params.network,
    station: params.station,
    location: params.location,
    channel: params.channel,
    startISO: params.startISO,
    endISO: params.endISO
  };
}
```

This keeps the rest of the Svelte app clean.

---

## Recommendation for This Project

Use TypeScript as the main runtime:

```text
Svelte UI
    ↓
seisplotjs fetch
    ↓
adapter to SeismicTrace
    ↓
sonification module
    ↓
Web Audio playback
    ↓
WAV export
```

Use Python only as a reference or offline analysis tool.

Good division:

| Concern | Best tool |
|---|---|
| Browser UI | Svelte |
| Raspberry Shake data request | `seisplotjs` |
| Seismic trace normalization | TypeScript utility functions |
| Playback | Web Audio API |
| WAV export | `audiobuffer-to-wav` or local encoder |
| Offline scientific analysis | Python + ObsPy + NumPy/SciPy |

For the app, make TypeScript own the connection path. Do not depend on Python unless you specifically need offline batch processing or scientific analysis.

## Sources

- Raspberry Shake station naming convention: https://manual.raspberryshake.org/stationNamingConvention.html
- Raspberry Shake FDSN web services: https://manual.raspberryshake.org/fdsn.html
- Raspberry Shake channel descriptions: https://raspberryshake.org/things-you-might-find-with-your-raspberry-shake-pt1/
- FDSN AM network page: https://www.fdsn.org/networks/detail/AM/
- Raspberry Shake DataView: https://dataview.raspberryshake.org/
