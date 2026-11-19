#!/usr/bin/env python3
"""Find Arturia CS-80V channels that reproduce Yamaha's factory preset tones.

    python3 presets/charts/tools/match_arturia.py [--top N]

For each of the 22 tones in presets/charts/yamaha_preset_tones.json, compare its slider
positions (0-10) with every channel of every Arturia preset, reading the stored value x as
lever position 10 x (identity). Prints the closest channels with the per-control residuals,
so recreations stand out and so a different law (inversion, offset, multiplier) shows up as
a systematic residual on one control.
"""
import glob
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "presets", "arturia"))
import translate as t  # noqa: E402

# chart slider -> Arturia per-channel word
WORD = {"speed": "LFO_SPEED", "pwm": "LFO_DEPTH_PWM", "pw": "WIDTH", "noise": "NOISE", "hpf": "CUT_H", "res_h": "RES_H",
        "lpf": "CUT_L", "res_l": "RES_L", "il": "IL", "al": "AL", "fa": "FA", "fd": "FD", "fr": "FR",
        "vcf_level": "LEVEL_VCF", "sine": "SINUS", "a": "A", "d": "D", "s": "S", "r": "R", "level": "VOLUME_VCA",
        "init_bril": "INIT_BRIL", "init_level": "INIT_LEVEL", "after_bril": "AFTER_BRIL", "after_level": "AFTER_LEVEL"}


def channels():
    for path in sorted(glob.glob(os.path.join(t.SRC, "*", "*.aupreset"))):
        name, w, _, nbytes = t.decode(path)
        vp = [int(w[t.G["NUM_PATCH_VOIE"] + i]) for i in range(8)]
        base = max(set(vp), key=vp.count) * t.PATCH_WORDS
        for c in (0, 1):
            b = base + c * t.CH2
            v = {k: w[b + t.CH[a]] for k, a in WORD.items()}
            if w[b + t.CH["ON_SIN"]] < 0.5:
                v["sine"] = 0.0
            wave = w[b + t.CH["SAW_TRI"]]
            v["_saw"] = wave >= 2 / 3
            v["_tri"] = 1 / 3 <= wave < 2 / 3
            v["_square"] = w[b + t.CH["SQR"]] >= 0.5
            yield os.path.relpath(path, t.SRC), ("I", "II")[c], v


def main():
    top = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 3
    tones = json.load(open(os.path.join(ROOT, "presets", "charts", "yamaha_preset_tones.json")))["tones"]
    chans = list(channels())
    for tone in tones:
        s = tone["sliders"]
        scored = []
        for f, c, v in chans:
            wave_ok = (v["_saw"] == tone["saw"]) and ((v["_square"] or v["_tri"]) == tone["square"])
            res = {k: 10 * v[k] - s[k] for k in WORD if s.get(k) is not None}
            # the PWM speed and PW do not matter when the square is off, nor the PWM speed without PWM
            if not tone["square"]:
                res.pop("pw", None), res.pop("pwm", None), res.pop("speed", None)
            elif s["pwm"] < 0.5 and 10 * v["pwm"] < 0.5:
                res.pop("speed", None)
            d = sum(abs(x) for x in res.values()) / len(res) + (0 if wave_ok else 3)
            scored.append((d, f, c, res, wave_ok))
        scored.sort(key=lambda r: r[0])
        print(f"== {tone['tone']}  (square {tone['square']}, saw {tone['saw']})")
        for d, f, c, res, ok in scored[:top]:
            worst = sorted(res.items(), key=lambda kv: -abs(kv[1]))[:5]
            print(f"   {d:5.2f}  {f:45s} ch {c:2s} wave {'ok' if ok else 'differs'}  worst: " +
                  ", ".join(f"{k} {x:+.1f}" for k, x in worst))


if __name__ == "__main__":
    main()
