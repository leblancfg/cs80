#!/usr/bin/env python3
"""Write pad_at.mid: a ~24 s slow brass/pad study for touch response.

Four slow chords at 60 BPM (4 s each) with varied velocities; poly
aftertouch swells individual chord tones (the CS-80 signature: hold a chord,
press one key harder), then a channel-pressure swell over a whole chord, then
a slow lead with aftertouch vibrato and a ribbon-style fall. Channel 1.
"""
import struct

PPQ = 480
BPM = 60
TEMPO_US = int(60_000_000 / BPM)
ev = []  # (tick, order, bytes)


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


def on(t, k, v): ev.append((t, 1, bytes([0x90, k, v])))
def off(t, k): ev.append((t, 0, bytes([0x80, k, 64])))
def pat(t, k, v): ev.append((t, 2, bytes([0xA0, k, max(0, min(127, v))])))
def cat(t, v): ev.append((t, 2, bytes([0xD0, max(0, min(127, v))])))
def bend(t, v):
    v = max(0, min(16383, v))
    ev.append((t, 2, bytes([0xE0, v & 0x7F, v >> 7])))


def swell(t0, dur, key=None, peak=110, steps=24):
    """rise to peak over the first 60 %, fall back by the end"""
    for i in range(steps + 1):
        x = i / steps
        y = x / 0.6 if x < 0.6 else (1 - x) / 0.4
        t = t0 + int(dur * x)
        v = int(peak * max(0.0, y))
        if key is None:
            cat(t, v)
        else:
            pat(t, key, v)


Q = PPQ  # one beat = 1 s
chords = [
    ([45, 52, 57, 60, 64], [70, 55, 60, 58, 80]),   # Am(add9) spread
    ([41, 48, 53, 57, 60, 65], [72, 58, 62, 60, 66, 84]),
    ([43, 50, 55, 59, 62, 67], [68, 60, 55, 64, 70, 90]),
    ([40, 47, 52, 56, 59, 64], [75, 62, 58, 66, 72, 96]),
]
t = 0
for i, (keys, vels) in enumerate(chords):
    for k, v in zip(keys, vels):
        on(t + 10 * keys.index(k), k, v)  # slight strum
    if i < 3:
        swell(t + Q // 2, 3 * Q, key=keys[-1], peak=120)   # top note swells
        swell(t + Q, 2 * Q, key=keys[-3], peak=80)         # an inner voice later
    else:
        swell(t + Q // 2, 3 * Q, key=None, peak=110)       # whole chord via channel pressure
    for k in keys:
        off(t + 4 * Q - 30, k)
    t += 4 * Q

# slow lead with aftertouch vibrato and a fall at the end
lead = [(69, 2), (72, 1), (71, 1), (76, 3), (74, 1)]
for k, beats in lead:
    on(t, k, 96)
    dur = beats * Q
    swell(t + dur // 4, (dur * 3) // 4, key=k, peak=115)
    off(t + dur - 20, k)
    t += dur
# ribbon fall on a held note
on(t, 76, 100)
for i in range(33):
    bend(t + Q + i * 30, 8192 - i * 250)
off(t + 2 * Q + 400, 76)
bend(t + 3 * Q, 8192)
t += 3 * Q

ev.sort(key=lambda e: (e[0], e[1]))
trk = bytearray(b"\x00\xFF\x51\x03" + TEMPO_US.to_bytes(3, "big"))
last = 0
for tick, _, data in ev:
    trk += vlq(tick - last) + data
    last = tick
trk += b"\x00\xFF\x2F\x00"
with open("pad_at.mid", "wb") as f:
    f.write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, PPQ))
    f.write(b"MTrk" + struct.pack(">I", len(trk)) + trk)
print(f"pad_at.mid: {len(ev)} events, {t / PPQ:.1f} s")
