import json
import tempfile
import unittest
from pathlib import Path

from scripts.extract_station_metadata import extract_station_catalog, write_catalog


class ExtractStationMetadataTest(unittest.TestCase):
    def test_extracts_places_and_channels_for_expanded_and_collapsed_stations(self):
        html = '''
        <li class="station" title="Switzerland"><a href="https://dataview.raspberryshake.org/#/AM"><i></i> R0038 </a><ul class="channels"><li><a href="https://dataview.raspberryshake.org/#/AM/R0038/00/EHZ"><i></i> EHZ </a></li><li><a href="https://dataview.raspberryshake.org/#/AM/R0038"><i></i> HDF </a></li></ul></li>
        <li class="station" title="Oregon, United States"><a><i></i> R00DC </a></li>
        '''

        catalog = extract_station_catalog(html)

        self.assertEqual(catalog["metadata"]["stationCount"], 2)
        self.assertEqual(catalog["stations"][0], {
            "code": "R0038",
            "name": "R0038",
            "place": "Switzerland",
            "network": "AM",
            "location": "00",
            "knownChannels": ["EHZ", "HDF"],
        })
        self.assertEqual(catalog["stations"][1]["knownChannels"], [])

    def test_write_catalog_preserves_station_list_order(self):
        html = '''
        <li class="station" title="Second"><a><i></i> R0002 </a></li>
        <li class="station" title="First"><a><i></i> R0001 </a></li>
        '''
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "stations.json"

            write_catalog(html, ["R0001", "R0002"], out)

            written = json.loads(out.read_text())
            self.assertEqual([s["code"] for s in written["stations"]], ["R0001", "R0002"])


if __name__ == "__main__":
    unittest.main()
