#!/usr/bin/env python3
"""Quick Raspberry Shake DATACAST UDP -> sound prototype.

Usage:
  python seismic_audio.py --port 8888
  python seismic_audio.py --test-tone

Requires for real audio output:
  pip install sounddevice numpy

If sounddevice/numpy are missing, the script still parses UDP and prints levels.
"""

from __future__ import annotations

import argparse
import math
import queue
import random
import socket
import sys
import threading
import time
from dataclasses import dataclass
from typing import Iterable

try:
    import numpy as np
    import sounddevice as sd
except Exception:  # keep UDP parsing usable without audio deps
    np = None
    sd = None


@dataclass
class ShakePacket:
    channel: str
    timestamp_ms: int
    samples: list[int]


def parse_datacast_packet(data: bytes) -> ShakePacket:
    """Parse Raspberry Shake DATACAST: {'EHZ', epoch_ms, sample, ...}."""
    text = data.decode("utf-8", errors="replace").strip()
    text = text.strip("{}")
    parts = [p.strip().strip("'\"") for p in text.split(",")]
    if len(parts) < 3:
        raise ValueError(f"too few DATACAST fields: {text!r}")
    channel = parts[0]
    timestamp_ms = int(float(parts[1]))
    samples = [int(float(p)) for p in parts[2:] if p]
    return ShakePacket(channel, timestamp_ms, samples)


class Sonifier:
    """Map seismic level to a continuous oscillator."""

    def __init__(self, audio_rate: int = 48_000):
        self.audio_rate = audio_rate
        self.level = 0.0
        self.noise = 0.0
        self.phase = 0.0
        self.lock = threading.Lock()

    def ingest(self, samples: Iterable[int]) -> float:
        vals = list(samples)
        if not vals:
            return 0.0
        mean = sum(vals) / len(vals)
        centered = [v - mean for v in vals]
        rms = math.sqrt(sum(v * v for v in centered) / len(centered))

        # Adaptive compression: counts vary wildly by station/environment.
        normalized = min(1.0, math.log1p(rms) / 12.0)
        with self.lock:
            self.level = 0.92 * self.level + 0.08 * normalized
            self.noise = 0.98 * self.noise + 0.02 * min(1.0, abs(centered[-1]) / 50_000.0)
            return self.level

    def audio_callback(self, outdata, frames, _time_info, status):
        if status:
            print(status, file=sys.stderr)
        with self.lock:
            level = self.level
            noise = self.noise

        t = np.arange(frames, dtype=np.float32) / self.audio_rate
        freq = 80.0 + level * 520.0
        phase_inc = 2.0 * math.pi * freq / self.audio_rate
        phases = self.phase + phase_inc * np.arange(frames, dtype=np.float32)
        self.phase = float((phases[-1] + phase_inc) % (2.0 * math.pi))

        # Warm drone + slight roughness when the ground moves.
        sine = np.sin(phases)
        sub = 0.5 * np.sin(phases * 0.5)
        grit = (np.random.random(frames).astype(np.float32) * 2.0 - 1.0) * noise * 0.08
        gain = 0.03 + level * 0.22
        audio = ((sine + sub) * gain + grit).astype(np.float32)
        outdata[:, 0] = audio
        if outdata.shape[1] > 1:
            outdata[:, 1] = audio


def udp_loop(host: str, port: int, sonifier: Sonifier, only_channel: str | None):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((host, port))
    print(f"listening for Raspberry Shake DATACAST UDP on {host}:{port}")
    last_print = 0.0
    while True:
        data, addr = sock.recvfrom(65_535)
        try:
            packet = parse_datacast_packet(data)
        except Exception as exc:
            print(f"bad packet from {addr}: {exc}")
            continue
        if only_channel and packet.channel != only_channel:
            continue
        level = sonifier.ingest(packet.samples)
        now = time.time()
        if now - last_print > 0.5:
            print(
                f"{packet.channel} {packet.timestamp_ms} "
                f"samples={len(packet.samples):3d} level={level:.3f} from={addr[0]}"
            )
            last_print = now


def synthetic_loop(sonifier: Sonifier):
    print("using synthetic seismic-ish signal; Ctrl-C to stop")
    pulse_at = time.time() + 3.0
    while True:
        now = time.time()
        base = [int(random.gauss(0, 60)) for _ in range(100)]
        if now > pulse_at:
            base = [v + int(math.sin(i / 3) * 8000 * math.exp(-i / 35)) for i, v in enumerate(base)]
            if now > pulse_at + 2.0:
                pulse_at = now + random.uniform(4.0, 8.0)
        level = sonifier.ingest(base)
        print(f"synthetic level={level:.3f}", end="\r", flush=True)
        time.sleep(0.05)


def main() -> int:
    parser = argparse.ArgumentParser(description="Raspberry Shake DATACAST UDP -> sound prototype")
    parser.add_argument("--host", default="0.0.0.0", help="UDP bind host")
    parser.add_argument("--port", type=int, default=8888, help="UDP bind port")
    parser.add_argument("--channel", help="only sonify this channel, e.g. EHZ or SHZ")
    parser.add_argument("--test-tone", action="store_true", help="use synthetic input instead of UDP")
    parser.add_argument("--samplerate", type=int, default=48_000, help="audio sample rate")
    args = parser.parse_args()

    sonifier = Sonifier(audio_rate=args.samplerate)

    if sd is None or np is None:
        print("audio deps missing: install with `pip install sounddevice numpy`")
        print("continuing in parse/level meter mode only")
        if args.test_tone:
            synthetic_loop(sonifier)
        else:
            udp_loop(args.host, args.port, sonifier, args.channel)
        return 0

    worker = threading.Thread(
        target=synthetic_loop if args.test_tone else udp_loop,
        args=(sonifier,) if args.test_tone else (args.host, args.port, sonifier, args.channel),
        daemon=True,
    )
    worker.start()

    print("starting audio output; Ctrl-C to stop")
    with sd.OutputStream(
        samplerate=args.samplerate,
        channels=2,
        dtype="float32",
        callback=sonifier.audio_callback,
        blocksize=256,
    ):
        while True:
            time.sleep(1)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nstopped")
        raise SystemExit(0)
