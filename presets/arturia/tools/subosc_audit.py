#!/usr/bin/env python3
"""Audit of the bottom-panel lever direction (sub oscillator, ring modulator, touch).

    python3 tools/subosc_audit.py

translate.py reads these levers inverted (stored 1.0 = minimum). This renders
presets whose names promise motion, plus the Waveforms demo patches, both ways:
as translated, and with the sub-oscillator and ring-mod words read upright.
Motion is the spread of a 10 ms RMS envelope over the held part of the chord
test (std / mean) and the pitch wobble from zero crossings of a single note.
"""
import glob, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import translate as T  # noqa: E402

WANT = r"vibrat|s&h|lfo|wobb|tremolo|^sub$|ring|swarm|sweep"


def upright(f, g):
    """the same patch with the sub-osc and ring words read upright (1.0 = maximum)"""
    f = dict(f)
    vco, vcf, vca = g("VIB_VCO"), g("VIB_VCF"), g("VIB_VCA")
    if f.get("wheel_vco", 0) != 0.35 and not f["sub_vco"]:
        f["wheel_vco"] = T.r4(12 * vco * vco)
    else:
        f["sub_vco"], f["sub_vcf"], f["sub_vca"] = T.r4(12 * vco * vco), T.r4(3 * vcf), T.r4(vca)
    f["sub_hz"] = T.r4(T.expmap(g("VIB_RATE"), 0.5, 100.0))
    f["sub_wave"] = float([0, 1, 2, 3, 5, 4][min(5, max(0, round(g("VIB_WAVE") * 5)))])
    if f["ring_mod"] > 0:
        f["ring_mod"] = T.r4(g("RING_MOD"))
    return f


def main():
    rows = []
    for path in sorted(glob.glob(os.path.join(T.SRC, "*", "*.aupreset"))):
        cat = os.path.basename(os.path.dirname(path))
        name, w, _, _ = T.decode(path)
        if not (re.search(WANT, name, re.I) or cat == "Waveforms"):
            continue
        f, fid, *_ = T.translate(name, w)
        f["master"] = 0.5
        g = lambda k: w[T.G[k]]
        rows.append((cat, name, f, upright(f, g)))
    batch = {"wasm": T.WASM_SNAPSHOT, "presets": []}
    for cat, name, a, b in rows:
        batch["presets"] += [{"id": name + "|inv", "fields": a}, {"id": name + "|up", "fields": b}]
    r = subprocess.run(["node", os.path.join(HERE, "engine.mjs"), "motion"], input=json.dumps(batch), capture_output=True, text=True, check=True)
    m = json.loads(r.stdout)
    print(f"{'category':12s} {'preset':26s} | inverted (translate.py): sub_hz vco_st am  pitch_ct | upright: sub_hz vco_st am  pitch_ct")
    for cat, name, a, b in rows:
        x, y = m[name + "|inv"], m[name + "|up"]
        print(f"{cat:12s} {name[:26]:26s} | {a['sub_hz']:6.1f} {a['sub_vco']:5.2f} {x['am']:.2f} {x['pitch']:6.1f} | {b['sub_hz']:6.1f} {b['sub_vco']:5.2f} {y['am']:.2f} {y['pitch']:6.1f}")


if __name__ == "__main__":
    main()
