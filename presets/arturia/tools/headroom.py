#!/usr/bin/env python3
"""Output headroom and loudness of a preset set on ../../test.mid and the slow chords.

    python3 tools/headroom.py WASM LIBRARY [--core] [--n N] [--json OUT]

LIBRARY is cs80v2_presets.json (Arturia, "params") or web/presets-library.json ("fields").
Prints per-preset integrated loudness (ITU-R BS.1770-4, LUFS), active-frame RMS and true
sample peak (dBFS), then medians. Loudness is computed in tools/engine.mjs. --core adds the engine's built-in presets.
"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TEST_MID = os.path.join(ROOT, "test.mid")
SLOW = os.path.join(HERE, "..", "audition", "slow_chords.mid")
SR = 48000


def stats(wasm, spec, mid):
    with tempfile.TemporaryDirectory() as d:
        fp = os.path.join(d, "p.json")
        json.dump(spec, open(fp, "w"))
        r = subprocess.run(["node", os.path.join(HERE, "engine.mjs"), "render", fp, mid, "-", wasm], check=True, capture_output=True, text=True)
        return json.loads(r.stdout)


def main():
    a = sys.argv[1:]
    wasm, libp = a[0], a[1]
    n = int(a[a.index("--n") + 1]) if "--n" in a else 0
    lib = json.load(open(libp))
    items = [(p["name"], p.get("params") or p.get("fields")) for p in lib["presets"]]
    if n: items = items[:: max(1, len(items) // n)][:n]
    if "--core" in a:
        items = [(f"Core {i}", {"core": i}) for i in range(8)] + items
    rows = []
    for name, spec in items:
        for mid in (TEST_MID, SLOW):
            st = stats(wasm, spec, mid)
            rows.append({"preset": name, "midi": os.path.basename(mid), **{k: round(v, 2) for k, v in st.items()}})
            r = rows[-1]
            print(f"{r['lufs']:6.1f} LUFS {r['rms_dbfs']:6.1f} rms {r['peak_dbfs']:6.2f} peak {r['max_gr_db']:5.2f} GR  {name} ({r['midi']})", flush=True)
    for k in ("lufs", "rms_dbfs", "peak_dbfs", "max_gr_db"):
        v = sorted(r[k] for r in rows)
        print(f"{k}: median {v[len(v)//2]}, min {v[0]}, max {v[-1]}")
    if "--json" in a:
        json.dump(rows, open(a[a.index("--json") + 1], "w"), indent=1)


if __name__ == "__main__":
    main()
