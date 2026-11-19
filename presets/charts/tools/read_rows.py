"""Turn detected knobs (charts2.py output) into 24 slider positions + 2 switches per chart row.

usage: python3 charts3.py page.png rows2.json labels(comma-separated) out.json
"""
import json
import sys
import numpy as np
from PIL import Image

COLS = ["speed", "pwm", "pw", "noise", "hpf", "res_h", "lpf", "res_l", "il", "al", "fa", "fd", "fr",
        "vcf_level", "sine", "a", "d", "s", "r", "level", "init_bril", "init_level", "after_bril", "after_level"]
page, rowsp, labels, outp = sys.argv[1:5]
labels = labels.split(",")
A = np.asarray(Image.open(page).convert("L")) < 120
rows = json.load(open(rowsp))
assert len(rows) == len(labels), (len(rows), len(labels))

# column template from every knob on the page
xs = sorted(k["x"] for r in rows for k in r["knobs"])
clusters, cur = [], [xs[0]]
for x in xs[1:]:
    if x - cur[-1] > 30:
        clusters.append(cur)
        cur = [x]
    else:
        cur.append(x)
clusters.append(cur)
cols = [float(np.median(c)) for c in clusters if len(c) >= len(rows) // 3]
if len(cols) != 24:
    print("columns found:", len(cols), [round(c) for c in cols], file=sys.stderr)


def local_knob(cx, top, bot):
    """fallback: the widest dark bar across the track near cx"""
    y0, y1 = int(top - 18), int(bot + 18)
    win = A[y0:y1, int(cx - 22):int(cx + 23)]
    width = win.sum(axis=1)
    ks = np.where(width >= 0.6 * win.shape[1])[0]
    if not len(ks):
        return None
    groups, g = [], [ks[0]]
    for k in ks[1:]:
        if k - g[-1] <= 2:
            g.append(k)
        else:
            groups.append(g)
            g = [k]
    groups.append(g)
    g = max(groups, key=len)
    return y0 + (g[0] + g[-1]) / 2 if len(g) >= 3 else None


out = []
clear = []
for r, label in zip(rows, labels):
    top, bot = r["top"], r["bot"]
    row = {"label": label, "top": top, "bot": bot, "raw": {}, "found": {}}
    for name, cx in zip(COLS, cols):
        near = [k for k in r["knobs"] if abs(k["x"] - cx) < 20]
        if near:
            ky = min(near, key=lambda k: abs(k["x"] - cx))["y"]
            row["found"][name] = "bar"
        else:
            ky = local_knob(cx, top, bot)
            row["found"][name] = "local" if ky is not None else "missing"
        row["raw"][name] = ky
        row.setdefault("xs", {})[name] = cx
    # switches: the two boxes between PW and NOISE; black half above or below the row's middle
    mid = (top + bot) / 2
    sw = sorted(r["switches"], key=lambda k: k["x"])
    gap0, gap1 = cols[2] + 25, cols[3] - 25
    boxes = []
    for k in sw:
        if gap0 < k["x"] < gap1:
            boxes.append((k["x"], k["y"] > mid))
    # fill in a missing box by sampling darkness
    if len(boxes) < 2:
        third = (gap1 - gap0) / 3
        for bx in (gap0 + third * 0.95, gap0 + third * 2.05):
            if any(abs(b[0] - bx) < 40 for b in boxes):
                continue
            box = A[int(top):int(bot), int(bx - 18):int(bx + 18)]
            h = box.shape[0]
            upper, lower = box[: h // 2].mean(), box[h // 2:].mean()
            boxes.append((bx, lower > upper))
    boxes.sort()
    row["square"], row["saw"] = bool(boxes[0][1]), bool(boxes[1][1])
    out.append(row)

# the scans are slightly rotated: fit each row's track ends as lines in x
for row, r in zip(out, rows):
    tx = np.array([t["x"] for t in r["tracks"]], float)
    tt = np.array([t["top"] for t in r["tracks"]], float)
    tb = np.array([t["bot"] for t in r["tracks"]], float)
    keep = (np.abs(tt - np.median(tt)) < 12) & (np.abs(tb - np.median(tb)) < 12)
    row["fit_top"] = np.polyfit(tx[keep], tt[keep], 1).tolist()
    row["fit_bot"] = np.polyfit(tx[keep], tb[keep], 1).tolist()
# distances from the fitted track ends
for row in out:
    row["d"] = {}
    for name, ky in row["raw"].items():
        if ky is None:
            continue
        cx = row["xs"][name]
        t = np.polyval(row["fit_top"], cx); b = np.polyval(row["fit_bot"], cx)
        row["d"][name] = (ky - t, b - ky, b - t)
        clear.append((ky - t, b - ky))
# end clearance: the knob centre stops short of the track ends
# knobs at 0 or 10 form a tight cluster at the smallest distances; take that cluster's median
tops, bots = np.sort([c[0] for c in clear]), np.sort([c[1] for c in clear])
ct = float(np.median(tops[tops < tops[0] + 6]))
cb = float(np.median(bots[bots < bots[0] + 6]))
if len(sys.argv) > 5:  # the same panel drawing on every page: reuse a clearance measured elsewhere
    ct, cb = map(float, sys.argv[5].split(","))
for row in out:
    # per row, when several knobs sit at an end, measure that row's clearance (scan skew and scale)
    ds = sorted(v[1] for v in row["d"].values())
    us = sorted(v[0] for v in row["d"].values())
    cbr = [d for d in ds if d < ds[0] + 5]
    ctr = [u for u in us if u < us[0] + 5]
    cb_row = float(np.median(cbr)) if len(cbr) >= 3 and abs(np.median(cbr) - cb) < 8 else cb
    ct_row = float(np.median(ctr)) if len(ctr) >= 2 and abs(np.median(ctr) - ct) < 8 else ct
    row["clearance_px"] = [round(ct_row, 1), round(cb_row, 1)]
    row["pos"] = {k: (round(float(np.clip(10 * (v[1] - cb_row) / (v[2] - cb_row - ct_row), 0, 10)), 1) if k in row["d"] else None)
                  for k, v in [(k, row["d"].get(k)) for k in row["raw"]]}
    del row["raw"], row["d"], row["xs"]
json.dump({"clearance_px": [float(ct), float(cb)], "rows": out}, open(outp, "w"), indent=1)
print("clearance top/bottom px:", round(ct, 1), round(cb, 1))
for row in out:
    miss = [k for k, v in row["found"].items() if v != "bar"]
    print(f"{row['label']:14s} sq={'ON ' if row['square'] else 'off'} saw={'ON ' if row['saw'] else 'off'} " +
          " ".join(f"{k}={row['pos'][k]}" for k in COLS) + (f"  [fallback: {miss}]" if miss else ""))
