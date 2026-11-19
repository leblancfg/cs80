"""Transcribe the CS-80 owner's manual channel-panel charts (300 dpi scans).

usage: python3 charts2.py page.png xmin out.json debug.png
Knobs are found as thick horizontal bars (a morphological opening), tracks as long thin
vertical lines. Each chart row has 24 sliders and two switch boxes in the same layout.
Positions are on the printed 0-10 scale: 10 * (bottom - knob) / (bottom - top), where
bottom/top are the knob centre's lowest and highest reachable points (track ends minus the
knob's clearance, measured on knobs that sit at 0 or 10).
"""
import json
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

path, xmin, outp, dbgp = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
im = Image.open(path).convert("L")
A = np.asarray(im) < 120
A[:, :xmin] = False

# knobs and switch fills: survive an opening with a 28 x 6 bar
bars = ndi.binary_opening(A, structure=np.ones((6, 28)))
lab, n = ndi.label(bars)
objs = ndi.find_objects(lab)
knobs = []
for i, sl in enumerate(objs):
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    if 28 <= w <= 75 and 6 <= h <= 16:
        knobs.append({"x": (xs.start + xs.stop) / 2, "y": (ys.start + ys.stop) / 2, "w": w, "h": h})
    elif 25 <= w <= 60 and 30 <= h <= 90:  # a switch box's black half
        knobs.append({"x": (xs.start + xs.stop) / 2, "y": (ys.start + ys.stop) / 2, "w": w, "h": h, "switch": True})

# thin vertical tracks
vert = ndi.binary_opening(A, structure=np.ones((70, 1)))
vlab, vn = ndi.label(vert)
tracks = []
for sl in ndi.find_objects(vlab):
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    if 85 <= h <= 150 and w <= 8:
        tracks.append({"x": (xs.start + xs.stop) / 2, "top": ys.start, "bot": ys.stop - 1})

# rows: cluster tracks by top
tracks.sort(key=lambda t: t["top"])
rows = []
for t in tracks:
    if rows and abs(np.median([u["top"] for u in rows[-1]]) - t["top"]) < 45:
        rows[-1].append(t)
    else:
        rows.append([t])
rows = [r for r in rows if len(r) >= 8]

out = []
img = im.convert("RGB")
d = ImageDraw.Draw(img)
for r in rows:
    top = float(np.median([t["top"] for t in r]))
    bot = float(np.median([t["bot"] for t in r]))
    ks = [k for k in knobs if top - 25 <= k["y"] <= bot + 25]
    sl = sorted([k for k in ks if not k.get("switch")], key=lambda k: k["x"])
    sw = sorted([k for k in ks if k.get("switch")], key=lambda k: k["x"])
    out.append({"top": top, "bot": bot, "knobs": sl, "switches": sw, "tracks": [{"x": t["x"], "top": int(t["top"]), "bot": int(t["bot"])} for t in r]})
    for k in sl:
        d.rectangle([k["x"] - k["w"] / 2, k["y"] - k["h"] / 2, k["x"] + k["w"] / 2, k["y"] + k["h"] / 2], outline=(255, 0, 0), width=3)
    for k in sw:
        d.rectangle([k["x"] - k["w"] / 2, k["y"] - k["h"] / 2, k["x"] + k["w"] / 2, k["y"] + k["h"] / 2], outline=(0, 200, 0), width=3)
    d.line([(xmin, top), (img.width, top)], fill=(0, 160, 255), width=1)
    d.line([(xmin, bot), (img.width, bot)], fill=(0, 160, 255), width=1)
json.dump(out, open(outp, "w"), indent=1)
img.save(dbgp)
for k, r in enumerate(out):
    print(k, round(r["top"]), round(r["bot"]), "knobs", len(r["knobs"]), "switch halves", len(r["switches"]))
