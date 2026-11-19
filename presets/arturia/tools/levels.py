#!/usr/bin/env python3
"""Chord-test levels of the Core presets and both libraries (tools/engine.mjs measure).

    python3 tools/levels.py WASM ARTURIA_JSON PUBLIC_JSON

The chord test is C3 E3 G3 C4 at velocity 100, held 3 s. RMS is over the frames
within 20 dB of the loudest (so plucks are not penalised for decaying); peak is
the chord's sample peak at the output. peak6 is the worst case: D2 F3 A3 C4 E4 G4
struck at velocity 127, at the output; pre6 is the same before the output limiter
(builds without a limiter report the output). Prints medians and ranges per set.
"""
import json, math, os, statistics, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
db = lambda x: 20 * math.log10(max(x, 1e-9))


def measure(wasm, presets):
    batch = {"wasm": wasm, "presets": presets}
    r = subprocess.run(["node", os.path.join(HERE, "engine.mjs"), "measure"], input=json.dumps(batch), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def summary(label, m):
    rows = [s for s in m.values() if s["finite"] and s["rms"] > 1e-5]
    col = lambda f: sorted(f(s) for s in rows)
    out = {"n": len(rows)}
    for k, f in (("rms_dbfs", lambda s: s["dbfs"]), ("peak_dbfs", lambda s: db(s["peak"])), ("crest_db", lambda s: db(s["peak"]) - s["dbfs"]),
                 ("peak6_dbfs", lambda s: db(s["peak6"])), ("pre6_dbfs", lambda s: db(s.get("pre6", s["peak6"]))), ("gr6_db", lambda s: s.get("gr6", 0.0))):
        v = col(f)
        out[k] = {"median": round(statistics.median(v), 1), "min": round(v[0], 1), "max": round(v[-1], 1)}
    over = sum(1 for s in rows if s["peak6"] > 0.8913)
    out["peak6_over_-1dBFS"] = over
    print(f"{label:9s} n={len(rows):3d}  " + "  ".join(f"{k} {v['median']} [{v['min']}..{v['max']}]" for k, v in out.items() if isinstance(v, dict)) + f"  peak6>-1dBFS: {over}")
    return out


def main():
    wasm, art, pub = sys.argv[1:4]
    core = json.loads(subprocess.run(["node", os.path.join(HERE, "core_fields.mjs"), wasm], capture_output=True, text=True, check=True).stdout)["presets"]
    res = {"core": summary("Core", measure(wasm, core))}
    a = json.load(open(art))["presets"]
    res["arturia"] = summary("Arturia", measure(wasm, [{"id": f"{p['bank']}|{p['slot']}", "fields": p["params"]} for p in a]))
    p = json.load(open(pub))["presets"]
    res["public"] = summary("Public", measure(wasm, [{"id": f"{x['bank']}|{x['slot']}", "fields": x["fields"]} for x in p]))
    if len(sys.argv) > 4:
        json.dump(res, open(sys.argv[4], "w"), indent=1)


if __name__ == "__main__":
    main()
