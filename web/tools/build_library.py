#!/usr/bin/env python3
"""Assemble the public preset library, web/presets-library.json.

Every bank lists, in this order:
  1. presets built from published CS-80 panel charts (presets/charts/cs80v2_chart_presets.json),
  2. the eight Core sounds built into the engine (cs80v2/presets.hpp), loaded by index,
  3. the earlier scouted sounds (web/presets-scouted.json, from presets/presets.json),
  4. the best calibrated Arturia CS-80V translations (presets/arturia/cs80v2_presets.json),
     as many as fit, so the library holds 128 to 160 sounds.

All but the Core sounds are level-matched here with the Arturia translator's chord test
(presets/arturia/tools/engine.mjs): -13 dBFS RMS over the sounding frames. Two guards keep
the -1 dBFS output limiter from flattening plucks: at most GR4_MAX of gain reduction on that
chord, and the six-note full-velocity stress chord at most PRE6_MAX before the limiter.
A sound that hits a guard stays quieter than -13 dBFS. The Core masters live in presets.hpp
and are only measured.

    python3 web/tools/build_library.py
"""
import json
import math
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
WASM = WEB / "cs80v2.wasm"
ENGINE = ROOT / "presets/arturia/tools/engine.mjs"
CHARTS = ROOT / "presets/charts/cs80v2_chart_presets.json"

BANKS = ["Brass", "Strings", "Pads", "Leads", "Keys and Organs", "Bass", "Bells and Plucks", "Woodwinds", "FX",
         "Sub Osc and Motion"]
TOTAL_MAX = 160
BANK_TARGET = 14   # Arturia translations fill a bank up to this size...
ARTURIA_MIN = 2    # ...and every bank keeps at least this many of them
TARGET_DBFS = -13.0
CEIL = 0.891251    # the limiter's ceiling, -1 dBFS (cs80v2/dsp.hpp OutLimiter)
GR4_MAX = 8.0      # dB of limiting allowed on the level chord; the Core clav takes 10
PRE6_MAX = 3.16    # +10 dBFS before the limiter on the six-note stress chord
MASTER_MAX = 8.0

# Core sounds (cs80v2/presets.hpp, in engine order) and the bank each one sounds like
CORE_BANK = {
    "Blade Runner Brass": ("Brass", "Vangelis, Blade Runner: Brass 1 + Brass 2 style pair with touch-driven swells"),
    "Chariots": ("Brass", "Vangelis, Chariots of Fire style brass lead, line II an octave up"),
    "Strings 1+4 (Africa)": ("Strings", "Toto, Africa: factory Strings 1 + Strings 4 (Reverb Machine's recipe)"),
    "Strings 1+Brass 2": ("Strings", "Michael Jackson, Human Nature / Billie Jean vamp: Strings 1 + Brass 2"),
    "Organ 1+2": ("Keys and Organs", "Organ 1 + Organ 2 with chorus and tremolo (Don Airey, Mr Crowley)"),
    "Funky Clav": ("Keys and Organs", "Funky / Clavichord pluck from AL with a short filter decay"),
    "Bass + Sub Saw": ("Sub Osc and Motion", "Paul McCartney, Wonderful Christmastime: Bass tone with the sub oscillator's saw on the filters"),
    "Blade Runner Pad": ("Pads", "Vangelis, Blade Runner: slow PWM pad with ring-mod breathing"),
}
# scouted sounds: old bank names, and the ones that fit another bank better
SCOUTED_BANK_RENAMES = {"Pads and Atmospheres": "Pads", "FX and Soundtrack": "FX"}
SCOUTED_MOVES = {
    "Sax Lead (Blade Runner Blues)": "Woodwinds",   # a saxophone
    "Reed Lead": "Woodwinds",                       # nasal reed tone
    "Harmonica Lead": "Woodwinds",                  # free reed, initial-touch twang
    "Winwood Flute Keys": "Woodwinds",              # the CS-80 Flute tone
    "Vibraphone Keys": "Bells and Plucks",          # a mallet sound
    "Breathing Pad (ring mod)": "Sub Osc and Motion",  # the ring modulator is the point
    "Tape Pad": "Sub Osc and Motion",               # sub-oscillator wobble
    "Mutiny on the Bounty Pad": "Pads",
    "Jon and Vangelis Pad": "Pads",
    "Opera Sauvage Texture": "Pads",
    "China Texture": "Pads",
}


def measure(presets):
    batch = {"wasm": str(WASM), "presets": presets}
    r = subprocess.run(["node", str(ENGINE), "measure"], input=json.dumps(batch), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def core_presets():
    r = subprocess.run(["node", str(ROOT / "presets/arturia/tools/core_fields.mjs"), str(WASM)],
                       capture_output=True, text=True, check=True)
    out = []
    for p in json.loads(r.stdout)["presets"]:
        i, name = p["id"].split(" ", 1)
        bank, ref = CORE_BANK[name]
        out.append({"bank": bank, "name": name, "origin": "core", "core": int(i), "reference": ref,
                    "confidence": "recipe", "notes": [], "_fields": p["fields"]})
    return out


def scouted_presets():
    out = []
    for p in json.loads((WEB / "presets-scouted.json").read_text())["presets"]:
        bank = SCOUTED_MOVES.get(p["name"], SCOUTED_BANK_RENAMES.get(p["bank"], p["bank"]))
        q = {k: p[k] for k in ("name", "confidence", "reference", "notes") if k in p}
        q.update({"bank": bank, "origin": "scouted", "fields": dict(p["fields"])})
        out.append(q)
    return out


def chart_presets():
    if not CHARTS.exists():
        return []
    out = []
    for p in json.loads(CHARTS.read_text())["presets"]:
        q = dict(p)
        q["origin"] = "chart"
        q["fields"] = dict(p["fields"])
        out.append(q)
    return out


def arturia_presets():
    lib = json.loads((ROOT / "presets/arturia/cs80v2_presets.json").read_text())
    by_bank = {}
    for p in lib["presets"]:  # best first inside each bank (translate.py)
        q = {k: p[k] for k in ("name", "arturia_name", "arturia_category", "arturia_file", "generation", "fidelity",
                               "dropped_features", "notes", "detune_raw", "detune_cents_mapped", "detune_mapping") if k in p}
        q.update({"bank": p["bank"], "origin": "arturia", "fields": dict(p["params"])})
        by_bank.setdefault(p["bank"], []).append(q)
    return by_bank


def level(presets):
    """set master so the chord test sits at TARGET_DBFS within the two limiter guards"""
    ids = {str(k): p for k, p in enumerate(presets)}
    run = lambda: measure([{"id": k, "fields": p["fields"]} for k, p in ids.items()])
    m = run()
    for k, p in ids.items():
        s, f = m[k], p["fields"]
        if not s["finite"] or s["rms"] < 1e-5:
            raise SystemExit(f"{p['bank']} / {p['name']}: silent or non-finite in the chord test")
        f["master"] = min(MASTER_MAX, f.get("master", 0.5) * 10 ** ((TARGET_DBFS - s["dbfs"]) / 20))
    # the limiter makes level nonlinear in master: refine until every sound has settled within
    # 0.2 dB (resonant chart patches start deep in the limiter and need several steps)
    for _ in range(8):
        m = run()
        settled = True
        for k, p in ids.items():
            s, f = m[k], p["fields"]
            up = min(10 ** ((TARGET_DBFS - s["dbfs"]) / 20), MASTER_MAX / f["master"],
                     CEIL * 10 ** (GR4_MAX / 20) / s["pre4"], PRE6_MAX / s["pre6"])
            f["master"] = float(f"{f['master'] * up:.4g}")
            settled = settled and abs(20 * math.log10(up)) < 0.2
        if settled:
            break
    m = run()
    for k, p in ids.items():
        p["level_dbfs"] = round(m[k]["dbfs"], 1)
        p["gr4_db"] = round(m[k]["gr4"], 1)
        p["gr6_db"] = round(m[k]["gr6"], 1)


def main():
    charts, core, scouted, arturia = chart_presets(), core_presets(), scouted_presets(), arturia_presets()
    legacy = Counter(p["bank"] for p in charts + core + scouted)
    unknown = set(legacy) - set(BANKS)
    if unknown:
        raise SystemExit(f"unknown banks: {unknown}")
    quota = {b: min(len(arturia.get(b, [])), max(ARTURIA_MIN, BANK_TARGET - legacy[b])) for b in BANKS}
    # trim the largest Arturia quotas until the library fits
    while sum(legacy.values()) + sum(quota.values()) > TOTAL_MAX:
        b = max(BANKS, key=lambda b: (quota[b] > ARTURIA_MIN, legacy[b] + quota[b]))
        if quota[b] <= ARTURIA_MIN:
            raise SystemExit("cannot fit the library under TOTAL_MAX")
        quota[b] -= 1
    picked = [p for b in BANKS for p in arturia.get(b, [])[:quota[b]]]

    level(charts + scouted + picked)
    cm = measure([{"id": str(k), "fields": p["_fields"]} for k, p in enumerate(core)])
    for k, p in enumerate(core):
        p["level_dbfs"] = round(cm[str(k)]["dbfs"], 1)
        p["gr4_db"] = round(cm[str(k)]["gr4"], 1)
        p["gr6_db"] = round(cm[str(k)]["gr6"], 1)
        del p["_fields"]

    order = {"chart": 0, "core": 1, "scouted": 2, "arturia": 3}
    by_bank = {b: [] for b in BANKS}
    for p in sorted(charts + core + scouted + picked, key=lambda p: (BANKS.index(p["bank"]), order[p["origin"]])):
        by_bank[p["bank"]].append(p)
    presets = []
    for b in BANKS:
        names = Counter(p["name"].casefold() for p in by_bank[b])
        dup = [n for n, c in names.items() if c > 1]
        if dup:
            raise SystemExit(f"{b}: duplicate names {dup}")
        for slot, p in enumerate(by_bank[b], 1):
            p["slot"] = slot
            presets.append(p)
    out = {"source": "cs80v2 public preset library: chart presets, Core, earlier scouted sounds, calibrated Arturia CS-80V translations",
           "target_dbfs": TARGET_DBFS, "banks": BANKS, "presets": presets}
    (WEB / "presets-library.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    n = Counter((p["bank"], p["origin"]) for p in presets)
    print(f"{len(presets)} presets: " + ", ".join(f"{o} {sum(1 for p in presets if p['origin'] == o)}" for o in order))
    for b in BANKS:
        lv = sorted(p["level_dbfs"] for p in by_bank[b])
        print(f"  {b:20s} {len(by_bank[b]):3d}  " + " ".join(f"{o} {n[(b, o)]}" for o in order) + f"  dBFS {lv[0]}..{lv[-1]}")
    if not 128 <= len(presets) <= TOTAL_MAX:
        sys.exit(f"library size {len(presets)} outside 128..{TOTAL_MAX}")


if __name__ == "__main__":
    main()
