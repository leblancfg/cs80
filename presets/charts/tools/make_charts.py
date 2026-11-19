#!/usr/bin/env python3
"""Write presets/charts/charts.json: published CS-80 panel charts in panel units.

    python3 presets/charts/tools/make_charts.py && node presets/charts/chart_presets.mjs

Channel sliders come from the transcriptions in presets/arturia/charts/sources (Yamaha's
manual pages, read off the scans) or from the panel photos read by eye (Porcaro, Vangelis);
see presets/arturia/CALIBRATION.md for each reading and its uncertainty. Units are the ones
chart_presets.mjs documents: channel sliders 0..10 from the bottom, lower-panel levers 0..10
pulled toward the player, two-way levers -5..+5 from the centre.
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "presets/arturia/charts/sources"
OUT = ROOT / "presets/charts/charts.json"

MANUAL = "https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual"
PORCARO_V4 = "https://www.youtube.com/watch?v=EgDsAAtG5jk&t=107s"
MARINELLI_HW = "https://www.youtube.com/watch?v=GQyRf92gUKA&t=24s"
TEARS = "https://reverbmachine.com/blog/vangelis-tears-in-rain-blade-runner/"
CHARIOTS = "https://lookmumnocomputer.discourse.group/t/vangelis-brass-how-to/3365"

COL = {"PWM speed": "speed", "PWM depth": "pwm", "PW": "pw", "Noise": "noise", "HPF": "hpf", "Res H": "res_h",
       "LPF": "lpf", "Res L": "res_l", "IL": "il", "AL": "al", "VCF A": "fa", "VCF D": "fd", "VCF R": "fr",
       "VCF level": "vcf_level", "Sine": "sine", "VCA A": "a", "VCA D": "d", "VCA S": "s", "VCA R": "r",
       "Level": "level", "Init brill": "init_bril", "Init level": "init_level", "After brill": "after_bril",
       "After level": "after_level"}


def rows(name):
    with open(SRC / name) as fh:
        return list(csv.DictReader(line for line in fh if not line.startswith("#")))


def example(label):
    """one channel of an owner's-manual step-by-step example (pp. 24-27, 50)"""
    r = next(r for r in rows("yamaha-cs80-owners-manual_p24-27_example-patches_transcription.csv") if r["patch"] == label)
    s = {v: float(r[k]) if r[k].strip() not in ("", "n/a") else (10.0 if v == "level" else 0.0) for k, v in COL.items()}
    return {"square": r["square_sw"] == "ON", "saw": r["saw_sw"] == "ON", "sliders": s}, int(r["manual_page"])


SILENT = {"tone": "Organ 1", "sliders": {"level": 0.0}}  # a muted channel, mixed out as well


def solo(bank, name, label, panel, notes, confidence="medium", channel="I"):
    ch, page = example(label)
    mix = -5 if channel == "I" else 5
    chans = {"I": ch, "II": SILENT} if channel == "I" else {"I": SILENT, "II": ch}
    return {"bank": bank, "name": name, "reference": f"Yamaha CS-80 owner's manual (1977), p. {page}: {label}",
            "chart_source": "yamaha-cs80-owners-manual_p24-27_example-patches_transcription.csv",
            "source_urls": [MANUAL], "confidence": confidence, "channels": chans,
            "panel": {"mix": mix, **panel}, "notes": notes}


def tones(bank, name, t1, t2, panel=None, notes=(), confidence="high", ref=None, urls=(MANUAL,)):
    return {"bank": bank, "name": name,
            "reference": ref or f"Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones {t1} (I) and {t2} (II) as panel settings",
            "chart_source": "presets/charts/yamaha_preset_tones.json", "source_urls": list(urls), "confidence": confidence,
            "channels": {"I": {"tone": t1}, "II": {"tone": t2}}, "panel": panel or {}, "notes": list(notes)}


def sl(**kw):
    return {k: float(v) for k, v in kw.items()}


charts = [
    # ---- Steve Porcaro (Toto) ----
    tones("Brass", "Porcaro Brass (chart)", "Brass 1", "Brass 2", ref=(
        "Steve Porcaro's CS-80 brass (Toto 'Africa', 'Human Nature'): the Brass 1 + Brass 2 preset tones. "
        "Porcaro selects BRA 1 / BRA 2 on CS-80 V4 (MusicTech, 1:47); Anthony Marinelli's hardware CS-80 "
        "'Africa' shows the same two tone-selector buttons lit (0:24). Panel values: Yamaha manual pp. 28-30."),
        urls=(PORCARO_V4, MARINELLI_HW, MANUAL), confidence="high",
        panel={"feet_I": "8'", "feet_II": "8'", "detune": 0, "mix": 0},
        notes=["Detune and Mix read at the centre and both Feet at 8' on Porcaro's V4 panel; sub oscillator and ring modulator off"]),
    tones("Brass", "Yamaha Brass 3 (chart)", "Brass 1", "Brass 3", panel={"detune": 0}),
    {"bank": "Brass", "name": "Chariots Horn (chart)",
     "reference": "Vangelis 'Chariots of Fire' horn, panel by Caustic on CS-80 V3 (lookmumnocomputer forum, 2021); read by eye from the screenshot",
     "chart_source": "vangelis_lmnc-forum_caustic_chariots-of-fire-horn_cs80v3.jpg", "source_urls": [CHARIOTS], "confidence": "medium",
     "channels": {
         "I": {"square": False, "saw": True, "sliders": sl(speed=5.3, pwm=0, pw=0, noise=0, hpf=0, res_h=2.1, lpf=4.5, res_l=6.8, il=3.5, al=8.0,
                                                          fa=6.5, fd=8.0, fr=5.9, vcf_level=10, sine=2.9, a=3.3, d=7.3, s=10, r=2.9, level=4.1,
                                                          init_bril=3.9, init_level=3.9, after_bril=3.9, after_level=2.6)},
         "II": {"square": False, "saw": True, "sliders": sl(speed=0.3, pwm=0, pw=0, noise=0, hpf=0.1, res_h=3.5, lpf=4.5, res_l=5.9, il=3.3, al=7.1,
                                                           fa=6.8, fd=8.2, fr=5.3, vcf_level=10, sine=2.3, a=3.7, d=6.0, s=10, r=2.8, level=4.6,
                                                           init_bril=3.1, init_level=4.0, after_bril=3.4, after_level=3.1)}},
     "panel": {"feet_I": "8'", "feet_II": "8'", "detune": 0, "mix": 0},
     "notes": ["Detune lever drawn just off centre (about +0.6 of 5 on V3's own scale, not hardware cents); entered as centre",
               "sub oscillator and ring modulator levers up (off); V3 chorus and delay not copied"]},
    # ---- Vangelis ----
    {"bank": "Pads", "name": "Tears in Rain Swell (chart)",
     "reference": "Vangelis 'Tears in Rain' (Blade Runner) swell, Reverb Machine's CS-80 V4 patch 'Tears in Rain Swell I'; read by eye from the article screenshot",
     "chart_source": "vangelis_reverbmachine_tears-in-rain_cs80v4_2026.jpg", "source_urls": [TEARS], "confidence": "medium",
     "channels": {
         "I": {"square": False, "saw": True, "sliders": sl(speed=3.0, pwm=0, pw=0, noise=0, hpf=0, res_h=0, lpf=4.4, res_l=0, il=10, al=10,
                                                          fa=10, fd=8.3, fr=6.3, vcf_level=10, sine=0, a=10, d=9.4, s=5.7, r=7.2, level=10,
                                                          init_bril=10, init_level=10, after_bril=4.0, after_level=0)},
         "II": {"square": False, "saw": True, "sliders": sl(speed=2.9, pwm=0, pw=0, noise=0, hpf=0, res_h=0, lpf=10, res_l=0, il=0, al=0,
                                                           fa=0, fd=5.9, fr=0, vcf_level=10, sine=0, a=0, d=6.4, s=10, r=0, level=10,
                                                           init_bril=0, init_level=0, after_bril=0, after_level=0)}},
     "panel": {"feet_I": "8'", "feet_II": "8'", "detune": 0, "mix": -4, "sub": {"function": "sine", "speed": 3, "vco": 1.5},
               "touch": {"vco": 6}, "sustain": 4, "portamento": 4, "chorus": {"on": True, "tremolo": False, "speed": 3, "depth": 6}},
     "notes": ["Mix drawn near channel I; channel II's bright, instant layer sits underneath",
               "sub-osc vibrato light, deeper with after-touch (touch VCO pulled about 60%)",
               "V4's Release/Portamento sliders and chorus knobs read approximately"]},
    # ---- Yamaha owner's manual examples, pp. 24-27 and 50 ----
    solo("Brass", "Trumpet (chart)", "Trumpet (B, ch II)", {"sub": {"speed": 5, "vco": 1}},
         ["manual: sub-osc sine, speed about mid, VCO slightly down (vibrato)"], channel="II"),
    solo("Woodwinds", "Clarinet (chart)", "Clarinet (A, ch I)", {"sub": {"speed": 5, "vco": 1}},
         ["manual: sub-osc sine, speed about mid, VCO slightly down (vibrato)"]),
    solo("Woodwinds", "Flute (chart)", "Flute (A, ch I)", {"sub": {"speed": 5, "vcf": 1}},
         ["manual: sub-osc sine, VCF slightly down"]),
    solo("Woodwinds", "Oboe (chart)", "Oboe (A, ch I)", {"sub": {"speed": 5, "vcf": 5}},
         ["manual: sub-osc sine, VCF about mid"]),
    {**solo("Strings", "Multiple Strings (chart)", "Multiple Strings (B, ch II)", {}, [], channel="II"),
     "channels": {"I": example("Multiple Strings (B, ch II)")[0], "II": example("Multiple Strings (B, ch II)")[0]},
     "panel": {"feet_I": "16'", "feet_II": "8'", "detune": 0.4, "mix": 0, "sub": {"speed": 5, "vco": 1}},
     "notes": ["manual text: the same patch on both panels, Feet 16' and 8', 'detuning channel II slightly' (+0.4 of 5 = 8 cents)",
               "sub-osc VCO drawn about 40% down in the diagram; 1 used here (the diagram's mark is ambiguous)"]},
    {"bank": "Strings", "name": "Mellow Strings (chart)",
     "reference": "Yamaha CS-80 owner's manual (1977), p. 50: filled-in example on the blank programming diagram",
     "chart_source": "yamaha-cs80-owners-manual_p24-27_example-patches_transcription.csv", "source_urls": [MANUAL], "confidence": "medium",
     "channels": {"I": example("Mellow Strings (ch I)")[0], "II": example("Mellow Strings (ch II)")[0]},
     "panel": {"feet_I": "8'", "feet_II": "8'", "detune": -0.4, "mix": 0, "sub": {"speed": 3.3, "vco": 1.5},
               "chorus": {"on": True, "tremolo": True, "speed": 3, "depth": 3}},
     "notes": ["felt-pen detune mark slightly flat of centre (about -0.4 of 5 = -8 cents)", "tremolo on, speed and depth about 10 o'clock"]},
    solo("Sub Osc and Motion", "Solo Violin (chart)", "Solo Violin (B, ch II)", {"sub": {"speed": 5, "vcf": 3}, "touch": {"vco": 4}},
         ["manual: sub-osc sine to the VCF, vibrato from after-touch (Touch Response VCO)"], channel="II"),
    solo("Keys and Organs", "Clavichord (chart)", "Clavichord (A, ch I)", {}, ["manual: no sub-osc modulation, PW 90%"]),
    solo("Bells and Plucks", "Bells and Gongs (chart)", "Bells & Gongs (B, ch II)",
         {"feet_II": "4'", "ring": {"speed": 10, "mod": 10, "depth": 0}},
         ["manual: ring modulator Speed and Modulation fully engaged, Feet 4' for bells"], channel="II", confidence="low"),
    solo("Bells and Plucks", "Pizzicato (chart)", "Pizzicato (ch I)", {"sub": {"speed": 4, "vca": 4}},
         ["manual: sub-osc VCA about 40% down"]),
    {"bank": "FX", "name": "Timpani (chart)", "reference": "Yamaha CS-80 owner's manual (1977), p. 27: Timpani (mallet on I, drum on II)",
     "chart_source": "yamaha-cs80-owners-manual_p24-27_example-patches_transcription.csv", "source_urls": [MANUAL], "confidence": "medium",
     "channels": {"I": example("Timpani Mallet (ch I)")[0], "II": example("Timpani Drum (ch II)")[0]},
     "panel": {"feet_I": "8'", "feet_II": "16'", "detune": 0, "mix": 0, "sub": {"speed": 3.5, "vca": 3.5}},
     "notes": ["manual: Feet II at 16', sub-osc to the VCA about 35% down"]},
    # ---- Yamaha preset tones, pp. 28-30 ----
    tones("Strings", "Yamaha Strings 1 + 2 (chart)", "Strings 1", "Strings 2"),
    tones("Keys and Organs", "Yamaha Organ 1 + 2 (chart)", "Organ 1", "Organ 2"),
    tones("Keys and Organs", "Yamaha Electric Piano (chart)", "Electric Piano", "Electric Piano", panel={"mix": -5}),
    tones("Bells and Plucks", "Yamaha Harpsichord 1 + 2 (chart)", "Harpsichord 1", "Harpsichord 2"),
    tones("Bass", "Yamaha Bass (chart)", "Bass", "Bass", panel={"mix": 5}),
    tones("Leads", "Yamaha Funky 1 + 2 (chart)", "Funky 1", "Funky 2"),
    tones("Leads", "Yamaha Funky 3 + 4 (chart)", "Funky 3", "Funky 4"),
    tones("Bells and Plucks", "Yamaha Guitar 1 + 2 (chart)", "Guitar 1", "Guitar 2"),
]

OUT.write_text(json.dumps({"charts": charts}, indent=1) + "\n")
print(f"{len(charts)} charts -> {OUT.relative_to(ROOT)}")
