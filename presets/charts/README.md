# Chart presets

cs80v2 presets built straight from published CS-80 panel settings. `tools/make_charts.py` writes `charts.json` (panel positions as read, in CS-80 panel units); `chart_presets.mjs` turns each chart into engine fields through cs80v2's own panel curves and writes `cs80v2_chart_presets.json`. `web/tools/build_library.py` puts them first in their banks. Readings, uncertainties and the calibration they feed are in `../arturia/CALIBRATION.md`.

    python3 presets/charts/tools/make_charts.py && node presets/charts/chart_presets.mjs

| Bank | Preset | Source | Confidence |
|---|---|---|---|
| Brass | Porcaro Brass (chart) | Steve Porcaro's CS-80 brass (Toto 'Africa', 'Human Nature'): the Brass 1 + Brass 2 preset tones. Porcaro selects BRA 1 / BRA 2 on CS-80 V4 (MusicTech, 1:47); Anthony Marinelli's hardware CS-80 'Africa' shows the same two tone-selector buttons lit (0:24). Panel values: Yamaha manual pp. 28-30. [1](https://www.youtube.com/watch?v=EgDsAAtG5jk&t=107s) [2](https://www.youtube.com/watch?v=GQyRf92gUKA&t=24s) [3](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Brass | Yamaha Brass 3 (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Brass 1 (I) and Brass 3 (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Brass | Chariots Horn (chart) | Vangelis 'Chariots of Fire' horn, panel by Caustic on CS-80 V3 (lookmumnocomputer forum, 2021); read by eye from the screenshot [1](https://lookmumnocomputer.discourse.group/t/vangelis-brass-how-to/3365) | medium |
| Pads | Tears in Rain Swell (chart) | Vangelis 'Tears in Rain' (Blade Runner) swell, Reverb Machine's CS-80 V4 patch 'Tears in Rain Swell I'; read by eye from the article screenshot [1](https://reverbmachine.com/blog/vangelis-tears-in-rain-blade-runner/) | medium |
| Brass | Trumpet (chart) | Yamaha CS-80 owner's manual (1977), p. 24: Trumpet (B, ch II) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Woodwinds | Clarinet (chart) | Yamaha CS-80 owner's manual (1977), p. 24: Clarinet (A, ch I) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Woodwinds | Flute (chart) | Yamaha CS-80 owner's manual (1977), p. 25: Flute (A, ch I) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Woodwinds | Oboe (chart) | Yamaha CS-80 owner's manual (1977), p. 26: Oboe (A, ch I) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Strings | Multiple Strings (chart) | Yamaha CS-80 owner's manual (1977), p. 26: Multiple Strings (B, ch II) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Strings | Mellow Strings (chart) | Yamaha CS-80 owner's manual (1977), p. 50: filled-in example on the blank programming diagram [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Sub Osc and Motion | Solo Violin (chart) | Yamaha CS-80 owner's manual (1977), p. 25: Solo Violin (B, ch II) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Keys and Organs | Clavichord (chart) | Yamaha CS-80 owner's manual (1977), p. 26: Clavichord (A, ch I) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Bells and Plucks | Bells and Gongs (chart) | Yamaha CS-80 owner's manual (1977), p. 26: Bells & Gongs (B, ch II) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | low |
| Bells and Plucks | Pizzicato (chart) | Yamaha CS-80 owner's manual (1977), p. 27: Pizzicato (ch I) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| FX | Timpani (chart) | Yamaha CS-80 owner's manual (1977), p. 27: Timpani (mallet on I, drum on II) [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | medium |
| Strings | Yamaha Strings 1 + 2 (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Strings 1 (I) and Strings 2 (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Keys and Organs | Yamaha Organ 1 + 2 (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Organ 1 (I) and Organ 2 (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Keys and Organs | Yamaha Electric Piano (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Electric Piano (I) and Electric Piano (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Bells and Plucks | Yamaha Harpsichord 1 + 2 (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Harpsichord 1 (I) and Harpsichord 2 (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Bass | Yamaha Bass (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Bass (I) and Bass (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Leads | Yamaha Funky 1 + 2 (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Funky 1 (I) and Funky 2 (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Leads | Yamaha Funky 3 + 4 (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Funky 3 (I) and Funky 4 (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
| Bells and Plucks | Yamaha Guitar 1 + 2 (chart) | Yamaha CS-80 owner's manual (1977), pp. 28-30: preset tones Guitar 1 (I) and Guitar 2 (II) as panel settings [1](https://archive.org/details/synthmanual-yamaha-cs-80-owners-manual) | high |
