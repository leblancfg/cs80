#!/usr/bin/env python3
"""Translate Arturia CS-80V / CS-80 V2 factory presets (Logic .aupreset) into cs80v2 patches.

    python3 translate.py            -> cs80v2_presets.json (and decoded.json)

Chunk layout: see mapping.md. Each value is mapped onto a cs80v2 engine field
(web/cs80v2.wasm field names, physical units), using the same curves as
cs80v2/midimap.hpp apply_param(), which follow the Arturia CS-80 V4 manual ranges.
Then every preset is rendered (chord test, tools/engine.mjs) to level-match
`master` to TARGET_DBFS and to pick and rank presets inside each bank.
"""
from __future__ import annotations

import base64
import glob
import json
import math
import os
import plistlib
import re
import shutil
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "Arturia CS80V Factory Presets for Logic - All", "All")
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WASM_SNAPSHOT = os.path.join(HERE, "tools", "cs80v2.wasm")
# Level of the chord test (C3 E3 G3 C4 at velocity 100): RMS over the frames within 20 dB of the
# loudest, the same target as the Core presets (cs80v2/presets.hpp). The engine's output limiter
# (ceiling -1 dBFS) takes the peaks, so plucks and clavs sit as loud as pads.
TARGET_DBFS = -13.0  # first pass only: web/tools/build_library.py sets the shipped level (-18.5 dBFS since v0.1.1)
# Keep the six-note, full-velocity chord near +4 dBFS before the -1 dBFS
# limiter. The old +10 dBFS allowance drove 55/137 curated patches beyond
# 6 dB of gain reduction, flattening their transients on dense chords.
PRE6_MAX = 1.58
MASTER_MAX = 8.0
MASTER0 = 0.1  # first measurement: quiet enough that the limiter stays out of it
BANK_SIZE = 16

# ---- chunk layout (word indices; source: abletoolz cs-80-v.json, see mapping.md) ----
PATCH_WORDS = 142
CH = {  # per channel, channel II = +39
    "RANGE": 0, "WIDTH": 1, "SINUS": 2, "NOISE": 3, "ACCORD": 4,
    "CUT_H": 5, "RES_H": 6, "CUT_L": 7, "RES_L": 8, "LEVEL_VCF": 9, "VOLUME_VCA": 10,
    "INIT_BRIL": 11, "INIT_LEVEL": 12, "AFTER_BRIL": 13, "AFTER_LEVEL": 14,
    "LFO_SPEED": 15, "LFO_DEPTH_PWM": 16, "LFO_WAVE": 17, "LFO_TRIGG": 18, "LFO_SYNC": 19,
    "FA": 20, "FD": 21, "FR": 23, "IL": 24, "AL": 25,
    "A": 26, "D": 27, "S": 28, "R": 29,
    "SAW_TRI": 32, "SQR": 33, "KEYB": 34, "ON_SIN": 35, "ON_HIGH": 36, "ON_LOW": 37, "FILTER_TYPE": 38,
}
CH2 = 39
OSC1_SYNCHRO, OSC2_DERIVE, DETUNE, MIXE = 78, 79, 80, 81
MOD_SLOTS = [(82 + 3 * k, 83 + 3 * k, 84 + 3 * k) for k in range(10)]  # output, input, amount
MOD_OUTPUT_NONE, MOD_INPUTS_OFF = 38, (13, 14)
G = {
    "NUM_PATCH_VOIE": 1136, "AFFECTE_VOIE": 1144, "PORTAMENTO_VOIE": 1152, "RING_MOD_VOIE": 1160,
    "EFFETS_VOIE": 1168, "PAN_VOIE": 1176, "VOLUME_VOIE": 1184, "DETUNE_VOIE": 1192, "TRANSPOSE_VOIE": 1200,
    "WHEEL": 1209, "ZONE1_INPUT": 1211, "ZONE1_INF": 1212, "ZONE1_SUP": 1213, "ZONE1_MODE": 1214,
    "VIB_RATE": 1231, "VIB_VCO": 1232, "VIB_VCF": 1233, "VIB_VCA": 1234, "VIB_WAVE": 1235,
    "RING_A": 1236, "RING_D": 1237, "RING_DEPTH": 1238, "RING_SPEED": 1239, "RING_MOD": 1240,
    "BRILLANCE": 1241, "RESONANCE": 1242,
    "TOUCH_INITIAL": 1243, "TOUCH_SPEED": 1244, "TOUCH_VCO": 1245, "TOUCH_VCF": 1246,
    "KB_BRIL_LOW": 1247, "KB_BRIL_HIGH": 1248, "KB_LEVEL_LOW": 1249, "KB_LEVEL_HIGH": 1250,
    "VOLUME": 1251, "PORTAMENTO": 1252, "CHORUS_SPEED": 1253, "CHORUS_DEPTH": 1254,
    "CHORUS_ON": 1255, "CHORUS_TYPE": 1256, "DELAY_TIME": 1257, "DELAY_FB": 1258, "DELAY_MIX": 1259,
    "DELAY_ON": 1260, "DELAY_SYNC": 1261, "PEDAL_SUSTAIN_ON": 1262, "PEDAL_PORTA_ON": 1263,
    "SUSTAIN_TIME": 1264, "MODUL_TO_VIB": 1265, "SUSTAIN_MODE": 1266, "GLISS": 1267,
    "ARP_MODE": 1270, "ARP_SPEED": 1271, "ARP_PLAY": 1275, "TRAPPE_MULTI": 1278, "ON_RINGMOD": 1345,
}
ZONES = [(1211 + 5 * z, 1212 + 5 * z, 1213 + 5 * z, 1214 + 5 * z) for z in range(4)]  # input, lo, hi, mode


def expmap(x, lo, hi):
    return lo * (hi / lo) ** min(1.0, max(0.0, x))


def egtmap(x, lo, hi):
    """envelope time sliders, as cs80v2/midimap.hpp egtmap(): exponential above a linear start"""
    return lo + (hi - lo) * (100.0 ** min(1.0, max(0.0, x)) - 1.0) / 99.0


def on(x):
    return x >= 0.5  # switches are stored 0.25 / 0.75 and read as on from 0.5


def inv(x):
    """Bottom-panel levers are stored as lever position: 1.0 is the minimum (see mapping.md)."""
    return 1.0 - x


def r4(x):
    return float(f"{x:.4g}")


# DETUNE (word 80). The CS-80's own lever spans about ±1 semitone, linear (owner's manual
# p. 49), but V2's stored value cannot be read that way: a linear ±100-cent reading puts the
# V2 init patches (0.6034) 21 cents flat, all seven M.L organs (0.655) 31 cents out and the
# C.L pianos (0.200) 60 cents out, while Porcaro's Brass 1 + Brass 2 runs with the lever at the
# centre. The fit keeps the order (the patches named for detune sit at 0 and 1) and holds the
# in-tune instruments within a few cents: init 0.6 ct, organs 1.4 ct, pianos 5.4 ct, full
# travel 15 ct. An inference, not a measurement of the plugin; see CALIBRATION.md.
DETUNE_RANGE = 15.0  # cents at either end
DETUNE_POWER = 2.0


def detune_cents(x):
    t = 2.0 * x - 1.0
    return -DETUNE_RANGE * math.copysign(abs(t) ** DETUNE_POWER, t)


# ---- decode ---------------------------------------------------------------------------
def decode(path):
    p = plistlib.load(open(path, "rb"))
    d = p["data"]
    w = list(struct.unpack("<%df" % (len(d) // 4), d[: len(d) // 4 * 4]))
    pathstr = d[5192:5256].split(b"\0")[0].decode("latin-1")
    return p.get("name", os.path.basename(path)[:-9]), w, pathstr, len(d)


FEET_LABEL = ["16'", "8'", "5 1/3'", "4'", "2 2/3'", "2'"]


def channel(w, base, c, notes, drops):
    """One CS-80 channel (base = patch start + c*39) -> cs80v2 fields, prefix I. / II."""
    v = lambda k: w[base + CH[k]]
    pre = ("I.", "II.")[c]
    tag = ("I", "II")[c]
    f = {}
    wave = v("SAW_TRI")  # three-way item: 1/6 off, 1/2 triangle, 5/6 saw
    saw = wave >= 2 / 3
    tri = 1 / 3 <= wave < 2 / 3
    sqr = on(v("SQR"))
    tri_square = tri and not sqr
    if tri:
        # the CS-80 has no triangle; the nearest panel sound is the square (odd harmonics) filtered darker
        drops.add(f"triangle wave (ch {tag}), played as square with the LPF 1.5 octaves lower" if tri_square
                  else f"triangle wave (ch {tag}) dropped, square already on")
        sqr = True
    f[pre + "saw"] = 1.0 if saw else 0.0
    f[pre + "square"] = 1.0 if sqr else 0.0
    f[pre + "noise"] = r4(v("NOISE"))
    f[pre + "pw"] = r4(0.4 * v("WIDTH"))
    f[pre + "pwm_depth"] = r4(0.4 * v("LFO_DEPTH_PWM"))
    f[pre + "pwm_hz"] = r4(expmap(v("LFO_SPEED"), 0.1, 40.0))
    if v("LFO_DEPTH_PWM") > 0.02 and on(v("LFO_SYNC")):
        drops.add(f"tempo-synced PWM speed (ch {tag})")
    if on(v("ON_HIGH")):
        f[pre + "hpf_hz"] = r4(expmap(v("CUT_H"), 26.8, 16155.0))
        f[pre + "hpf_res"] = r4(0.97 * v("RES_H"))
    else:  # HPF switched out: an Arturia extra; the CS-80 HPF is always in, set it fully open
        f[pre + "hpf_hz"] = 26.8
        f[pre + "hpf_res"] = 0.0
    if on(v("ON_LOW")):
        f[pre + "lpf_hz"] = r4(expmap(v("CUT_L"), 37.1, 20000.0))
        f[pre + "lpf_res"] = r4(0.97 * v("RES_L"))
    else:
        f[pre + "lpf_hz"] = 20000.0
        f[pre + "lpf_res"] = 0.0
        notes.add(f"ch {tag}: LPF switched out in Arturia, LPF fully open here")
    if tri_square:
        f[pre + "lpf_hz"] = r4(max(37.1, f[pre + "lpf_hz"] / 2 ** 1.5))
    f[pre + "il"] = r4(5.0 * v("IL"))
    f[pre + "al"] = r4(5.0 * v("AL"))
    f[pre + "fa"] = r4(egtmap(v("FA"), 0.002, 0.58))
    f[pre + "fd"] = r4(egtmap(v("FD"), 0.002, 8.75))
    f[pre + "fr"] = r4(egtmap(v("FR"), 0.002, 11.0))
    f[pre + "vcf_level"] = r4(v("LEVEL_VCF"))
    f[pre + "sine_level"] = r4(v("SINUS") if on(v("ON_SIN")) else 0.0)
    f[pre + "a"] = r4(egtmap(v("A"), 0.002, 0.885))
    f[pre + "d"] = r4(egtmap(v("D"), 0.002, 7.35))
    f[pre + "s"] = r4(v("S"))
    f[pre + "r"] = r4(egtmap(v("R"), 0.002, 11.5))
    f[pre + "level"] = r4(v("VOLUME_VCA"))
    f[pre + "init_bril"] = r4(3.0 * v("INIT_BRIL"))
    f[pre + "init_level"] = r4(v("INIT_LEVEL"))
    f[pre + "after_bril"] = r4(3.0 * v("AFTER_BRIL"))
    f[pre + "after_level"] = r4(v("AFTER_LEVEL"))
    f[pre + "inv"] = 0.0
    audible = v("VOLUME_VCA") > 0.01 and (
        (v("LEVEL_VCF") > 0.01 and (saw or sqr or v("NOISE") > 0.01)) or f[pre + "sine_level"] > 0.01
    )
    return f, audible


def translate(name, w):
    notes, drops = set(), set()
    voice_patch = [int(w[G["NUM_PATCH_VOIE"] + i]) for i in range(8)]
    pnum = max(set(voice_patch), key=voice_patch.count)
    base = pnum * PATCH_WORDS
    f = {}
    chs = []
    for c in (0, 1):
        cf, aud = channel(w, base + c * CH2, c, notes, drops)
        f.update(cf)
        chs.append(aud)
    mixe = w[base + MIXE]
    mix = 1.0 - 2.0 * mixe  # MIXE 1.0 = only channel I; cs80v2 mix -1 = only I
    f["mix"] = r4(mix)
    if mix <= -0.98:
        chs[1] = False
    if mix >= 0.98:
        chs[0] = False
    feet = [min(5, max(0, round(inv(w[base + CH["RANGE"] + c * CH2]) * 5))) for c in (0, 1)]
    f["feet_I"], f["feet_II"] = float(feet[0]), float(feet[1])
    for c in (0, 1):
        x = inv(w[base + CH["RANGE"] + c * CH2]) * 5
        if chs[c] and abs(x - round(x)) > 0.12:
            notes.add(f"ch {('I', 'II')[c]}: Range {w[base + CH['RANGE'] + c * CH2]:.3f} is between footages, snapped to {FEET_LABEL[feet[c]]}")
    sync = on(w[base + OSC1_SYNCHRO])
    if sync and chs[0]:
        drops.add("oscillator sync")
    detune_raw = w[base + DETUNE]
    f["detune_cents"] = r4(detune_cents(detune_raw))
    detune_audible = all(chs)

    g = lambda k: w[G[k]]
    f["brilliance"] = r4(3.0 * (2.0 * inv(g("BRILLANCE")) - 1.0))
    f["resonance"] = r4(max(0.0, 2.0 * inv(g("RESONANCE")) - 1.0))
    f["kbd_bril_low"] = r4(2.0 * (2.0 * inv(g("KB_BRIL_LOW")) - 1.0))
    f["kbd_bril_high"] = r4(2.0 * (2.0 * inv(g("KB_BRIL_HIGH")) - 1.0))
    f["kbd_level_low"] = r4(2.0 * inv(g("KB_LEVEL_LOW")) - 1.0)
    f["kbd_level_high"] = r4(2.0 * inv(g("KB_LEVEL_HIGH")) - 1.0)
    # sub oscillator ("vibrato" in CS-80 V2)
    arturia_wave = min(5, max(0, round(inv(g("VIB_WAVE")) * 5)))  # sine, saw down, saw up, square, noise, S&H
    f["sub_wave"] = float([0, 1, 2, 3, 5, 4][arturia_wave])
    f["sub_hz"] = r4(expmap(inv(g("VIB_RATE")), 0.5, 100.0))
    vco, vcf, vca = inv(g("VIB_VCO")), inv(g("VIB_VCF")), inv(g("VIB_VCA"))
    if on(g("MODUL_TO_VIB")):
        # the mod wheel brings the sub oscillator in; cs80v2 has wheel -> pitch only
        f["sub_vco"] = f["sub_vcf"] = f["sub_vca"] = 0.0
        f["wheel_vco"] = r4(12.0 * vco * vco)
        if vcf > 0.05 or vca > 0.05:
            drops.add("mod wheel to sub-osc VCF/VCA depth")
    else:
        f["sub_vco"] = r4(12.0 * vco * vco)
        f["sub_vcf"] = r4(3.0 * vcf)
        f["sub_vca"] = r4(vca)
        f["wheel_vco"] = 0.35
    # touch response (shared)
    f["init_bend"] = r4(2.0 * inv(g("TOUCH_INITIAL")))
    f["at_sub_speed"] = r4(3.0 * inv(g("TOUCH_SPEED")))
    f["at_sub_vco"] = r4(2.0 * inv(g("TOUCH_VCO")) ** 2)
    f["at_sub_vcf"] = r4(2.0 * inv(g("TOUCH_VCF")))
    # ring modulator: global switch and voice 1's ring switch
    ring = on(g("ON_RINGMOD")) and on(w[G["RING_MOD_VOIE"]])
    f["ring_mod"] = r4(inv(g("RING_MOD")) if ring else 0.0)
    f["ring_a"] = r4(expmap(inv(g("RING_A")), 0.003, 0.53))
    f["ring_d"] = r4(expmap(inv(g("RING_D")), 0.007, 4.5))
    f["ring_depth"] = r4(inv(g("RING_DEPTH")))
    f["ring_hz"] = r4(expmap(inv(g("RING_SPEED")), 0.25, 205.0))
    # left-hand panel
    porta = g("PORTAMENTO") if on(w[G["PORTAMENTO_VOIE"]]) else 0.0
    if on(g("PEDAL_PORTA_ON")) and porta > 0.01:
        notes.add("portamento was pedal-gated in Arturia; always on here")
    f["porta_time"] = r4(2.0 * porta * porta)
    f["gliss"] = 1.0 if on(g("GLISS")) else 0.0
    f["sustain_time"] = r4(9.0 * g("SUSTAIN_TIME") ** 2)
    f["sustain_mode"] = 1.0 if on(g("SUSTAIN_MODE")) else 0.0
    # tremolo / chorus
    ch_on = on(g("CHORUS_ON"))
    trem = on(g("CHORUS_TYPE"))
    f["chorus.chorus_on"] = 1.0 if ch_on and not trem else 0.0
    f["chorus.trem_on"] = 1.0 if ch_on and trem else 0.0
    f["chorus.chorus_hz"] = r4(expmap(g("CHORUS_SPEED"), 0.4, 5.0))
    f["chorus.chorus_depth"] = r4(g("CHORUS_DEPTH"))
    f["chorus.trem_hz"] = r4(expmap(g("CHORUS_SPEED"), 1.18, 16.3))
    f["chorus.trem_depth"] = r4(g("CHORUS_DEPTH"))
    # stereo delay -> cs80v2 echo line (an extra on both sides)
    if on(g("DELAY_ON")) and g("DELAY_MIX") > 0.01 and on(w[G["EFFETS_VOIE"]]):
        f["fx.echo_mode"] = 1.0
        f["fx.echo_time"] = r4(expmap(g("DELAY_TIME"), 0.03, 1.3))
        f["fx.echo_fb"] = r4(0.9 * g("DELAY_FB"))
        f["fx.echo_mix"] = r4(min(0.5, g("DELAY_MIX")))
        if on(g("DELAY_SYNC")):
            notes.add("delay was tempo-synced; time mapped from the knob position")
    else:
        f["fx.echo_mode"] = 0.0
    f["fx.reverb_mix"] = 0.0  # Arturia V2 has no reverb; do not add one to imported patches
    f["pan_spread"] = 0.0

    # ---- Arturia-only dependencies -> fidelity ----
    distinct = sorted(q for q in set(voice_patch) if voice_patch.count(q) >= 2 or q == pnum)
    if len(distinct) > 1:
        drops.add(f"multi mode: voices play patches {distinct}, translated patch {pnum + 1} only")
    # voices are assigned to keyboard zones (AFFECTE_VOIE, 4 = none); differing key ranges make a split
    # (a zone with one voice or an empty key range is a leftover in many factory patches; ignored)
    aff = [int(w[G["AFFECTE_VOIE"] + i]) for i in range(8)]
    assigned = [z for z in set(aff) - {4} if aff.count(z) >= 2 and w[ZONES[z][1]] < w[ZONES[z][2]]]
    ranges = {(round(w[ZONES[z][1]]), round(w[ZONES[z][2]])) for z in assigned}
    split = len(ranges) > 1
    if split:
        drops.add(f"keyboard split ({len(ranges)} zones)")
    tr = [w[G["TRANSPOSE_VOIE"] + i] for i in range(8)]
    if any(abs(t - 0.5) > 0.02 for t in tr):
        drops.add("per-voice transposition")
    arp = on(g("ARP_PLAY"))
    if arp:
        drops.add("arpeggiator")
    mods = []
    for o, i, a in MOD_SLOTS:
        out, inp, amt = int(w[base + o]), int(w[base + i]), w[base + a]
        if out != MOD_OUTPUT_NONE and inp not in MOD_INPUTS_OFF and abs(amt - 0.5) > 0.05:
            mods.append((inp, out, r4(2 * amt - 1)))
    if mods:
        drops.add(f"modulation matrix ({len(mods)} slot{'s' if len(mods) > 1 else ''})")
    if any(on(w[base + CH["FILTER_TYPE"] + c * CH2]) for c in (0, 1) if chs[c]):
        notes.add("Arturia filter-type switch on (meaning unconfirmed; ignored)")

    severe = arp or len(mods) >= 4 or (len(distinct) > 1 and split) or not any(chs)
    if severe:
        fidelity = "skip"
    elif drops:
        fidelity = "approximate"
    else:
        fidelity = "faithful"
    return f, fidelity, sorted(drops), sorted(notes), {"patch": pnum + 1, "mods": mods, "audible": chs,
                                                       "detune_raw": r4(detune_raw),
                                                       "detune_mapping": f"inferred: -{DETUNE_RANGE:g} ct x |2x-1|^{DETUNE_POWER:g}",
                                                       "detune_audible": detune_audible}


# ---- banks ----------------------------------------------------------------------------
BANKS = ["Brass", "Strings", "Pads", "Leads", "Keys and Organs", "Bass", "Bells and Plucks", "Woodwinds", "FX"]
MOTION_BANK = "Sub Osc and Motion"
KW = [
    ("Woodwinds", r"flute|clarinet|oboe|bassoon|sax|reed|recorder|pan ?pipe|woodwind|whistle|ocarina"),
    ("Keys and Organs", r"piano|pno|clav|harpsi|organ|orgue|rhodes|wurli|e-?p\b|epiano|keys?\b|celest|accordion"),
    ("Bells and Plucks", r"bell|pluck|marimba|vibraph|vibes\b|xylo|kalimba|harp\b|koto|pizz|guitar|gtr|mallet|glock|chime|sitar|banjo|steel ?(drum|pan)"),
    ("Brass", r"brass|horn|trumpet|trombone|tuba|cuivre|fanfare|sax"),
    ("Strings", r"string|violin|viola|cello|orchestr|ensemble|cordes"),
    ("Bass", r"bass|basse|bas\b"),
    ("Leads", r"lead|solo|sync"),
    ("Pads", r"pad|nappe|choir|vox|voice|atmos|ambient|sweep|drone"),
]
CAT = {
    "Brasses": "Brass", "Horns": "Brass", "Strings": "Strings", "Pads": "Pads", "Ambient": "Pads", "Textures": "Pads",
    "Leads": "Leads", "Keyboards": "Keys and Organs", "Organs": "Keys and Organs", "Basses": "Bass",
    "Percussives": "Bells and Plucks", "Guitar": "Bells and Plucks", "Woodwind": "Woodwinds", "EFX": "FX",
    "Beats": "FX", "Sequences": "Bells and Plucks", "Polyphonics": "Pads", "FM": "Bells and Plucks",
}


def bank_for(cat, name):
    n = name.lower()
    if cat == "Percussives" and re.search(r"noise|snare|kick|\btom\b|tymp|drum|synare", n):
        return "FX"
    for bank, rx in KW:
        if re.search(rx, n):
            # keep category when the name word is weak (e.g. "bass" in an EFX name stays FX)
            if cat in ("EFX", "Beats") and bank not in ("Bass",):
                return "FX"
            return bank
    return CAT.get(cat)


def display_name(name, internal):
    """Arturia's own preset name, as its browser shows it (underscores included), without
    file-name artefacts: a leading '* ' marker, stray spaces, a trailing backslash, or a name
    cut at a dot (the file 'C.P_I' holds the preset 'C.P_I.F')."""
    n = re.sub(r"\.aupreset$", "", name, flags=re.I)
    n = re.sub(r"^\*\s*", "", n).strip().rstrip("\\").strip()
    inner = internal.rsplit("/", 1)[-1].strip()
    if inner.startswith(n + "."):
        n = inner
    return n


def measure(presets):
    batch = {"wasm": WASM_SNAPSHOT, "presets": [{"id": k, "fields": p["params"]} for k, p in presets.items()]}
    r = subprocess.run(["node", os.path.join(HERE, "tools", "engine.mjs"), "measure"], input=json.dumps(batch),
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def motion(presets):
    batch = {"wasm": WASM_SNAPSHOT, "presets": [{"id": k, "fields": p["params"]} for k, p in presets.items()]}
    r = subprocess.run(["node", os.path.join(HERE, "tools", "engine.mjs"), "motion"], input=json.dumps(batch),
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def traits(p):
    """audible features a bank should show some variety in"""
    f, m = p["params"], p["metrics"]
    t = set()
    if f["sub_vco"] > 0.08 or f["sub_vcf"] > 0.15 or f["sub_vca"] > 0.08:
        t.add("sub-osc")
    if f["ring_mod"] > 0.08:
        t.add("ring mod")
    if any(f[c + "pwm_depth"] > 0.04 and f[c + "square"] > 0 for c in ("I.", "II.")):
        t.add("PWM")
    if any(f[c + "noise"] > 0.1 for c in ("I.", "II.")):
        t.add("noise")
    if any(f[c + "after_bril"] > 0.3 or f[c + "after_level"] > 0.2 or f[c + "init_bril"] > 0.6 for c in ("I.", "II.")) or f["at_sub_vco"] > 0.05:
        t.add("touch")
    if f["chorus.trem_on"] > 0:
        t.add("tremolo")
    if m.get("am", 0) > 0.3 or m.get("pitch_ct", 0) > 12:
        t.add("motion")
    return t


# how much each dropped Arturia feature costs an approximate preset in the bank picker
DROP_COST = [(r"modulation matrix \((\d)", None), (r"triangle", 0.3), (r"tempo-synced", 0.2), (r"mod wheel to", 0.3),
             (r"oscillator sync", 1.0), (r"per-voice transposition", 0.8), (r"multi mode", 1.2), (r"keyboard split", 1.5)]


def drop_cost(p):
    c = 0.0
    for d in p["dropped_features"]:
        for rx, w in DROP_COST:
            mt = re.match(rx, d)
            if mt:
                c += 0.7 * int(mt.group(1)) if w is None else w
                break
        else:
            c += 1.0
    return c


def main():
    if not os.path.exists(WASM_SNAPSHOT) or "--refresh-wasm" in sys.argv:
        os.makedirs(os.path.dirname(WASM_SNAPSHOT), exist_ok=True)
        shutil.copy(os.path.join(ROOT, "web", "cs80v2.wasm"), WASM_SNAPSHOT)
    files = sorted(glob.glob(os.path.join(SRC, "*", "*.aupreset")))
    out = {}
    seen = {}
    for path in files:
        cat = os.path.basename(os.path.dirname(path))
        name, w, ppath, nbytes = decode(path)
        f, fidelity, drops, notes, info = translate(name, w)
        f["master"] = MASTER0
        key = os.path.relpath(path, SRC)
        # duplicates (same patch under two names, e.g. "+o+PANICROOM" and "PANICROOM")
        sig = json.dumps(f, sort_keys=True)
        dup = seen.get(sig)
        seen.setdefault(sig, key)
        out[key] = {
            "name": display_name(name, ppath), "arturia_name": name, "arturia_category": cat, "arturia_file": key,
            "generation": "CS-80 V2" if nbytes == 5396 else "CS-80V", "fidelity": fidelity,
            "dropped_features": drops, "notes": notes, "duplicate_of": dup, "params": f, "_info": info,
        }
    print(f"decoded {len(out)} presets; measuring...", file=sys.stderr)
    m = measure(out)
    for k, p in out.items():
        s = m[k]
        p["metrics"] = {kk: r4(vv) if isinstance(vv, float) else vv for kk, vv in s.items()}
        if not s["finite"] or s["rms"] < 1e-5 or s["lufs"] < -60:
            p["fidelity"] = "skip"
            p["notes"].append("silent or non-finite in cs80v2 chord test")
            continue
        # level scales with master (the voices and effects are linear below the limiter)
        p["params"]["master"] = r4(min(MASTER_MAX, MASTER0 * 10 ** ((TARGET_DBFS - s["dbfs"]) / 20)))
    # second pass at the new level: make up what the limiter took off the chord test, then the
    # peak guard on the worst-case chord, measured before the limiter
    m2 = measure({k: p for k, p in out.items() if p["fidelity"] != "skip"})
    for k, s in m2.items():
        pp = out[k]["params"]
        up = min(10 ** ((TARGET_DBFS - s["dbfs"]) / 20), MASTER_MAX / pp["master"])
        pre6 = s["pre6"] * up
        if pre6 > PRE6_MAX:
            up *= PRE6_MAX / pre6
            out[k]["notes"].append(f"master lowered {20 * math.log10(pre6 / PRE6_MAX):.1f} dB to preserve transients on a six-note low chord at full velocity")
        pp["master"] = r4(pp["master"] * up)
    # confirm, and measure motion (amplitude spread, pitch wobble) for the bank picker
    live = {k: p for k, p in out.items() if p["fidelity"] != "skip"}
    m3 = measure(live)
    mo = motion({k: p for k, p in live.items() if not p["duplicate_of"]})
    for k, s in m3.items():
        mm = out[k]["metrics"]
        mm.update({"level_lufs": r4(s["lufs"]), "level_dbfs": r4(s["dbfs"]), "peak": r4(s["peak"]),
                   "pre6_dbfs": r4(20 * math.log10(s["pre6"] + 1e-9)), "gr6_db": r4(s["gr6"])})
        if k in mo:
            mm["am"], mm["pitch_ct"] = r4(mo[k]["am"]), r4(mo[k]["pitch"])

    # ---- choose banks ----
    TUTORIAL = r"^(vca|vcf|fltr|filtr|filter|lpfilter|hpfilter|lfo|env|osc|tremolo|chorus|noise|init|test|default|matrix)\b|^ring mod (envl|slow)"

    def score(p):
        s = p["metrics"]
        sc = -abs(math.log2(max(s["centroid"], 50) / 1500.0))  # prefer mid brightness
        sc -= 2.0 * max(0.0, s["t90"] - 1.5)                    # very slow builds sell badly in a 3 s test
        sc -= 0.3 * len(p["notes"]) + drop_cost(p)
        sc -= 0.15 * max(0.0, s.get("gr6_db", 0) - 3)           # leans hard on the limiter
        return sc

    def usable(p):
        s = p["metrics"]
        return (p["fidelity"] in ("faithful", "approximate") and not p["duplicate_of"] and p["bank_hint"]
                and (p["bank_hint"] != "Pads" or max(p["params"]["I.r"], p["params"]["II.r"]) >= 0.08)
                and s.get("level_dbfs", -99) > -18 and 120 < s["centroid"] < 7000 and s["t90"] < 2.6 and drop_cost(p) <= 2.5)

    def feat(p):
        s, t = p["metrics"], traits(p)
        return [math.log2(max(s["centroid"], 50) / 1500.0), s["t90"], 1.5 * s["sustainRatio"], 1.5 * s["tailRatio"],
                2 * min(1.0, s.get("am", 0)), math.log1p(s.get("pitch_ct", 0) / 10)] + [0.8 * (x in t) for x in ("sub-osc", "ring mod", "PWM", "noise", "touch")]

    def pick(keys, n):
        """best first, then each next one trades score against distance to what is already in (variety)"""
        keys = sorted(keys, key=lambda k: -score(out[k]))
        if not keys:
            return []
        got, fe = [keys[0]], {k: feat(out[k]) for k in keys}
        while len(got) < n and len(got) < len(keys):
            best, bv = None, -1e9
            for k in keys:
                if k in got:
                    continue
                d = min(math.dist(fe[k], fe[g]) for g in got)
                v = score(out[k]) + 1.5 * min(d, 2.0) + (0.5 if out[k]["fidelity"] == "faithful" else 0)
                if v > bv:
                    best, bv = k, v
            got.append(best)
        return sorted(got, key=lambda k: (out[k]["fidelity"] != "faithful", -score(out[k])))

    sounds = {}
    for k in sorted(out):
        p = out[k]
        if p["fidelity"] == "skip" or p["duplicate_of"]:
            continue
        sig = (p["metrics"].get("level_lufs"), p["metrics"]["centroid"], p["metrics"]["t90"])
        if sig in sounds:
            p["duplicate_of"] = sounds[sig]
        else:
            sounds[sig] = k
    for k, p in out.items():
        p["bank_hint"] = bank_for(p["arturia_category"], p["arturia_name"])
        if p["arturia_category"] in ("Waveforms", "Splits") or re.search(TUTORIAL, p["name"].replace("_", " "), re.I):
            p["bank_hint"] = None
    pool = [k for k, p in out.items() if usable(p)]
    # the motion bank goes first, from every category: sub-oscillator, ring mod or tremolo that you can hear
    moving = [k for k in pool if {"sub-osc", "ring mod", "tremolo"} & traits(out[k]) and "motion" in traits(out[k])]
    chosen = [(MOTION_BANK, slot, k) for slot, k in enumerate(pick(moving, BANK_SIZE), 1)]
    taken = {k for _, _, k in chosen}
    for b in BANKS:
        ks = pick([k for k in pool if out[k]["bank_hint"] == b and k not in taken], BANK_SIZE)
        chosen += [(b, slot, k) for slot, k in enumerate(ks, 1)]
        taken |= set(ks)
    order = BANKS + [MOTION_BANK]
    chosen.sort(key=lambda c: (order.index(c[0]), c[1]))
    picked = {k for _, _, k in chosen}

    def entry(k, bank=None, slot=None):
        p = out[k]
        e = {"bank": bank, "slot": slot, "name": p["name"], "arturia_name": p["arturia_name"],
             "arturia_category": p["arturia_category"], "arturia_file": p["arturia_file"],
             "generation": p["generation"], "fidelity": p["fidelity"], "dropped_features": p["dropped_features"],
             "notes": p["notes"], "params": p["params"],
             "detune_raw": p["_info"]["detune_raw"], "detune_mapping": p["_info"]["detune_mapping"],
             "level_dbfs": p["metrics"].get("level_dbfs"), "level_lufs": p["metrics"].get("level_lufs"),
             "centroid_hz": p["metrics"].get("centroid"), "traits": sorted(traits(p)) if "am" in p["metrics"] else []}
        if bank is None:
            e["bank_hint"] = p.get("bank_hint")
            if p["duplicate_of"]:
                e["duplicate_of"] = p["duplicate_of"]
        return e

    lib = {
        "source": "Arturia CS-80V / CS-80 V2 factory presets (Logic .aupreset), translated by presets/arturia/translate.py",
        "units": "cs80v2 engine fields (web/cs80v2.wasm cs80_field_name), physical units; saw/square are 0 or 1",
        "target_dbfs": TARGET_DBFS,
        "banks": BANKS + [MOTION_BANK],
        "presets": [entry(k, b, s) for b, s, k in chosen],
        "extra": [entry(k) for k in sorted(out) if k not in picked],
    }
    with open(os.path.join(HERE, "cs80v2_presets.json"), "w") as fh:
        json.dump(lib, fh, indent=1, ensure_ascii=False)
    with open(os.path.join(HERE, "decoded.json"), "w") as fh:
        json.dump({k: {"fidelity": p["fidelity"], "info": p["_info"], "metrics": p["metrics"]} for k, p in out.items()}, fh)
    # summary
    from collections import Counter
    print("fidelity (all 768):", dict(Counter(p["fidelity"] for p in out.values())))
    print("banks:", dict(Counter(b for b, _, _ in chosen)), "total", len(chosen))
    for b in BANKS + [MOTION_BANK]:
        ks = [k for bb, _, k in chosen if bb == b]
        tc = Counter(t for k in ks for t in traits(out[k]))
        fc = Counter(out[k]["fidelity"] for k in ks)
        lv = sorted(out[k]["metrics"]["level_dbfs"] for k in ks)
        print(f"  {b:20s} {len(ks):3d}  {dict(fc)}  traits {dict(tc)}  dBFS RMS {lv[0]}..{lv[-1]}")
    dr = Counter(re.sub(r" \(.*|: .*", "", d) for p in out.values() for d in p["dropped_features"])
    print("dropped:", dict(dr))


if __name__ == "__main__":
    main()
