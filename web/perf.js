// cs80v2 performance layer: hardware layout (learned), performance map
// (hardware slot -> macro, raw field or action), macro maths with pickup,
// and the Learn controller wizard. No DOM here, so tools/test_perf.mjs can
// drive it from node. app.js owns the UI and the worklet connection.
(function (root) {
'use strict';

/* ---- hardware slots ----------------------------------------------------------
   kind: 'cont' (fader/knob, any value) or 'btn' (pads, buttons: fire on press) */
const SLOTS = [];
for (let i = 1; i <= 9; i++) SLOTS.push({ id: 's' + i, label: 'S' + i, kind: 'cont', prompt: `Move slider ${i}` });
for (let i = 1; i <= 8; i++) SLOTS.push({ id: 'k' + i, label: 'K' + i, kind: 'cont', prompt: `Turn knob ${i}` });
for (let i = 1; i <= 8; i++) SLOTS.push({ id: 'p' + i, label: 'P' + i, kind: 'btn', prompt: `Hit pad ${i}` });
for (let i = 1; i <= 9; i++) SLOTS.push({ id: 'b' + i, label: 'B' + i, kind: 'btn', prompt: `Press the button under slider ${i}`, optional: true });
const OPTIONAL = [
  ['t_loop', 'Loop', 'Press Loop'],
  ['t_stop', 'Stop', 'Press Stop'], ['t_play', 'Play', 'Press Play'], ['t_rec', 'Rec', 'Press Record'],
];
for (const [id, label, prompt] of OPTIONAL) SLOTS.push({ id, label, kind: 'btn', prompt, optional: true });
const SLOT = Object.fromEntries(SLOTS.map((s) => [s.id, s]));
// controls a keyboard has but cannot send: Learn skips them for that keyboard.
// The Oxygen MKV's button under slider 9 is hard-wired to DAW BUTTON MODE.
const HARDWIRED = { oxygen: ['b9'] };
const HARDWIRED_NOTE = { oxygen: 'The button under slider 9 is skipped: on the Oxygen MKV it only switches DAW button mode.' };

/* ---- macros ------------------------------------------------------------------
   A relative macro maps d in -1..1 (0 = the pickup position) to field values
   around the preset's own value ("base"). Field rules:
     ['tw', lo, hi]      d<0 moves base toward lo, d>0 toward hi
     ['twr', lo, hi]     the same, reversed (d>0 toward lo)
     ['oct', span, lo, hi] base * 2^(d*span), clamped
   extra(d, base, out) adds dependent fields (switches an effect on, etc). */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function rule(r, b, d) {
  if (r[0] === 'twr') return rule(['tw', r[1], r[2]], b, -d); // reversed: up moves toward lo
  if (r[0] === 'tw') {
    const lo = Math.min(r[1], b), hi = Math.max(r[2], b);
    return d < 0 ? b + d * (b - lo) : b + d * (hi - b);
  }
  if (r[0] === 'oct') return clamp(b * Math.pow(2, d * r[1]), r[2], r[3]);
  return b;
}
const both = (f, r) => [['I.' + f, r], ['II.' + f, r]];
const switchOn = (sw, f, on = 1) => (d, base, out) => {
  // turn an effect on while its amount is up, give the preset its switch back at zero
  out[sw] = base[sw] > 0 ? base[sw] : (out[f] > 0.005 ? on : 0);
};
const MACROS = [
  { id: 'brilliance', l: 'Brightness', f: [['brilliance', ['tw', -3, 3]]], u: 'oct' },
  { id: 'lpf', l: 'Cutoff', f: both('lpf_hz', ['oct', 4, 37.1, 20000]), u: 'Hz' },
  { id: 'res', l: 'Resonance', f: both('lpf_res', ['tw', 0, 0.97]) },
  { id: 'hpf', l: 'Low cut', f: both('hpf_hz', ['oct', 4, 26.8, 16155]), u: 'Hz' },
  { id: 'envdepth', l: 'Filter sweep', f: [...both('il', ['tw', 0, 5]), ...both('al', ['tw', 0, 5])], u: 'oct' },
  { id: 'attack', l: 'Attack', f: [...both('a', ['oct', 4, 0.002, 0.885]), ...both('fa', ['oct', 4, 0.002, 0.58])], u: 's' },
  { id: 'release', l: 'Release', f: [...both('r', ['oct', 3, 0.002, 11.5]), ...both('fr', ['oct', 3, 0.002, 11])], u: 's' },
  { id: 'balance', l: 'Balance I/II', f: [['mix', ['twr', -1, 1]]] }, // up = channel I (mix -1), as on the faceplate
  { id: 'vibrato', l: 'Vibrato', f: [['sub_vco', ['tw', 0, 1.5]]], u: 'st' },
  { id: 'chorus', l: 'Chorus', f: [['chorus.chorus_depth', ['tw', 0, 1]]], extra: switchOn('chorus.chorus_on', 'chorus.chorus_depth') },
  { id: 'modspeed', l: 'Chorus speed', f: [['chorus.chorus_hz', ['oct', 2, 0.4, 5]], ['chorus.trem_hz', ['oct', 2, 1.18, 16.3]]], u: 'Hz' },
  { id: 'echomix', l: 'Echo', f: [['fx.echo_mix', ['tw', 0, 1]]], extra: switchOn('fx.echo_mode', 'fx.echo_mix') },
  { id: 'echotime', l: 'Echo time', f: [['fx.echo_time', ['oct', 1.5, 0.03, 1.3]]], u: 's',
    // longer echoes get less feedback so the tail length stays about the same
    extra: (d, base, out) => { out['fx.echo_fb'] = d > 0 ? base['fx.echo_fb'] * (1 - 0.35 * d) : base['fx.echo_fb']; } },
  { id: 'reverb', l: 'Reverb', f: [['fx.reverb_mix', ['tw', 0, 1]]] },
  { id: 'detune', l: 'Detune', f: [['detune_cents', ['tw', -30, 30]]], u: 'ct' },
  { id: 'ring', l: 'Ring mod', f: [['ring_mod', ['tw', 0, 1]]] },
  // absolute: channel pressure for keyboards without aftertouch (the Oxygen MKV has none)
  { id: 'pressure', l: 'Aftertouch (swell)', abs: true },
  { id: 'master', l: 'Volume', abs: true },
];
const ACTIONS = [
  { id: 'preset_prev', l: 'Prev preset' }, { id: 'preset_next', l: 'Next preset' },
  { id: 'bank_prev', l: 'Prev bank' }, { id: 'bank_next', l: 'Next bank' },
  { id: 'fav1', l: 'Favourite 1' }, { id: 'fav2', l: 'Favourite 2' }, { id: 'fav3', l: 'Favourite 3' }, { id: 'fav4', l: 'Favourite 4' },
  { id: 'preset_reset', l: 'Reset preset' },
  { id: 'user_save', l: 'Save to current user slot' },
  { id: 'panic', l: 'Stop all notes' },
];
const MACRO = Object.fromEntries(MACROS.map((m) => [m.id, m]));
const ACTION = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
for (const m of MACROS) m.fields = (m.f || []).map(([f]) => f);

const DEFAULT_MAP = {
  s1: 'brilliance', s2: 'lpf', s3: 'res', s4: 'hpf', s5: 'envdepth', s6: 'attack', s7: 'release', s8: 'balance', s9: 'pressure',
  k1: 'chorus', k2: 'modspeed', k3: 'echomix', k4: 'echotime', k5: 'reverb', k6: 'detune', k7: 'ring', k8: 'master',
  p1: 'preset_prev', p2: 'preset_next', p3: 'bank_prev', p4: 'bank_next', p5: 'fav1', p6: 'fav2', p7: 'fav3', p8: 'fav4',
  t_loop: 'preset_reset', t_stop: 'panic', t_rec: 'user_save',
};

// Performance-wide settings applied after every preset load
const BEND_RANGE = 2;      // semitones up and down
const WHEEL_VIB_MIN = 0.6; // mod wheel vibrato at full travel, semitones (at least)

const DAW_PORT = /mackie|daw|hui/i;
const MIN_SPAN = 0.25;      // pickup: smallest travel that maps to a full side of a macro
const REL_STEP = 1 / 100;   // relative knobs: one tick moves a control by 1% of its travel

/* ---- MIDI sources -----------------------------------------------------------------
   A learned control is {t, ch, n, port?, rel?}:
     t 'cc'   control change n (absolute 0..127, or relative when rel is set)
     t 'note' note n: buttons and pads, fire on press
     t 'pb'   14-bit pitch bend on channel ch (n = 0): Mackie Control faders
   port is the input name it was learned on; a control without one matches any port.
   rel: 'sm' sign-magnitude (Mackie V-pot: 1..63 clockwise, 65..127 counterclockwise),
   'tc' two's complement (1 = +1, 127 = -1), 'bo' offset (65 = +1, 63 = -1),
   false = absolute, undefined = not decided yet (decided from the values it sends).
   HUI faders send CC 0-7 (MSB) then CC 32-39 (LSB) on the DAW port: they learn as
   CC 0-7 and the LSB refines the value. HUI V-pots and switch messages are not
   supported (put the keyboard in an N profile or Preset mode instead). */
const isDawPort = (port) => !!port && DAW_PORT.test(port);
/* A note cannot reveal whether it came from a pad or a key. It is safe as a button
   only when it differs from the keybed by channel or input. keybed is {ch, port?}
   (port '' = any music input); unknown keybeds count as channel 1, the factory
   default. The keybed can reach any note through its octave buttons, so the note
   number never makes a pad safe. */
const KEYBED_DEFAULT = { ch: 0, port: '' };
const clashesWithKeys = (c, port, keybed) => {
  if (c.t !== 'note' || isDawPort(port)) return false;
  const kb = keybed || KEYBED_DEFAULT;
  return c.ch === kb.ch && (!kb.port || !port || port === kb.port);
};
const isTouchNote = (ty, ch, n) => (ty === 0x90 || ty === 0x80) && n >= 104 && n <= 112 && ch !== 9; // Mackie fader touch
const isHuiNoise = (ty, n) => ty === 0xb0 && ((n >= 32 && n <= 39) || n === 15 || n === 47);   // HUI fader LSB, switch zone/port
const isVpot = (c, port) => c.t === 'cc' && c.ch === 0 && c.n >= 16 && c.n <= 23 && isDawPort(port);
const relDelta = (mode, v) => (mode === 'sm' ? (v < 64 ? v : -(v - 64)) : mode === 'tc' ? (v < 64 ? v : v - 128) : v - 64);
const lowP = (v) => v >= 1 && v <= 4, hiN = (v) => v >= 124 && v <= 127;
const boP = (v) => v >= 65 && v <= 68, boN = (v) => v >= 60 && v <= 63;
const relish = (v) => lowP(v) || hiN(v) || boP(v) || boN(v);

/* Relative auto-detect for a CC that only ever sends values near 1/127 or 63/65.
   Absolute controls send each value once, so three equal values out of the last
   four, or a back-and-forth around one centre, mean relative ticks. Any value
   outside those bands means absolute. Mutates c.rel; returns true once decided. */
const relHist = new WeakMap();
function observeRel(c, v, port) {
  if (c.t !== 'cc' || c.rel !== undefined) return true;
  const daw = isDawPort(port);
  const h = relHist.get(c) || [];
  if (!h.length && isVpot(c, port) && (lowP(v) || boP(v) || (v > 4 && v < 16) || (v > 68 && v < 80))) { c.rel = 'sm'; return true; }
  if (!relish(v)) { c.rel = false; relHist.delete(c); return true; }
  h.push(v); relHist.set(c, h);
  const last = h.slice(-4);
  if (last.length >= 3) {
    const counts = {}; for (const x of last) counts[x] = (counts[x] || 0) + 1;
    const rep = Math.max(...Object.values(counts)) >= 3;
    const diffs = last.slice(1).map((x, k) => x - last[k]);
    const rocking = last.length >= 4 && diffs.some((d) => d > 0) && diffs.some((d) => d < 0);
    const all = (f) => last.every(f), some = (f) => last.some(f);
    let mode = null;
    if (all((x) => lowP(x) || hiN(x)) && (rep || (rocking && some(lowP) && some(hiN)))) mode = some(hiN) || !daw ? 'tc' : 'sm';
    else if (all((x) => lowP(x) || boP(x)) && (rep || (rocking && some(lowP) && some(boP)))) mode = some(lowP) || daw ? 'sm' : 'bo';
    else if (all((x) => boP(x) || boN(x)) && (rep || (rocking && some(boP) && some(boN)))) mode = 'bo';
    if (mode) { c.rel = mode; relHist.delete(c); return true; }
  }
  if (h.length >= 6) { c.rel = false; relHist.delete(c); return true; }
  return false;
}

/* bytes -> {t, ch, n, v, on}; v is the raw 7-bit (cc, note velocity) or 14-bit (pb) value */
function decode(bytes) {
  const [stt, d1 = 0, d2 = 0] = bytes;
  const ch = stt & 15, ty = stt & 0xf0;
  if (stt >= 0xf0) return null;
  if (ty === 0xb0) return { t: 'cc', ch, n: d1, v: d2 };
  if (ty === 0x90 || ty === 0x80) return { t: 'note', ch, n: d1, v: d2, on: ty === 0x90 && d2 > 0 };
  if (ty === 0xe0) return { t: 'pb', ch, n: 0, v: d1 | (d2 << 7) };
  return null;
}

/* a message that can be assigned to a control (Assign mode), or null:
   no note-offs, fader touch, HUI noise, SysEx, or the keyboard's own pitch wheel */
function controlOf(bytes, port, keybed) {
  const m = decode(bytes);
  if (!m) return null;
  const ty = bytes[0] & 0xf0, daw = isDawPort(port);
  if (isTouchNote(ty, m.ch, m.n) || (daw && isHuiNoise(ty, m.n))) return null;
  if (m.t === 'note' && !m.on) return null;
  if (clashesWithKeys(m, port, keybed)) return null;
  if (m.t === 'pb' && !daw && m.ch === 0) return null;
  const c = { t: m.t, ch: m.ch, n: m.n };
  if (port) c.port = port;
  if (m.t === 'cc') observeRel(c, m.v, port);
  return c;
}

function targetLabel(t, rawLabel) {
  if (!t || t === 'none') return '-';
  if (MACRO[t]) return MACRO[t].l;
  if (ACTION[t]) return ACTION[t].l;
  if (t.startsWith('field:')) return (rawLabel && rawLabel(t.slice(6))) || t.slice(6);
  return t;
}

/* ---- the layer -----------------------------------------------------------------
   opts.emit(msg): {type:'field', name, value} | {type:'gain', value} | {type:'action', id}
   opts.raw(name): {m, l} for a raw panel field (scale mapping from app.js), or null
   opts.fwd / opts.inv: the panel's scale functions */
function create(opts) {
  const emit = opts.emit;
  let layout = { name: '', controls: {} };   // slot -> {t:'cc'|'note'|'pb', ch, n, port?, rel?, shared?}; keybed? {ch, port}
  let map = { ...DEFAULT_MAP };
  let loaded = {};                          // the preset as loaded, untouched by edits
  let base = {};                            // preset values of every field (by name)
  let cur = {};                             // latest engine values (by name)
  const st = {};                            // slot -> {h, h0, d, picked, last}
  let index = new Map();                    // 'cc:ch:n' -> [{slot, port}]
  const msb = new Map();                    // HUI fader MSB by 'port|ch|n'
  let gain = 1;

  const key = (c) => `${c.t}:${c.ch}:${c.n}`;
  function reindex() {
    index = new Map();
    for (const [slot, c] of Object.entries(layout.controls)) {
      if (!c) continue;
      const k = key(c);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push({ slot, port: c.port || '' });
    }
  }
  /* same port first, then a control learned without a port; a control learned on a
     music port also answers to another music port (the same keyboard under another
     name on another computer), never to or from a DAW port */
  function lookup(m, port) {
    const list = index.get(key(m));
    if (!list) return null;
    let e = list.find((b) => b.port && b.port === port) || list.find((b) => !b.port);
    if (!e && m.t !== 'pb' && !isDawPort(port)) e = list.find((b) => !isDawPort(b.port));
    return e ? e.slot : null;
  }
  const S = (slot) => (st[slot] = st[slot] || { h: null, h0: null, d: 0, picked: false, last: null });
  const isRel = (slot) => { const c = layout.controls[slot]; return !!(c && c.rel); };
  // pickup restarts here; a relative knob has no position, so it restarts in the middle
  function repick(slot, s) {
    if (isRel(slot) && MACRO[map[slot]] && !MACRO[map[slot]].abs) s.h = 0.5;
    s.h0 = s.h; s.d = 0; s.picked = false;
  }
  const repickAll = () => { for (const [slot, s] of Object.entries(st)) repick(slot, s); };

  // new hardware: forget the old controls' positions
  function setLayout(l) {
    layout = { name: (l && l.name) || '', controls: { ...((l && l.controls) || {}) } };
    if (l && l.keybed) layout.keybed = { ch: l.keybed.ch | 0, port: l.keybed.port || '' };
    reindex(); for (const k of Object.keys(st)) delete st[k]; msb.clear();
  }
  function setMap(m) { map = { ...DEFAULT_MAP, ...m }; repickAll(); }

  /* preset loaded: new base, every relative macro picks up where its control is */
  function rebase(values) {
    loaded = { ...values }; base = { ...values }; cur = { ...values };
    repickAll();
  }
  /* Reset preset: every field back to the loaded preset (notes keep playing), and
     every macro picks up again where its control sits, so nothing jumps */
  function resetPreset() {
    const changed = Object.keys(loaded).filter((f) => !(f in cur) || cur[f] !== loaded[f]);
    for (const [name, value] of Object.entries(loaded)) emit({ type: 'field', name, value });
    base = { ...loaded }; cur = { ...loaded };
    repickAll();
    return changed;
  }
  /* engine snapshot changed (any reason): keep cur fresh for raw-field pickup */
  function update(values) { cur = { ...values }; }
  /* a panel edit makes that value the new base; controls on it pick up again */
  function fieldEdited(name, value) {
    base[name] = value; cur[name] = value;
    for (const [slot, t] of Object.entries(map)) {
      const touches = (MACRO[t] && MACRO[t].fields.includes(name)) || t === 'field:' + name;
      if (touches) repick(slot, S(slot));
    }
  }

  function applyMacro(m, d) {
    const out = {};
    for (const [f, r] of m.f) if (f in base) out[f] = rule(r, base[f], d);
    if (m.extra) m.extra(d, base, out);
    for (const [name, value] of Object.entries(out)) { cur[name] = value; emit({ type: 'field', name, value }); }
    return out;
  }

  /* one hardware value (0..1) arriving on a slot */
  function drive(slot, x, pressed) {
    const t = map[slot];
    const s = S(slot);
    const prevH = s.h;
    s.h = x; s.last = Date.now();
    if (!t || t === 'none') return { slot, t: 'none' };
    if (ACTION[t]) {
      // buttons fire on press; a fader assigned to an action fires when pushed past the middle
      const fire = pressed !== undefined ? pressed : (x >= 0.5 && (prevH === null || prevH < 0.5));
      if (fire) emit({ type: 'action', id: t });
      return { slot, t, fired: fire };
    }
    if (t === 'master') {
      gain = x * x; // audio taper; 0 is silent
      emit({ type: 'gain', value: gain });
      return { slot, t, value: gain };
    }
    if (t === 'pressure') {
      emit({ type: 'pressure', value: Math.round(x * 127) });
      return { slot, t, value: x };
    }
    const m = MACRO[t];
    if (m) {
      if (s.h0 === null) s.h0 = prevH === null ? x : prevH; // first touch since load: pick up here
      const h0 = s.h0;
      // value scaling: the travel left on each side covers the macro's range, but at
      // least a quarter of the travel per side so a control parked near an end
      // does not turn every step into a jump
      const d = x >= h0 ? (x - h0) / Math.max(1 - h0, MIN_SPAN) : (x - h0) / Math.max(h0, MIN_SPAN);
      s.d = clamp(d, -1, 1);
      return { slot, t, d: s.d, out: applyMacro(m, s.d) };
    }
    if (t.startsWith('field:')) {
      const name = t.slice(6), r = opts.raw && opts.raw(name);
      if (!r || !(name in cur)) return { slot, t, ignored: true };
      // absolute with pickup: wait until the control reaches (or crosses) the current value
      const target = opts.inv(r.m, cur[name]);
      if (!s.picked) {
        const near = Math.abs(x - target) <= 2.5 / 127;
        const crossed = prevH !== null && (prevH - target) * (x - target) <= 0;
        if (!near && !crossed) { s.pickup = target; return { slot, t, waiting: target }; }
        s.picked = true;
      }
      let value;
      if (r.m[0] === 'bool') value = x >= 0.5 ? 1 : 0;
      else if (r.m[0] === 'enum') value = Math.min(r.m[1].length - 1, Math.floor(x * r.m[1].length));
      else value = opts.fwd(r.m, x);
      cur[name] = value; base[name] = value;
      emit({ type: 'field', name, value });
      return { slot, t, value };
    }
    return { slot, t, ignored: true };
  }

  /* relative ticks: accumulate into a 0..1 position for the slot, then drive it */
  function driveRel(slot, ticks) {
    const t = map[slot], s = S(slot);
    if (ACTION[t]) return drive(slot, ticks > 0 ? 1 : 0, ticks > 0);
    let from = s.h;
    if (t === 'master') { if (from === null) from = Math.sqrt(gain); }
    else if (t === 'pressure') { if (from === null) from = 0; }
    else if (t && t.startsWith('field:')) {
      // a knob without a position has nothing to pick up: start from the current value
      const name = t.slice(6), r = opts.raw && opts.raw(name);
      if (r && name in cur) { from = opts.inv(r.m, cur[name]); s.picked = true; }
    } else if (from === null) from = 0.5;
    if (from === null) from = 0.5;
    s.h = from;
    return drive(slot, clamp(from + ticks * REL_STEP, 0, 1));
  }

  /* raw MIDI from any input (port = its name). Returns the slot result if consumed. */
  function midi(bytes, port) {
    const m = decode(bytes);
    if (!m) return null;
    let slot = lookup(m, port);
    // never take a key: a note on the keybed's channel and input stays playable,
    // whatever an old or imported layout says, unless the user confirmed it in Learn
    if (slot && clashesWithKeys(m, port, layout.keybed) && !layout.controls[slot].shared) return null;
    if (m.t === 'cc') {
      const daw = isDawPort(port);
      if (!slot && daw && m.n >= 32 && m.n <= 39) {
        // HUI fader LSB: refine the fader learned on CC n-32
        const hi = msb.get(`${port}|${m.ch}|${m.n - 32}`);
        slot = lookup({ t: 'cc', ch: m.ch, n: m.n - 32 }, port);
        if (!slot || hi === undefined || isRel(slot)) return null;
        return drive(slot, ((hi << 7) | m.v) / 16383);
      }
      if (!slot) return null;
      const c = layout.controls[slot];
      if (c.rel === undefined && !(SLOT[slot] && SLOT[slot].kind === 'btn')) {
        const decided = observeRel(c, m.v, port);
        if (decided && opts.onLayout) opts.onLayout(layout);
        // still guessing and it looks like relative ticks: hold it rather than jump
        if (!decided) return { slot, t: map[slot], detecting: true };
      }
      if (c.rel) return driveRel(slot, relDelta(c.rel, m.v));
      if (daw && m.n < 8) msb.set(`${port}|${m.ch}|${m.n}`, m.v);
      return SLOT[slot] && SLOT[slot].kind === 'btn' ? drive(slot, m.v / 127, m.v > 0) : drive(slot, m.v / 127);
    }
    if (!slot) return null;
    if (m.t === 'note') {
      if (!m.on) return { slot, t: map[slot], release: true };
      return drive(slot, m.v / 127, true);
    }
    return drive(slot, m.v / 16383); // pb: Mackie fader
  }

  // master volume from the page's own slider
  function setGain(g) { gain = clamp(g, 0, 1); emit({ type: 'gain', value: gain }); }

  return {
    setLayout, setMap, rebase, resetPreset, update, fieldEdited, midi, drive, setGain,
    get layout() { return layout; }, get map() { return map; }, get gain() { return gain; },
    get keybed() { return layout.keybed || null; },
    state: (slot) => S(slot),
    slotFor: (bytes, port) => { const m = decode(bytes); return m ? lookup(m, port) : null; },
    lookup,
    base: () => base,
    loaded: () => loaded,
  };
}

/* ---- Learn wizard ----------------------------------------------------------------
   feed() each raw MIDI message with the name of the input it came from. The first
   step records the keybed's channel and input (one key press). Then the wizard
   captures the first CC, Mackie fader (pitch bend) or note (pads and buttons) that
   is not already taken. Any input works, DAW ports included.
   A pad or button note on the keybed's channel and input is not bound: the wizard
   stops with view().conflict set, and the page offers skipGroup() (skip the pads),
   retry() (after moving the pads to another channel) or allowShared() (bind it
   anyway: keys with that note number will then fire the action). */
const MACKIE_TIP = 'That came from the Mackie/DAW port. It works, but plain MIDI is simpler: put the keyboard in DAW mode with profile N2.';
const KEYBED_STEP = { id: 'kb', label: 'Keys', kind: 'key', prompt: 'Press any key on the keyboard' };
const GROUP = { p: 'pads', b: 'buttons under the sliders', t: 'transport buttons' };
function learner(onChange) {
  let steps = ['kb', ...SLOTS.map((s) => s.id)];
  const slotOf = (id) => (id === 'kb' ? KEYBED_STEP : SLOT[id]);
  let i = 0, captured = {}, keybed = null, hint = '', tip = '', note = '', active = false, t0 = 0, conflict = null, skipped = [];
  const changed = () => onChange && onChange(view());
  function view() {
    const id = steps[i], s = slotOf(id);
    return { active, step: i, total: steps.length, slot: id, prompt: s ? s.prompt : 'Done', optional: s && s.optional,
      group: id && GROUP[id[0]] ? GROUP[id[0]] : null, hint, tip, note: id && id[0] === 'b' ? note : '', conflict: conflict && { ...conflict },
      keybed: keybed && { ...keybed }, captured: { ...captured }, skipped: [...skipped], done: i >= steps.length };
  }
  const key = (c) => `${c.t}:${c.ch}:${c.n}`;
  const samePort = (a, b) => !a.port || !b.port || a.port === b.port;
  const owner = (c) => Object.keys(captured).find((slot) => captured[slot] && key(captured[slot]) === key(c) && samePort(captured[slot], c));
  /* opts.keybed: already known (from the setup guide), so the key step is skipped.
     opts.hardwired: 'oxygen' leaves out that keyboard's HARDWIRED controls */
  function start(from = {}, opts = {}) {
    const out = HARDWIRED[opts.hardwired] || [];
    steps = ['kb', ...SLOTS.map((s) => s.id).filter((id) => !out.includes(id))];
    note = HARDWIRED_NOTE[opts.hardwired] || '';
    active = true; captured = { ...from }; hint = ''; tip = ''; conflict = null; skipped = []; t0 = Date.now();
    keybed = opts.keybed ? { ch: opts.keybed.ch, port: opts.keybed.port || '' } : null;
    i = keybed ? 1 : 0;
    if (opts.skipPads) skipped.push('p');
    while (i < steps.length && skipped.includes(steps[i][0])) i++;
    changed();
  }
  function next() {
    i++; hint = ''; conflict = null; t0 = Date.now();
    while (i < steps.length && skipped.includes(steps[i][0])) i++;
    if (i >= steps.length) active = false;
    changed();
  }
  function feed(bytes, port) {
    if (!active || i >= steps.length) return false;
    const [stt, d1 = 0, d2 = 0] = bytes;
    if (stt >= 0xf0) return true; // SysEx, clock, active sensing: never captured
    const ch = stt & 15, ty = stt & 0xf0, slot = slotOf(steps[i]);
    const daw = isDawPort(port);
    if ((ty === 0x90 && d2 === 0) || ty === 0x80) return false; // note-offs always reach the player: no hanging keys
    if (slot.kind === 'key') {
      if (ty !== 0x90) return ty === 0xb0 || ty === 0xe0;
      if (daw) { hint = 'That note came from the DAW port. Press a key on the keyboard itself.'; changed(); return true; }
      keybed = { ch, port: port || '' };
      return next(), false; // let the key sound
    }
    if (conflict) {
      if (ty === 0x90 && d2 > 0 && !daw && ch === conflict.ch && (!keybed || !keybed.port || port === keybed.port)) return false; // still shared: let it play
    }
    if (daw && !tip && (ty === 0xe0 || isTouchNote(ty, ch, d1) || (ty === 0xb0 && d1 >= 16 && d1 <= 23))) { tip = MACKIE_TIP; changed(); }
    if (isTouchNote(ty, ch, d1)) return true;   // Mackie fader touch, not the fader itself
    if (daw && isHuiNoise(ty, d1)) return true; // HUI fader LSB and switch messages
    let c = null;
    if (ty === 0xe0) {
      if (!daw && ch === 0) return false;       // the keyboard's own pitch wheel
      if (slot.kind === 'btn') { hint = `Got a fader (pitch bend ch ${ch + 1}); this step wants a pad or button.`; changed(); return true; }
      c = { t: 'pb', ch, n: 0 };
    } else if (ty === 0xb0) {
      if (slot.kind === 'btn' && d2 === 0) return true; // button release
      c = { t: 'cc', ch, n: d1 };
    } else if (ty === 0x90 && d2 > 0) {
      if (slot.kind !== 'btn') {
        if (clashesWithKeys({ t: 'note', ch }, port, keybed)) return false; // a key: let it play
        hint = `Got a note (${d1}, ch ${ch + 1}); this step wants a slider or knob.`; changed(); return daw;
      }
      c = { t: 'note', ch, n: d1 };
      if (port) c.port = port;
      if (clashesWithKeys(c, port, keybed)) {
        conflict = { ch, n: d1, control: c, group: GROUP[steps[i][0]] };
        hint = '';
        changed();
        return false; // it is (or may be) a key: it plays
      }
    } else return false;
    if (port) c.port = port;
    const had = owner(c);
    if (had && had !== steps[i]) {
      if (c.t === 'cc' && SLOT[had].kind !== 'btn') observeRel(captured[had], d2, port); // later ticks tell relative from absolute
      if (Date.now() - t0 < 1500) return true; // the previous control still settling
      hint = `${describe(c)} is already learned as ${SLOT[had].label}. ${slot.prompt}, or Skip.`;
      changed(); return true;
    }
    if (c.t === 'cc') { if (slot.kind === 'btn') c.rel = false; else observeRel(c, d2, port); }
    captured[steps[i]] = c;
    next();
    return true;
  }
  return {
    start, feed, view,
    skip() { if (!active) return; if (steps[i] !== 'kb') delete captured[steps[i]]; next(); },
    // skip every remaining step of this group (all pads, say), forgetting what was captured there
    skipGroup() {
      if (!active || i >= steps.length) return;
      if (steps[i] === 'kb') { next(); return; }
      const g = steps[i][0];
      skipped.push(g);
      for (const id of steps) if (id[0] === g && id !== 'kb') delete captured[id];
      i--; next();
    },
    retry() { if (!conflict) return; conflict = null; hint = 'Hit the pad again.'; t0 = Date.now(); changed(); },
    allowShared() {
      if (!conflict) return;
      const c = { ...conflict.control, shared: true };
      captured[steps[i]] = c;
      next();
    },
    back() {
      if (!active || i === 0) return;
      do i--; while (i > 0 && skipped.includes(steps[i][0]));
      hint = ''; conflict = null; changed();
    },
    cancel() { active = false; changed(); },
    finish() { active = false; i = steps.length; changed(); return { ...captured }; },
    get active() { return active; },
    get captured() { return { ...captured }; },
    get keybed() { return keybed && { ...keybed }; },
    idleMs: () => Date.now() - t0,
  };
}

const describe = (c) => !c ? '-' :
  (c.t === 'pb' ? `fader ch${c.ch + 1}` : (c.t === 'cc' ? `CC${c.n}${c.rel ? ' rel' : ''}` : `note ${c.n}`) + (c.ch ? ` ch${c.ch + 1}` : '')) +
  (isDawPort(c.port) ? ' (DAW)' : '') + (c.shared ? ' (shared with keys)' : '');

const api = { SLOTS, SLOT, HARDWIRED, MACROS, MACRO, ACTIONS, ACTION, DEFAULT_MAP, DAW_PORT, BEND_RANGE, WHEEL_VIB_MIN, REL_STEP, KEYBED_DEFAULT, create, learner, targetLabel, describe, rule, decode, controlOf, isDawPort, clashesWithKeys };
root.CS80Perf = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
