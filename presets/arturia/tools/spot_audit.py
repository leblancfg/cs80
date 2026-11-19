#!/usr/bin/env python3
"""Spot-render presets of the public library and check that their shape fits their names.

    python3 tools/spot_audit.py [bank/name ...]   -> spot-audit.md

Without arguments it takes every chart preset, then two Arturia translations per bank.
Per preset: the mapped channel II detune and the beat it makes against channel I on A4
(between the lowest pair of partials the two footages share), the spectral centroid of the
held chord, attack (time to 90% of the held peak), release (time from note-off to -20 dB),
the held chord's amplitude spread and the held A3's pitch wobble (both include the engine's
voice-card drift). Uses the engine build in web/cs80v2.wasm.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[1]
WASM = ROOT / "web" / "cs80v2.wasm"
FEET_SEMIS = [-12, 0, 7, 12, 19, 24]
FEET_LABEL = ["16'", "8'", "5 1/3'", "4'", "2 2/3'", "2'"]


def run(mode, presets):
    batch = {"wasm": str(WASM), "presets": presets}
    r = subprocess.run(["node", str(HERE / "tools" / "engine.mjs"), mode], input=json.dumps(batch),
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def beat(fields):
    """Hz of beating on A4 between the two channels' nearest shared partials, from detune alone"""
    c = fields.get("detune_cents", 0.0)
    f1 = 440.0 * 2 ** (FEET_SEMIS[int(fields.get("feet_I", 1))] / 12)
    f2 = 440.0 * 2 ** (FEET_SEMIS[int(fields.get("feet_II", 1))] / 12)
    best = None
    for n in range(1, 9):          # partial n of channel I against partial m of channel II
        for m in range(1, 9):
            if abs(1200 * math.log2(n * f1 / (m * f2))) < 3:  # the footages put them on (nearly) the same pitch
                if best is None or n * f1 < best[0]:
                    best = (n * f1, m)
    if best is None:
        return None
    hz, m = best
    return abs(m * f2 * 2 ** (c / 1200) - hz)


def main():
    lib = json.loads((ROOT / "web" / "presets-library.json").read_text())
    core = {p["id"].split(" ", 1)[1]: p["fields"] for p in json.loads(subprocess.run(
        ["node", str(HERE / "tools" / "core_fields.mjs"), str(WASM)], capture_output=True, text=True, check=True).stdout)["presets"]}
    want = sys.argv[1:]
    if want:
        picks = [p for p in lib["presets"] if f"{p['bank']}/{p['name']}" in want]
    else:
        picks = [p for p in lib["presets"] if p["origin"] == "chart"]
        for b in lib["banks"]:
            art = [p for p in lib["presets"] if p["bank"] == b and p["origin"] == "arturia"]
            picks += art[:1] + art[len(art) // 2:len(art) // 2 + 1] if len(art) > 1 else art
    for p in picks:
        p["_fields"] = core[p["name"]] if p["origin"] == "core" else p["fields"]
    batch = [{"id": str(i), "fields": p["_fields"]} for i, p in enumerate(picks)]
    m, mo = run("measure", batch), run("motion", batch)
    lines = ["# Spot audit", "",
             "Rendered with the cs80v2 engine (`web/cs80v2.wasm`) from the public library. Beat is the rate the mapped channel II detune makes against channel I on A4, between the lowest partials the two footages share. The engine's voice cards add their own slow beating of about 0.5 to 2 Hz on top, and that shows in the pitch wobble column. Centroid is the held C-major chord's, attack is the time to 90% of its peak, release is from note-off to -20 dB (2 s means it is still sounding). Amp spread is the held chord's RMS variation, which a decaying pluck also raises. Pitch wobble is the held A3's standard deviation in cents.", "",
             "| Bank | Preset | Origin | Detune (ct) | Feet I/II | Beat on A4 (Hz) | Centroid (Hz) | Attack (s) | Release (s) | Amp spread | Pitch wobble (ct) | Level (dBFS) |",
             "|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|"]
    for i, p in enumerate(picks):
        f, s, q = p["_fields"], m[str(i)], mo[str(i)]
        b = beat(f) if -0.98 < f.get("mix", 0) < 0.98 else None
        lines.append(f"| {p['bank']} | {p['name'].replace('|', '/')} | {p['origin']} | {f.get('detune_cents', 0):+.1f} | "
                     f"{FEET_LABEL[int(f.get('feet_I', 1))]} / {FEET_LABEL[int(f.get('feet_II', 1))]} | "
                     f"{'one channel' if b is None else f'{b:.2f}'} | {s['centroid']:.0f} | {s['t90']:.2f} | {s['rel20']:.2f} | "
                     f"{q['am']:.2f} | {q['pitch']:.1f} | {s['dbfs']:.1f} |")
    (HERE / "spot-audit.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
