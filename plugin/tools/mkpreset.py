#!/usr/bin/env python3
"""mkpreset.py INDEX: the library preset INDEX (web/presets-library.json order) as ref_render's preset.txt."""
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
lib = json.load(open(os.path.join(here, '../../web/presets-library.json')))
p = lib['presets'][int(sys.argv[1])]
if 'core' in p:
    print('core', p['core'])
else:
    print('blob')
    for k, v in p['fields'].items():
        print(k, repr(float(v)))
