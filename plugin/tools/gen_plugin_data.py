#!/usr/bin/env python3
"""Generate the plugin's parameter table and factory presets.

Inputs:
  - the engine's field table, patch_init() and the Core presets, dumped by
    dump_fields.cpp (built here with the host compiler);
  - control specs (label, scaling, unit, section) from web/app.js, so the
    plugin and the web page scale every lever the same way;
  - web/presets-library.json (160 sounds, in its order).

Outputs (plugin/ui/face-defs.js: the panel layout block of web/app.js;
plugin/Source/Generated/):
  Params.h   one entry per Patch field. The parameter ID is the field name
             ("I.pwm_hz", "fx.echo_time"), which never changes: hosts save it
             in songs. Ranges are the app's, widened where a preset goes past.
  Presets.h  every library preset resolved to a full field vector, exactly as
             cs80_load_blob() / cs80_load_preset() would build it.

Run: python3 plugin/tools/gen_plugin_data.py
"""
import json, os, re, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
OUT = os.path.join(ROOT, 'plugin/Source/Generated')
SCRATCH = os.environ.get('CS80_SCRATCH', os.path.expanduser('~/scratch/cs80juce'))


def f32(x):
    return struct.unpack('f', struct.pack('f', float(x)))[0]


def dump_engine():
    os.makedirs(SCRATCH, exist_ok=True)
    exe = os.path.join(SCRATCH, 'dump_fields')
    subprocess.check_call(['c++', '-std=c++17', '-O1', '-w', '-o', exe, os.path.join(HERE, 'dump_fields.cpp')])
    return json.loads(subprocess.check_output([exe]))


def parse_app():
    """label, scaling, unit and section for each field the app shows"""
    app = open(os.path.join(ROOT, 'web/app.js')).read()
    seg = app[app.index('const FEET'):app.index('const fwd')]
    consts = {}
    for name, body in re.findall(r"const (\w+) = (\[[^\]]*\])", seg):
        consts[name] = [s for s in re.findall(r"'([^']*)'|\"([^\"]*)\"", body)]
        consts[name] = [a or b for a, b in consts[name]]
    for line in re.findall(r"(?:const |, )(\w+) = (\[[^\]]*\])", seg):
        pass
    specs = {}
    section = None
    for m in re.finditer(r"\['([^']+)', \[|\{ l: '([^']*)'(.*?)\}(?:,|\s*\])", seg):
        if m.group(1):
            section = m.group(1)
            continue
        label, rest = m.group(2), m.group(3)
        fm = re.search(r"f: f\('(\w+)'\)|f: '([\w.]+)'", rest)
        mm = re.search(r"m: \[(.*?)\](?=, |\s*$|\s*\})", rest) or re.search(r"m: \[(.*)\]", rest)
        if not fm or not mm:
            continue
        chan = fm.group(1) is not None
        field = fm.group(1) or fm.group(2)
        raw = mm.group(1)
        kind = re.match(r"'(\w+)'", raw).group(1)
        args = raw.split(',', 1)[1].strip() if ',' in raw else ''
        if kind == 'enum':
            if args.startswith('['):
                opts = re.findall(r"'([^']*)'", args)
            else:
                opts = consts[args.strip()]
            m_ = ('enum', opts)
        elif kind == 'bool':
            m_ = ('bool',)
        else:
            m_ = (kind,) + tuple(float(x) for x in args.split(','))
        um = re.search(r"u: '([^']*)'", rest)
        specs[(chan, field)] = dict(label=label, m=m_, unit=um.group(1) if um else '', section=section)
    return specs


# fields the page has no lever for: scaling, unit, section
EXTRA = {
    'key_track': dict(label='Key track', m=('lin', 1.5), unit='oct', section='Brilliance'),
    'wheel_vco': dict(label='Wheel VCO', m=('sq', 12.0), unit='st', section='Sub oscillator'),
    'fx.echo_damp_hz': dict(label='Echo damp', m=('exp', 500.0, 16000.0), unit='Hz', section='Echo'),
    'fx.echo_taps': dict(label='Echo taps', m=('int', 0, 8), unit='', section='Echo'),
    'fx.echo_pan': dict(label='Echo pan', m=('lin', 1.0), unit='', section='Echo'),
    'fx.echo_darken': dict(label='Echo darken', m=('lin', 2.0), unit='oct', section='Echo'),
    'plate.damp': dict(label='Reverb damp', m=('lin', 0.95), unit='', section='Reverb'),
    'plate.bandwidth': dict(label='Reverb bandwidth', m=('lin', 1.0), unit='', section='Reverb'),
    'plate.predelay_s': dict(label='Reverb predelay', m=('lin', 0.099), unit='s', section='Reverb'),
}

# (map code, lo, hi) in engine units
def base_range(m):
    k = m[0]
    if k == 'lin': return 'lin', 0.0, m[1]
    if k == 'sq': return 'sq', 0.0, m[1]
    if k == 'bip': return 'lin', -abs(m[1]), abs(m[1])
    if k == 'exp': return 'exp', m[1], m[2]
    if k == 'egt': return 'egt', m[1], m[2]
    if k == 'aff': return 'lin', m[1], m[1] + m[2]
    if k == 'int': return 'int', float(m[1]), float(m[2])
    if k == 'bool': return 'bool', 0.0, 1.0
    if k == 'enum': return 'choice', 0.0, float(len(m[1]) - 1)
    raise ValueError(m)


def field_put(kind, name, v):
    """cs80_wasm.cpp field_put(), after the Float32Array blob store"""
    v = f32(v)
    if kind == 1: return 1.0 if v >= 0.5 else 0.0
    if kind == 2:
        u = int(f32(v + 0.5))
        if name.startswith('fe'): u = max(0, min(5, u))
        return float(max(0, min(255, u)))
    return v


def cxx_f(x):
    r = repr(f32(x))
    return (r if ('.' in r or 'e' in r or 'n' in r) else r + '.0') + 'f'


def cxx_str(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def offset_expr(name):
    if name.startswith('I.'): return f'offsetof(Patch, ch[0].{name[2:]})'
    if name.startswith('II.'): return f'offsetof(Patch, ch[1].{name[3:]})'
    if name == 'feet_I': return 'offsetof(Patch, perf.feet[0])'
    if name == 'feet_II': return 'offsetof(Patch, perf.feet[1])'
    if name.startswith('chorus.'): return f'offsetof(Patch, perf.chorus.{name[7:]})'
    if name.startswith('fx.'): return f'offsetof(Patch, fx.{name[3:]})'
    if name.startswith('plate.'): return f'offsetof(Patch, fx.plate.{name[6:]})'
    return f'offsetof(Patch, perf.{name})'


def write_face_defs():
    """the faceplate layout and lever scaling, copied verbatim from web/app.js
    (FEET .. fmt) so the plugin's panel cannot drift from the web page's"""
    app = open(os.path.join(ROOT, 'web/app.js')).read()
    a = app.index('const FEET =')
    b = app.index('// Param id for a control')
    out = os.path.join(ROOT, 'plugin/ui/face-defs.js')
    with open(out, 'w') as f:
        f.write('/* generated by plugin/tools/gen_plugin_data.py from web/app.js; do not edit */\n')
        f.write(app[a:b].rstrip() + '\n')


def main():
    write_face_defs()
    eng = dump_engine()
    fields = eng['fields']
    names = [f[0] for f in fields]
    kinds = [f[1] for f in fields]
    app = parse_app()
    lib = json.load(open(os.path.join(ROOT, 'web/presets-library.json')))

    # resolve the library
    presets = []
    for p in lib['presets']:
        if 'core' in p:
            vals = list(eng['core'][p['core']]['values'])
        else:
            vals = list(eng['init'])
            for k, v in p['fields'].items():
                i = names.index(k)
                vals[i] = field_put(kinds[i], k, v)
        presets.append(dict(bank=p['bank'], name=p['name'], arturia=p.get('origin') == 'arturia', values=vals))

    specs = []
    for i, n in enumerate(names):
        chan = n.startswith('I.') or n.startswith('II.')
        key = (True, n.split('.', 1)[1]) if chan else (False, n)
        s = app.get(key) or EXTRA.get(n)
        if s is None:
            sys.exit(f'no spec for field {n}')
        specs.append(dict(s))

    # names: channel fields get "I "/"II ", effect and modulator fields their
    # section, and labels still duplicated get the section too
    PREFIX = {'Sub oscillator': 'Sub', 'Ring modulator': 'Ring', 'Echo': 'Echo', 'Reverb': 'Reverb'}
    def lc(t): return t[0].lower() + t[1:] if len(t) > 1 and t[1].islower() else t
    for i, n in enumerate(names):
        s = specs[i]
        pre = PREFIX.get(s['section'])
        if pre and not (n.startswith('I.') or n.startswith('II.')):
            if s['label'] == pre: s['label'] = f'{pre} mode'
            elif not s['label'].lower().startswith(pre.lower()): s['label'] = f"{pre} {lc(s['label'])}"
    labels = {}
    for i, n in enumerate(names):
        chan = 'II' if n.startswith('II.') else ('I' if n.startswith('I.') else '')
        labels.setdefault((chan, specs[i]['label']), []).append(i)
    rows = []
    widened = []
    for i, n in enumerate(names):
        s = specs[i]
        chan = 'II' if n.startswith('II.') else ('I' if n.startswith('I.') else '')
        label = s['label']
        if len(labels[(chan, label)]) > 1:
            label = f"{s['section']} {label.lower()}"
        display = f'{chan} {label}' if chan else label
        group = f"{chan} {s['section']}" if chan else s['section']
        mp, lo, hi = base_range(s['m'])
        if kinds[i] == 2 and mp not in ('choice', 'int'):
            mp = 'int'
        vals = [p['values'][i] for p in presets] + [eng['init'][i]] + [c['values'][i] for c in eng['core']]
        vmin, vmax = min(vals), max(vals)
        if mp in ('lin', 'sq', 'exp', 'egt', 'int'):
            if f32(vmin) < f32(lo) or f32(vmax) > f32(hi):
                nlo, nhi = min(lo, vmin), max(hi, vmax)
                if mp in ('exp',) and nlo <= 0:
                    mp = 'sq' if nlo == 0 else 'lin'
                if mp == 'sq' and nlo < 0:
                    mp = 'lin'
                widened.append(f'{n}: [{lo:g}, {hi:g}] -> [{nlo:g}, {nhi:g}]')
                lo, hi = nlo, nhi
        choices = '|'.join(s['m'][1]) if mp == 'choice' else ''
        if mp == 'choice' and vmax > hi:
            sys.exit(f'{n}: preset value {vmax} outside the choices')
        default = min(max(eng['init'][i], lo), hi)
        rows.append(dict(id=n, name=display, group=group, map=mp, lo=lo, hi=hi, default=default,
                         unit=s['unit'], choices=choices, kind=kinds[i]))

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'Params.h'), 'w') as f:
        f.write('/* generated by plugin/tools/gen_plugin_data.py from web/app.js and the engine field table; do not edit */\n')
        f.write('#pragma once\n#include "../ParamSpec.h"\n\nnamespace cs80p {\n\n')
        f.write(f'constexpr int NUM_PARAMS = {len(rows)};\n\n')
        f.write('static ParamSpec const PARAMS[NUM_PARAMS] = {\n')
        for r in rows:
            kind = {0: 'K_FLOAT', 1: 'K_BOOL', 2: 'K_U8'}[r['kind']]
            f.write(f"    {{{cxx_str(r['id'])}, {cxx_str(r['name'])}, {cxx_str(r['group'])}, {kind}, M_{r['map'].upper()}, "
                    f"{cxx_f(r['lo'])}, {cxx_f(r['hi'])}, {cxx_f(r['default'])}, {cxx_str(r['unit'])}, {cxx_str(r['choices'])}, "
                    f"(uint32_t){offset_expr(r['id'])}}},\n")
        f.write('};\n\n}  // namespace cs80p\n')
    with open(os.path.join(OUT, 'Presets.h'), 'w') as f:
        f.write('/* generated by plugin/tools/gen_plugin_data.py from web/presets-library.json; do not edit */\n')
        f.write('#pragma once\n#include "Params.h"\n\nnamespace cs80p {\n\n')
        f.write('struct FactoryPreset { char const* bank; char const* name; bool arturia; float v[NUM_PARAMS]; };\n\n')
        f.write(f'constexpr int NUM_LIBRARY_PRESETS = {len(presets)};\n\n')
        f.write('static FactoryPreset const LIBRARY[NUM_LIBRARY_PRESETS] = {\n')
        for p in presets:
            vs = ','.join(cxx_f(v) for v in p['values'])
            f.write(f"    {{{cxx_str(p['bank'])}, {cxx_str(p['name'])}, {'true' if p['arturia'] else 'false'}, {{{vs}}}}},\n")
        f.write('};\n\n')
        f.write('static float const INIT_VALUES[NUM_PARAMS] = {' + ','.join(cxx_f(v) for v in eng['init']) + '};\n\n')
        f.write('}  // namespace cs80p\n')
    print(f'{len(rows)} params, {len(presets)} presets ({sum(p["arturia"] for p in presets)} Arturia translations)')
    for w in widened:
        print('  widened', w)


if __name__ == '__main__':
    main()
