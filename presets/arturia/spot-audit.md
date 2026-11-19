# Spot audit

Rendered with the cs80v2 engine (`web/cs80v2.wasm`) from the public library. Beat is the rate the mapped channel II detune makes against channel I on A4, between the lowest partials the two footages share. The engine's voice cards add their own slow beating of about 0.5 to 2 Hz on top, and that shows in the pitch wobble column. Centroid is the held C-major chord's, attack is the time to 90% of its peak, release is from note-off to -20 dB (2 s means it is still sounding). Amp spread is the held chord's RMS variation, which a decaying pluck also raises. Pitch wobble is the held A3's standard deviation in cents.

| Bank | Preset | Origin | Detune (ct) | Feet I/II | Beat on A4 (Hz) | Centroid (Hz) | Attack (s) | Release (s) | Amp spread | Pitch wobble (ct) | Level (dBFS) |
|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Brass | Porcaro Brass (chart) | chart | +0.0 | 8' / 8' | 0.00 | 1090 | 2.25 | 0.10 | 0.12 | 0.0 | -13.0 |
| Brass | Chariots Horn (chart) | chart | +0.0 | 8' / 8' | 0.00 | 1465 | 0.05 | 0.25 | 0.10 | 0.0 | -13.0 |
| Brass | C.L_Funfare | arturia | -4.2 | 8' / 8' | 1.07 | 1194 | 0.85 | 0.20 | 0.22 | 3.1 | -13.0 |
| Strings | Multiple Strings (chart) | chart | +8.0 | 16' / 8' | 2.04 | 590 | 0.15 | 0.45 | 0.22 | 10.2 | -13.0 |
| Strings | Mellow Strings (chart) | chart | -8.0 | 8' / 8' | 2.03 | 616 | 0.25 | 0.10 | 0.21 | 18.7 | -13.0 |
| Strings | K.U_GentleSyn | arturia | +4.5 | 8' / 8' | 1.15 | 1123 | 1.20 | 0.45 | 0.23 | 4.3 | -13.0 |
| Pads | Tears in Rain Swell (chart) | chart | +0.0 | 8' / 8' | 0.00 | 2618 | 1.10 | 1.05 | 0.16 | 18.8 | -13.0 |
| Pads | K.U_HPFsine | arturia | -2.7 | 8' / 8' | 0.69 | 1731 | 0.65 | 0.60 | 0.19 | 1.7 | -13.0 |
| Leads | Yamaha Funky 1 + 2 (chart) | chart | +0.0 | 8' / 8' | 0.00 | 397 | 0.15 | 0.05 | 0.15 | 1.5 | -13.0 |
| Leads | Acc-Shut | arturia | +3.7 | 8' / 8' | 0.95 | 1080 | 0.75 | 0.85 | 0.17 | 4.9 | -13.0 |
| Keys and Organs | Clavichord (chart) | chart | +0.0 | 8' / 8' | one channel | 796 | 0.40 | 0.10 | 0.15 | 0.0 | -13.5 |
| Keys and Organs | Yamaha Organ 1 + 2 (chart) | chart | +0.0 | 8' / 8' | 0.00 | 215 | 0.05 | 0.05 | 0.27 | 3.8 | -13.0 |
| Keys and Organs | C.L_Rhodesesque | arturia | -6.5 | 8' / 8' | 1.66 | 1157 | 0.60 | 0.00 | 0.14 | 2.0 | -13.0 |
| Bass | Yamaha Bass (chart) | chart | +0.0 | 8' / 8' | one channel | 413 | 0.00 | 0.05 | 0.81 | 0.0 | -13.2 |
| Bass | LetsPlayOutside | arturia | -4.2 | 8' / 8' | one channel | 1590 | 0.00 | 0.35 | 0.17 | 0.0 | -13.9 |
| Bells and Plucks | Bells and Gongs (chart) | chart | +0.0 | 8' / 4' | one channel | 734 | 0.40 | 0.10 | 0.14 | 1.0 | -13.0 |
| Bells and Plucks | Pizzicato (chart) | chart | +0.0 | 8' / 8' | one channel | 630 | 0.00 | 0.20 | 0.37 | 2.7 | -17.5 |
| Woodwinds | Clarinet (chart) | chart | +0.0 | 8' / 8' | one channel | 383 | 0.05 | 0.05 | 0.22 | 8.0 | -13.0 |
| Woodwinds | M.L_REED-02 | arturia | -0.0 | 4' / 4' | 0.00 | 1582 | 0.05 | 0.10 | 0.11 | 0.0 | -13.0 |
| FX | Timpani (chart) | chart | +0.0 | 8' / 16' | 0.00 | 283 | 0.00 | 0.95 | 0.31 | 2.4 | -13.0 |
| Sub Osc and Motion | Solo Violin (chart) | chart | +0.0 | 8' / 8' | one channel | 269 | 0.15 | 0.10 | 0.50 | 18.9 | -13.0 |
