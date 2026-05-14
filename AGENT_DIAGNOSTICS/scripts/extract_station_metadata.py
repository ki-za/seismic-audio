#!/usr/bin/env python3
import argparse
import html
import json
import re
from pathlib import Path

STATION_PATTERN = re.compile(
    r'<li[^>]*class="station"[^>]*title="([^"]*)"(.*?)(?=<li[^>]*class="station"|</ul></div></div></wa-station-tree>|$)',
    re.S,
)
STATION_CODE_PATTERN = re.compile(r"\b([RST][0-9A-F]{4})\s*</a>")
CHANNEL_PATTERN_TEMPLATE = r"(?:/AM/{code}/00/([A-Z0-9]{{3}})|</i>\s*([A-Z0-9]{{3}})\s*</a>)"


def unique(values):
    seen = set()
    result = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def extract_channels(block, station_code):
    channels = []
    pattern = re.compile(CHANNEL_PATTERN_TEMPLATE.format(code=re.escape(station_code)), re.S)
    for match in pattern.finditer(block):
        channel = match.group(1) or match.group(2)
        if channel and channel != station_code[:3]:
            channels.append(channel)
    return unique(channels)


def extract_station_catalog(document):
    stations = []
    for match in STATION_PATTERN.finditer(document):
        place = html.unescape(match.group(1)).strip()
        block = match.group(2)
        code_match = STATION_CODE_PATTERN.search(block)
        if not code_match:
            continue
        code = code_match.group(1)
        stations.append(
            {
                "code": code,
                "name": code,
                "place": place,
                "network": "AM",
                "location": "00",
                "knownChannels": extract_channels(block, code),
            }
        )

    return {
        "metadata": build_metadata(stations),
        "stations": stations,
    }


def build_metadata(stations):
    channels = sorted({channel for station in stations for channel in station["knownChannels"]})
    return {
        "source": "Data View: Raspberry Shake Data Visualization Tool.html",
        "stationCount": len(stations),
        "stationsWithKnownChannels": sum(1 for station in stations if station["knownChannels"]),
        "stationsWithoutKnownChannels": sum(1 for station in stations if not station["knownChannels"]),
        "network": "AM",
        "defaultLocation": "00",
        "knownChannelNames": channels,
    }


def order_by_station_list(stations, station_codes):
    by_code = {station["code"]: station for station in stations}
    ordered = [by_code[code] for code in station_codes if code in by_code]
    extras = [station for station in stations if station["code"] not in set(station_codes)]
    return ordered + sorted(extras, key=lambda station: station["code"])


def write_catalog(document, station_codes, output_path):
    catalog = extract_station_catalog(document)
    catalog["stations"] = order_by_station_list(catalog["stations"], station_codes)
    catalog["metadata"] = build_metadata(catalog["stations"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    return catalog


def main():
    parser = argparse.ArgumentParser(description="Extract Raspberry Shake station metadata from saved Data View HTML.")
    parser.add_argument("--html", default="Data View_ Raspberry Shake Data Visualization Tool.html")
    parser.add_argument("--station-list", default="station-list.txt")
    parser.add_argument("--out", default="static/data/raspberry-shake-stations.json")
    args = parser.parse_args()

    document = Path(args.html).read_text(errors="ignore")
    station_codes = [line.strip() for line in Path(args.station_list).read_text().splitlines() if line.strip()]
    catalog = write_catalog(document, station_codes, Path(args.out))
    print(json.dumps(catalog["metadata"], indent=2))


if __name__ == "__main__":
    main()
