#!/usr/bin/env python3
"""Summarize raw Arturia CS-80V preset values without assuming a conversion curve."""
from collections import Counter, defaultdict
import glob
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import translate as t

values = defaultdict(list)
for path in sorted(glob.glob(str(Path(t.SRC) / "*" / "*.aupreset"))):
    _, words, _, _ = t.decode(path)
    base = int(words[t.G["NUM_PATCH_VOIE"]]) * t.PATCH_WORDS
    for channel in range(2):
        for name, index in t.CH.items():
            values[f"{('I', 'II')[channel]}.{name}"].append(words[base + channel * t.CH2 + index])
    for name, index in (("DETUNE", t.DETUNE), ("MIXE", t.MIXE)):
        values[name].append(words[base + index])
    for name, index in t.G.items():
        if name in ("NUM_PATCH_VOIE", "AFFECTE_VOIE", "PORTAMENTO_VOIE", "RING_MOD_VOIE", "EFFETS_VOIE",
                    "PAN_VOIE", "VOLUME_VOIE", "DETUNE_VOIE", "TRANSPOSE_VOIE", "ZONE1_INPUT", "ZONE1_INF", "ZONE1_SUP", "ZONE1_MODE"):
            continue
        values[name].append(words[index])

lines = ["# Raw Arturia field distributions", "", "All 768 factory `.aupreset` files; the dominant patch for per-channel fields. These are stored normalized values, not calibrated physical units. q10/q50/q90 are empirical quantiles. A frequent 0, 0.5 or 1 does not by itself prove control direction.", "", "| Field | Min | q10 | q50 | q90 | Max | Exact 0 / 0.5 / 1 |", "|---|---:|---:|---:|---:|---:|---:|"]
for name, vals in values.items():
    s = sorted(vals)
    c = Counter(vals)
    lines.append(f"| {name} | {s[0]:.3f} | {s[76]:.3f} | {s[383]:.3f} | {s[691]:.3f} | {s[-1]:.3f} | {c[0]}/{c[0.5]}/{c[1]} |")
(HERE / "field-distribution.md").write_text("\n".join(lines) + "\n")
print(len(values), "fields,", len(next(iter(values.values()))), "presets")
