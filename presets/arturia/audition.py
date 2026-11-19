#!/usr/bin/env python3
"""Render audition MP3s for a few translated presets.

    uv run --with lameenc --with numpy python3 audition.py [--out DIR] [name[@test|@chords] ...]

Each preset is rendered by tools/engine.mjs on ../../test.mid and on
audition/slow_chords.mid (written here), then encoded to MP3 at 192 kb/s;
name@test or name@chords renders only that one. --out picks the folder (default audition/).
Prints RMS, peak, spectral centroid and attack/decay shape for each file.
"""
import json
import os
import struct
import subprocess
import sys

import lameenc
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "audition")
WASM = os.path.join(HERE, "tools", "cs80v2.wasm")
TEST_MID = os.path.abspath(os.path.join(HERE, "..", "..", "test.mid"))
SR = 48000

DEFAULT = [
    "Keys and Organs/1", "Keys and Organs/2", "Keys and Organs/3", "Brass/1", "Brass/2", "Strings/1",
    "Pads/1", "Leads/1", "Bass/1", "Bells and Plucks/1", "Woodwinds/1", "FX/1",
]


def vlq(n):
    b = [n & 0x7F]
    n >>= 7
    while n:
        b.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(b))


def write_slow_chords(path):
    """Four slow chords (Am7, Fmaj7, Dm9, E7sus4) at 60 bpm, 4 s each, velocity 90."""
    tpq = 480
    chords = [[45, 57, 60, 64, 67], [41, 57, 60, 64, 65], [38, 57, 60, 62, 65, 64], [40, 57, 59, 62, 64]]
    ev = [(0, bytes([0xFF, 0x51, 3, 0x0F, 0x42, 0x40]))]
    t = 0
    for ch in chords:
        for n in ch:
            ev.append((t, bytes([0x90, n, 90])))
        for n in ch:
            ev.append((t + 4 * tpq - 60, bytes([0x80, n, 0])))
        t += 4 * tpq
    trk = b""
    last = 0
    for tick, data in sorted(ev, key=lambda e: e[0]):
        trk += vlq(tick - last) + data
        last = tick
    trk += vlq(0) + b"\xff\x2f\x00"
    with open(path, "wb") as f:
        f.write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, tpq) + b"MTrk" + struct.pack(">I", len(trk)) + trk)


def analyse(x):
    m = x.mean(axis=1)
    frame = SR // 20
    n = len(m) // frame
    env = np.sqrt((m[: n * frame].reshape(n, frame) ** 2).mean(axis=1))
    active = env > env.max() * 0.1  # frames within 20 dB of the loudest, as in the level match
    rms = float(np.sqrt((env[active] ** 2).mean())) if active.any() else 0.0
    spec = np.abs(np.fft.rfft(m * np.hanning(len(m))))
    f = np.fft.rfftfreq(len(m), 1 / SR)
    return {
        "rms_dbfs": round(float(20 * np.log10(rms + 1e-12)), 1),
        "peak_dbfs": round(float(20 * np.log10(np.abs(x).max() + 1e-12)), 1),
        "centroid_hz": round(float((spec * f).sum() / max(spec.sum(), 1e-12))),
        "silent_frac": round(float(1 - active.mean()), 2),
    }


def main():
    global OUT
    args = sys.argv[1:]
    if "--out" in args:
        i = args.index("--out")
        OUT = os.path.abspath(args[i + 1])
        del args[i : i + 2]
    os.makedirs(OUT, exist_ok=True)
    slow = os.path.join(HERE, "audition", "slow_chords.mid")
    write_slow_chords(slow)
    lib = json.load(open(os.path.join(HERE, "cs80v2_presets.json")))
    by = {f"{p['bank']}/{p['slot']}": p for p in lib["presets"]}
    by.update({p["arturia_name"]: p for p in lib["presets"] + lib["extra"]})
    # the public library (chart presets, scouted sounds, levelled Arturia picks) by display name
    pub = json.load(open(os.path.join(HERE, "..", "..", "web", "presets-library.json")))
    by.update({p["name"]: {**p, "params": p["fields"]} for p in pub["presets"] if "fields" in p})
    wanted = args or DEFAULT
    report = []
    for spec in wanted:
        key, _, only = spec.partition("@")
        p = by[key]
        safe = "".join(c if c.isalnum() else "_" for c in f"{p['bank'] or 'extra'}_{p['name']}").strip("_")
        fpath = os.path.join(OUT, f".{safe}.json")
        json.dump(p["params"], open(fpath, "w"))
        for mid, tag in ((TEST_MID, "test"), (slow, "chords")):
            if only and tag != only:
                continue
            raw = os.path.join(OUT, f".{safe}_{tag}.f32")
            subprocess.run(["node", os.path.join(HERE, "tools", "engine.mjs"), "render", fpath, mid, raw, WASM], check=True)
            x = np.fromfile(raw, dtype="<f4").reshape(-1, 2)
            os.remove(raw)
            a = analyse(x)
            pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
            enc = lameenc.Encoder()
            enc.set_bit_rate(192)
            enc.set_in_sample_rate(SR)
            enc.set_channels(2)
            enc.set_quality(2)
            mp3 = os.path.join(OUT, f"{safe}_{tag}.mp3")
            with open(mp3, "wb") as fh:
                fh.write(enc.encode(pcm.tobytes()) + enc.flush())
            report.append({"preset": key, "file": mp3, **a})
            print(f"{a['rms_dbfs']:6.1f} dB rms {a['peak_dbfs']:6.1f} dB peak {a['centroid_hz']:6d} Hz  {mp3}")
        os.remove(fpath)
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
