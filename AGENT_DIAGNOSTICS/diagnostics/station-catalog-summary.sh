#!/usr/bin/env bash
set -euo pipefail

CATALOG="${1:-static/data/raspberry-shake-stations.json}"

python3 - <<'PY' "$CATALOG"
import json
import sys
from collections import Counter
from pathlib import Path

catalog = json.loads(Path(sys.argv[1]).read_text())
stations = catalog["stations"]
print("─── Station catalog metadata ───")
print(json.dumps(catalog["metadata"], indent=2))
print()
print("─── First 12 stations ───")
for station in stations[:12]:
    channels = ", ".join(station["knownChannels"]) or "auto"
    print(f'{station["code"]:6}  {station["place"]:32}  {channels}')
print()
print("─── Top 20 places ───")
for place, count in Counter(station["place"] for station in stations).most_common(20):
    print(f"{count:4}  {place}")
PY
