#!/usr/bin/env python3
"""Encode cs80v2 WAV renders to 192 kbps MP3 in out/v2/. uv run --with numpy --with lameenc"""
import glob, os, wave
import numpy as np, lameenc

os.makedirs("out/v2", exist_ok=True)
for p in sorted(glob.glob("wav/v2/final_*.wav")):
    w = wave.open(p)
    pcm = w.readframes(w.getnframes())
    enc = lameenc.Encoder()
    enc.set_bit_rate(192); enc.set_in_sample_rate(w.getframerate()); enc.set_channels(2); enc.set_quality(2)
    data = enc.encode(pcm) + enc.flush()
    out = "out/v2/" + os.path.basename(p)[6:-4] + ".mp3"
    open(out, "wb").write(data)
    x = np.frombuffer(pcm, np.int16).astype(float) / 32768
    print(f"{out}: {len(data)/1e6:.2f} MB, {w.getnframes()/w.getframerate():.1f} s, peak {np.abs(x).max():.2f}, "
          f"rms {20*np.log10(np.sqrt((x**2).mean())):.1f} dBFS")
