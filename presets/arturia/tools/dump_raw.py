#!/usr/bin/env python3
"""Print the raw stored Arturia values of named presets, field by field, next to their translation.

    python3 tools/dump_raw.py K.U_VG_FIRE M.L_CHARIOT-01 ...

Names match the file name without .aupreset, case-insensitively. Raw values are what the
plugin stored (0..1 except items); "lever" is 10 * (1 - x) for the bottom-panel levers that
are stored upside down, so it reads like a chart position on the CS-80's 0-10 scale.
"""
import glob
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import translate as t  # noqa: E402

INVERTED = {"VIB_RATE", "VIB_VCO", "VIB_VCF", "VIB_VCA", "VIB_WAVE", "RING_A", "RING_D", "RING_DEPTH", "RING_SPEED",
            "RING_MOD", "BRILLANCE", "RESONANCE", "TOUCH_INITIAL", "TOUCH_SPEED", "TOUCH_VCO", "TOUCH_VCF",
            "KB_BRIL_LOW", "KB_BRIL_HIGH", "KB_LEVEL_LOW", "KB_LEVEL_HIGH"}


def find(name):
    for path in glob.glob(os.path.join(t.SRC, "*", "*.aupreset")):
        if os.path.basename(path)[:-9].strip().lower() == name.strip().lower():
            return path
    return None


def dump(path):
    name, w, ppath, nbytes = t.decode(path)
    f, fidelity, drops, notes, info = t.translate(name, w)
    voice_patch = [int(w[t.G["NUM_PATCH_VOIE"] + i]) for i in range(8)]
    pnum = max(set(voice_patch), key=voice_patch.count)
    base = pnum * t.PATCH_WORDS
    print(f"== {os.path.relpath(path, t.SRC)}  ({'V2' if nbytes == 5396 else 'V1'}, patch {pnum + 1}, audible {info['audible']}, {fidelity})")
    print(f"   path string: {ppath}")
    for k, i in t.CH.items():
        a, b = w[base + i], w[base + t.CH2 + i]
        print(f"   {k:14s} I {a:7.4f}   II {b:7.4f}")
    print(f"   {'DETUNE':14s}   {w[base + t.DETUNE]:7.4f}   (2x-1 = {2 * w[base + t.DETUNE] - 1:+.4f})")
    print(f"   {'MIXE':14s}   {w[base + t.MIXE]:7.4f}")
    for k, i in t.G.items():
        if k.endswith("VOIE") or k.startswith("ZONE"):
            continue
        x = w[i]
        lever = f"  lever {10 * (1 - x):5.2f}" if k in INVERTED else ""
        print(f"   {k:14s}   {x:7.4f}{lever}")
    print("   voice patches", voice_patch, " per-voice detune", [round(w[t.G['DETUNE_VOIE'] + i], 3) for i in range(8)])
    print("   dropped:", drops)
    print("   cs80v2:", {k: v for k, v in f.items() if not k.startswith(("I.", "II."))})
    print()


if __name__ == "__main__":
    for n in sys.argv[1:]:
        p = find(n)
        if p:
            dump(p)
        else:
            print("not found:", n)
