// cs80v2 browser test build: UI, MIDI and keyboard input, preset browser.
// The engine runs in cs80-worklet.js; this thread only sends messages.
'use strict';

const VERSION = '0.1.1';
const $ = (id) => document.getElementById(id);
const status = (msg, cls = '') => { const s = $('status'); s.textContent = msg; s.className = 'status ' + cls; };

let ctx = null, node = null;
let info = null;            // 'ready' message from the worklet: fields, params, presets, defaults
let fieldIx = {};           // field name -> index
let values = null;          // latest patch snapshot (Float32Array)
let patchName = '';
let library = null;         // public library: chart, Core, earlier and translated presets, by bank
async function loadLibrary() {
  const j = await fetch('presets-library.json?v=9').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return j && Array.isArray(j.presets) && j.presets.length ? { kind: 'public', presets: j.presets } : null;
}
// the bank shown in the browser and the index loaded from it (-1: nothing from this bank is
// loaded, e.g. an empty User bank); loaded is the preset object the sound came from
let current = { bank: null, index: 0 }; // the library's first bank once it loads
let loaded = null;
const send = (m) => node && node.port.postMessage(m);

/* ---- control definitions ----------------------------------------------------
   m: how the engine scales a 0..1 control (mirrors apply_param in
   cs80v2/midimap.hpp; used here only to place faders and to drive the
   field-only controls). p: the midimap Param that the fader sends.
   pl: the engraved panel label; cap: lever cap colour as on the CS-80
   (w white, s grey, g green, r red, y yellow, k black; x = echo, reverb and master, grey);
   sc: scale legend [top, bottom]. Layout and colours follow the faceplate
   (see README for the photo and diagrams used). */
const FEET = ["16'", "8'", "5 1/3'", "4'", "2 2/3'", "2'"];
const SUBW = ['sine', 'saw down', 'saw up', 'square', 'S&H', 'noise'];
const LONG = ['LONG', 'SHORT'], FAST = ['FAST', 'SLOW'], HIGH = ['HIGH', 'LOW'], PM = ['+', '−'];
const ch = (c) => {
  const f = (n) => (c ? 'II.' : 'I.') + n;
  return [
    ['VCO', [
      { l: 'PWM speed', pl: 'Speed', f: f('pwm_hz'), p: 'P_PWM_SPEED', m: ['exp', 0.1, 40], u: 'Hz', ch: c, cap: 'w', sc: FAST },
      { l: 'PWM', f: f('pwm_depth'), p: 'P_PWM', m: ['lin', 0.4], ch: c, cap: 'g' },
      { l: 'PW', f: f('pw'), p: 'P_PW', m: ['lin', 0.4], u: 'pw', ch: c, cap: 'g', sc: ['90%', '50%'] },
      { l: 'Square', pl: '⊓ Sq', f: f('square'), p: 'P_SQUARE', m: ['lin', 1], ch: c, cap: 'k', lvl: 1 },
      { l: 'Saw', pl: '∕| Saw', f: f('saw'), p: 'P_SAW', m: ['lin', 1], ch: c, cap: 'k', lvl: 1 },
      { l: 'Noise', f: f('noise'), p: 'P_NOISE', m: ['lin', 1], ch: c, cap: 's' },
    ]],
    ['VCF', [
      { l: 'HPF', f: f('hpf_hz'), p: 'P_HPF', m: ['exp', 26.8, 16155], u: 'Hz', ch: c, cap: 'g', sc: HIGH },
      { l: 'Res H', pl: 'Res', f: f('hpf_res'), p: 'P_RES_H', m: ['lin', 0.97], ch: c, cap: 'r' },
      { l: 'LPF', f: f('lpf_hz'), p: 'P_LPF', m: ['exp', 37.1, 20000], u: 'Hz', ch: c, cap: 'g', sc: HIGH },
      { l: 'Res L', pl: 'Res', f: f('lpf_res'), p: 'P_RES_L', m: ['lin', 0.97], ch: c, cap: 'r' },
      { l: 'IL', f: f('il'), p: 'P_IL', m: ['lin', 5], u: 'oct', ch: c, cap: 'k', sc: ['−5', '0'] },
      { l: 'AL', f: f('al'), p: 'P_AL', m: ['lin', 5], u: 'oct', ch: c, cap: 'k', sc: ['+5', '0'] },
      { l: 'Attack', pl: 'A', f: f('fa'), p: 'P_FA', m: ['egt', 0.002, 0.58], u: 's', ch: c, cap: 'k', sc: LONG },
      { l: 'Decay', pl: 'D', f: f('fd'), p: 'P_FD', m: ['egt', 0.002, 8.75], u: 's', ch: c, cap: 'k', sc: LONG },
      { l: 'Release', pl: 'R', f: f('fr'), p: 'P_FR', m: ['egt', 0.002, 11], u: 's', ch: c, cap: 'y', sc: LONG },
      { l: 'Invert', pl: 'Inv', f: f('inv'), p: 'P_INV', m: ['bool'], ch: c },
    ]],
    ['VCA', [
      { l: 'VCF level', pl: 'VCF lvl', f: f('vcf_level'), p: 'P_VCF_LEVEL', m: ['lin', 1], ch: c, cap: 's' },
      { l: 'Sine', pl: '∿ Sine', f: f('sine_level'), p: 'P_SINE', m: ['lin', 1], ch: c, cap: 's' },
      { l: 'Attack', pl: 'A', f: f('a'), p: 'P_A', m: ['egt', 0.002, 0.885], u: 's', ch: c, cap: 'k', sc: LONG },
      { l: 'Decay', pl: 'D', f: f('d'), p: 'P_D', m: ['egt', 0.002, 7.35], u: 's', ch: c, cap: 'k', sc: LONG },
      { l: 'Sustain', pl: 'S', f: f('s'), p: 'P_S', m: ['lin', 1], ch: c, cap: 'w' },
      { l: 'Release', pl: 'R', f: f('r'), p: 'P_R', m: ['egt', 0.002, 11.5], u: 's', ch: c, cap: 'y', sc: LONG },
      { l: 'Level', f: f('level'), p: 'P_LEVEL', m: ['lin', 1], ch: c, cap: 's' },
    ]],
    ['Touch response', [
      { l: 'Init bril', pl: 'Init bril', f: f('init_bril'), p: 'P_INIT_BRIL', m: ['lin', 3], u: 'oct', ch: c, cap: 'g' },
      { l: 'Init level', pl: 'Init lvl', f: f('init_level'), p: 'P_INIT_LEVEL', m: ['lin', 1], ch: c, cap: 's' },
      { l: 'After bril', pl: 'After bril', f: f('after_bril'), p: 'P_AFTER_BRIL', m: ['lin', 3], u: 'oct', ch: c, cap: 'g' },
      { l: 'After level', pl: 'After lvl', f: f('after_level'), p: 'P_AFTER_LEVEL', m: ['lin', 1], ch: c, cap: 's' },
    ]],
  ];
};
// the faceplate: the left block (two rows), the two channel rows, the
// performance strip, then echo, reverb and master at its right end
const FACE = {
  left: [
    [
      ['Sub oscillator', [
        { l: 'Function', pl: 'Func', f: 'sub_wave', p: 'P_SUB_FUNCTION', m: ['enum', SUBW], cap: 'k' },
        { l: 'Speed', f: 'sub_hz', p: 'P_SUB_SPEED', m: ['exp', 0.5, 100], u: 'Hz', cap: 'w', sc: FAST },
        { l: 'VCO', f: 'sub_vco', p: 'P_SUB_VCO', m: ['sq', 12], u: 'st', cap: 'w' },
        { l: 'VCF', f: 'sub_vcf', p: 'P_SUB_VCF', m: ['lin', 3], u: 'oct', cap: 'g' },
        { l: 'VCA', f: 'sub_vca', p: 'P_SUB_VCA', m: ['lin', 1], cap: 's' },
      ]],
      ['Ring modulator', [
        { l: 'Attack', pl: 'Attack', f: 'ring_a', p: 'P_RING_A', m: ['exp', 0.003, 0.53], u: 's', cap: 'k', sc: LONG },
        { l: 'Decay', pl: 'Decay', f: 'ring_d', p: 'P_RING_D', m: ['exp', 0.007, 4.5], u: 's', cap: 'k', sc: LONG },
        { l: 'Depth', f: 'ring_depth', p: 'P_RING_DEPTH', m: ['lin', 1], cap: 's' },
        { l: 'Speed', f: 'ring_hz', p: 'P_RING_SPEED', m: ['exp', 0.25, 205], u: 'Hz', cap: 'w', sc: FAST },
        { l: 'Mod', f: 'ring_mod', p: 'P_RING_MOD', m: ['lin', 1], cap: 's' },
      ]],
    ],
    [
      ['Chorus / tremolo', [
        { l: 'Chorus', f: 'chorus.chorus_on', p: 'P_CHORUS_ON', m: ['bool'] },
        { l: 'Ch speed', pl: 'Speed', f: 'chorus.chorus_hz', p: 'P_CHORUS_SPEED', m: ['exp', 0.4, 5], u: 'Hz', cap: 'w', sc: FAST },
        { l: 'Ch depth', pl: 'Depth', f: 'chorus.chorus_depth', p: 'P_CHORUS_DEPTH', m: ['lin', 1], cap: 's' },
        { l: 'Tremolo', pl: 'Trem', f: 'chorus.trem_on', p: 'P_TREM_ON', m: ['bool'] },
        { l: 'Tr speed', pl: 'Speed', f: 'chorus.trem_hz', p: 'P_TREM_SPEED', m: ['exp', 1.18, 16.3], u: 'Hz', cap: 'w', sc: FAST },
        { l: 'Tr depth', pl: 'Depth', f: 'chorus.trem_depth', p: 'P_TREM_DEPTH', m: ['lin', 1], cap: 's' },
      ]],
      ['Brilliance', [
        { l: 'Mix I/II', pl: 'Mix', f: 'mix', p: 'P_MIX', m: ['bip', -1], cap: 'k', sc: ['I', 'II'] }, // up = channel I (mix -1)
        { l: 'Brilliance', pl: 'Bril', f: 'brilliance', p: 'P_BRILLIANCE', m: ['bip', 3], u: 'oct', cap: 'g', sc: PM },
        { l: 'Resonance', pl: 'Reson', f: 'resonance', p: 'P_RESONANCE', m: ['lin', 1], cap: 'r' },
      ]],
      ['Volume', [
        { l: 'Volume', pl: 'Level', k: 'gain', f: 'gain', cap: 's', sc: ['0 dB', 'off'] },
      ]],
    ],
  ],
  ch: [['I', ch(0)], ['II', ch(1)]],
  strip: [
    ['Feet', [
      { l: 'Feet I', f: 'feet_I', p: 'P_FEET_I', m: ['enum', FEET], cap: 'w' },
      { l: 'Feet II', f: 'feet_II', p: 'P_FEET_II', m: ['enum', FEET], cap: 'w' },
      { l: 'Detune II', pl: 'Detune', f: 'detune_cents', p: 'P_DETUNE', m: ['bip', 100], u: 'ct', cap: 'w', sc: PM },
    ]],
    ['Touch response', [
      { l: 'Init bend', pl: 'Pitch bend', f: 'init_bend', p: 'P_INIT_BEND', m: ['lin', 2], u: 'st', cap: 'w' },
      { l: 'AT sub speed', pl: 'Speed', f: 'at_sub_speed', p: 'P_AT_SUB_SPEED', m: ['lin', 3], cap: 'w' },
      { l: 'AT sub VCO', pl: 'VCO', f: 'at_sub_vco', p: 'P_AT_SUB_VCO', m: ['sq', 2], u: 'st', cap: 'w' },
      { l: 'AT sub VCF', pl: 'VCF', f: 'at_sub_vcf', p: 'P_AT_SUB_VCF', m: ['lin', 2], u: 'oct', cap: 'g' },
      { l: 'AT mode', pl: 'AT mode', f: 'at_mode', m: ['enum', ['poly', 'mono', 'last']], cap: 'k' },
    ]],
    ['Keyboard control', [
      { l: 'Kbd bril lo', pl: 'Bril low', f: 'kbd_bril_low', p: 'P_KBD_BRIL_LOW', m: ['bip', 2], u: 'oct', cap: 'g', sc: PM },
      { l: 'Kbd bril hi', pl: 'Bril high', f: 'kbd_bril_high', p: 'P_KBD_BRIL_HIGH', m: ['bip', 2], u: 'oct', cap: 'g', sc: PM },
      { l: 'Kbd level lo', pl: 'Lvl low', f: 'kbd_level_low', p: 'P_KBD_LEVEL_LOW', m: ['bip', 1], cap: 's', sc: PM },
      { l: 'Kbd level hi', pl: 'Lvl high', f: 'kbd_level_high', p: 'P_KBD_LEVEL_HIGH', m: ['bip', 1], cap: 's', sc: PM },
    ]],
    ['Sustain / portamento', [
      { l: 'Sustain time', pl: 'Time', f: 'sustain_time', p: 'P_SUSTAIN_TIME', m: ['sq', 9], u: 's', cap: 'w', sc: LONG },
      { l: 'Sustain mode', pl: 'Mode', f: 'sustain_mode', p: 'P_SUSTAIN_MODE', m: ['enum', ['I', 'II', 'hold']], cap: 'k' },
      { l: 'Portamento', pl: 'Porta', f: 'porta_time', p: 'P_PORTA_TIME', m: ['sq', 2], u: 's/oct', cap: 'w', sc: LONG },
      { l: 'Glissando', pl: 'Gliss', f: 'gliss', p: 'P_GLISS', m: ['bool'] },
    ]],
  ],
  extras: [
    ['Echo', [
      { l: 'Echo', pl: 'Mode', f: 'fx.echo_mode', m: ['enum', ['off', 'line', 'voices']], cap: 'x' },
      { l: 'Time', f: 'fx.echo_time', p: 'P_ECHO_TIME', m: ['exp', 0.03, 1.3], u: 's', cap: 'x', sc: LONG },
      { l: 'Feedback', pl: 'Fdbk', f: 'fx.echo_fb', p: 'P_ECHO_FB', m: ['lin', 0.9], cap: 'x' },
      { l: 'Echo mix', pl: 'Mix', f: 'fx.echo_mix', p: 'P_ECHO_MIX', m: ['lin', 1], cap: 'x' },
    ]],
    ['Reverb', [
      { l: 'Reverb mix', pl: 'Mix', f: 'fx.reverb_mix', p: 'P_REVERB_MIX', m: ['lin', 1], cap: 'x' },
      { l: 'Decay', f: 'plate.decay', p: 'P_REVERB_DECAY', m: ['aff', 0.3, 0.67], cap: 'x', sc: LONG },
    ]],
    ['Master', [
      { l: 'Pan spread', pl: 'Pan', f: 'pan_spread', p: 'P_PAN', m: ['lin', 1], cap: 'x' },
      { l: 'Drift', f: 'drift', p: 'P_DRIFT', m: ['lin', 2], cap: 'x' },
      { l: 'Bend up', pl: 'Bend +', f: 'bend_up', m: ['lin', 12], u: 'st', cap: 'x' },
      { l: 'Bend down', pl: 'Bend −', f: 'bend_down', m: ['lin', 12], u: 'st', cap: 'x' },
      { l: 'Master', f: 'master', p: 'P_MASTER', m: ['lin', 4], u: 'dB', cap: 'x', sc: ['+12', 'off'] },
    ]],
  ],
};

const fwd = (m, x) => {
  switch (m[0]) {
    case 'lin': return m[1] * x;
    case 'sq': return m[1] * x * x;
    case 'bip': return m[1] * (2 * x - 1);
    case 'exp': return m[1] * Math.pow(m[2] / m[1], x);
    case 'egt': return m[1] + (m[2] - m[1]) * (Math.pow(100, x) - 1) / 99; // envelope times, cs80v2/midimap.hpp egtmap
    case 'aff': return m[1] + m[2] * x;
  }
  return x;
};
const inv = (m, v) => {
  let x;
  switch (m[0]) {
    case 'lin': x = v / m[1]; break;
    case 'sq': x = Math.sqrt(Math.max(0, v / m[1])); break;
    case 'bip': x = (v / m[1] + 1) / 2; break;
    case 'exp': x = Math.log(Math.max(v, 1e-9) / m[1]) / Math.log(m[2] / m[1]); break;
    case 'egt': x = Math.log(1 + Math.max(0, v - m[1]) * 99 / (m[2] - m[1])) / Math.log(100); break;
    case 'aff': x = (v - m[1]) / m[2]; break;
    default: x = v;
  }
  return Math.min(1, Math.max(0, x));
};
const fmt = (c, v) => {
  switch (c.u) {
    case 'Hz': return v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : v.toFixed(v < 10 ? 2 : 0) + ' Hz';
    case 's': return v < 1 ? (v * 1000).toFixed(0) + ' ms' : v.toFixed(2) + ' s';
    case 's/oct': return v === 0 ? 'off' : v.toFixed(2) + ' s';
    case 'oct': return (v >= 0 ? '+' : '') + v.toFixed(2);
    case 'st': return v.toFixed(2) + ' st';
    case 'ct': return v.toFixed(1) + ' ct';
    case 'pw': return (50 + 100 * v).toFixed(0) + '%';
    case 'dB': return dbText(v);
  }
  return v.toFixed(2);
};

// Param id for a control; channel II ids follow channel I by CH_STRIDE
const paramId = (c) => {
  const P = info.params;
  const stride = (P.P_RING_A - P.P_PWM_SPEED) / 2;
  return P[c.p] + (c.ch ? stride : 0);
};

const controls = [];
const rawDefs = {};          // field name -> control definition (for raw-field assignments)
const byField = new Map();   // field name -> control (to flash it when hardware moves it)
const rawLabel = (f) => { const c = rawDefs[f]; return c ? (f.startsWith('II.') ? 'II ' : f.startsWith('I.') ? 'I ' : '') + c.l : f; };
let presetVals = null;       // the patch as loaded, for double-click reset
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function buildPanel() {
  const panel = $('panel');
  panel.innerHTML = '';
  controls.length = 0;
  byField.clear();
  const section = (title, list, extra = '') => {
    const s = el('div', 'fsec' + extra);
    s.appendChild(el('div', 'ftitle', title));
    const row = el('div', 'frow');
    for (const c of list) row.appendChild(buildControl(c));
    s.appendChild(row);
    return s;
  };
  const face = el('div', 'face');
  const left = el('div', 'fleft');
  for (const r of FACE.left) { const line = el('div', 'fline'); for (const [t, l] of r) line.appendChild(section(t, l)); left.appendChild(line); }
  const chans = el('div', 'fchans');
  for (const [num, subs] of FACE.ch) {
    const line = el('div', 'fline fch');
    line.appendChild(el('div', 'fnum', num));
    for (const [t, l] of subs) line.appendChild(section(t, l));
    chans.appendChild(line);
  }
  const top = el('div', 'ftop');
  top.append(left, chans);
  const strip = el('div', 'fline fstrip');
  for (const [t, l] of FACE.strip) strip.appendChild(section(t, l));
  const ex = el('div', 'fextras');
  const exl = el('div', 'fline');
  for (const [t, l] of FACE.extras) exl.appendChild(section(t, l));
  ex.appendChild(exl);
  strip.appendChild(ex);
  face.append(top, strip);
  panel.appendChild(face);
  fitPanel();
}

/* a CS-80 lever: drag, wheel, arrow keys, double-click resets to the preset */
const tip = el('div', 'ftip');
tip.hidden = true;
document.body.appendChild(tip);
function showTip(c, anchor) {
  tip.textContent = `${rawLabel(c.f)}: ${c.text()}`;
  tip.hidden = false;
  const r = anchor.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2)) + 'px';
  tip.style.top = Math.max(4, r.top - tip.offsetHeight - 6) + 'px';
}
const hideTip = () => { tip.hidden = true; };

function buildControl(c) {
  const col = el('div', 'fctl');
  col.dataset.field = c.f;
  const lab = el('label', 'flab', c.pl || c.l);
  lab.title = `${rawLabel(c.f)}. Double-click this label, then move a controller knob or slider to assign it here.`;
  if (c.k !== 'gain') lab.ondblclick = () => startAssign('field:' + c.f);
  const idx = c.k === 'gain' ? undefined : fieldIx[c.f];
  if (idx === undefined && c.k !== 'gain') console.warn('unknown field', c.f);
  const kind = c.k === 'gain' ? 'gain' : c.m[0];

  if (kind === 'bool') {
    // a rocker tab, like the square and saw switches on the original
    col.classList.add('rock');
    const b = el('button', 'rocker');
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', rawLabel(c.f));
    b.innerHTML = '<span></span>';
    let on = false;
    c.text = () => (on ? 'on' : 'off');
    const setOn = (v) => { on = v; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); };
    b.onclick = () => {
      setOn(!on);
      if (c.p) send({ type: 'param', id: paramId(c), x: on ? 1 : 0 }); else send({ type: 'field', index: idx, value: on ? 1 : 0 });
      perf.fieldEdited(c.f, on ? 1 : 0);
      showTip(c, b);
    };
    b.onpointerenter = b.onfocus = () => showTip(c, b);
    b.onpointerleave = b.onblur = hideTip;
    col.append(el('span', 'fsc', 'ON'), b, el('span', 'fsc', 'OFF'), lab);
    c.set = (v) => setOn(v >= 0.5);
  } else {
    const n = kind === 'enum' ? c.m[1].length : 0;
    let x = 0; // 0..1 lever position
    const f = el('div', 'fader' + (c.lvl ? ' lvl' : '') + (n ? ' steps' : ''));
    f.tabIndex = 0;
    f.setAttribute('role', 'slider');
    f.setAttribute('aria-label', rawLabel(c.f));
    f.setAttribute('aria-valuemin', '0');
    f.setAttribute('aria-valuemax', n ? String(n - 1) : '1000');
    const track = el('div', 'ftrack');
    const ticks = el('div', 'fticks');
    const nt = n || (c.lvl ? 2 : 11);
    for (let i = 0; i < nt; i++) { const t = el('i', i === 0 || i === nt - 1 || (!n && !c.lvl && i === 5) ? 'big' : ''); t.style.bottom = (100 * i / (nt - 1)) + '%'; ticks.appendChild(t); }
    const cap = el('div', 'fcap cap-' + (c.cap || 'w'));
    f.append(ticks, track, cap);
    const sc = c.sc || (n ? [c.m[1][n - 1], c.m[1][0]] : c.lvl ? ['1', '0'] : ['10', '0']);
    const value = () => (kind === 'gain' ? x * x : n ? Math.round(x * (n - 1)) : fwd(c.m, x));
    c.text = () => (kind === 'gain' ? dbText(x * x) : n ? c.m[1][Math.round(x * (n - 1))] : fmt(c, value()));
    const draw = () => {
      cap.style.bottom = `calc(${x * 100}% - var(--caph) / 2)`;
      f.setAttribute('aria-valuenow', n ? String(Math.round(x * (n - 1))) : String(Math.round(x * 1000)));
      f.setAttribute('aria-valuetext', c.text());
      if (!tip.hidden && tip.dataset.f === c.f) showTip(c, cap);
    };
    const commit = (nx) => {
      nx = Math.min(1, Math.max(0, nx));
      if (n) nx = Math.round(nx * (n - 1)) / (n - 1);
      if (nx === x && c.touched) return;
      x = nx; c.touched = true;
      c.dragging = performance.now();
      if (kind === 'gain') perf.setGain(x * x);
      else if (n) {
        const i = Math.round(x * (n - 1));
        if (c.p) send({ type: 'param', id: paramId(c), x: (i + 0.5) / (n - 0.01) }); else send({ type: 'field', index: idx, value: i });
        perf.fieldEdited(c.f, i);
      } else {
        if (c.p) send({ type: 'param', id: paramId(c), x }); else send({ type: 'field', index: idx, value: fwd(c.m, x) });
        perf.fieldEdited(c.f, fwd(c.m, x));
        // raising the echo level switches echo on, as the old Echo control did
        if (c.f === 'fx.echo_mix' && x > 0 && values && values[fieldIx['fx.echo_mode']] < 0.5) { send({ type: 'field', index: fieldIx['fx.echo_mode'], value: 1 }); perf.fieldEdited('fx.echo_mode', 1); }
      }
      draw();
    };
    c.nudge = (d) => commit(x + d);
    // drag: grabbing the cap moves it relative to where it was; a click on the slot jumps there first
    let drag = null;
    f.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); f.focus();
      f.setPointerCapture(e.pointerId);
      const r = track.getBoundingClientRect();
      if (e.target !== cap) commit(1 - (e.clientY - r.top) / r.height);
      drag = { y: e.clientY, x0: x, h: r.height };
      tip.dataset.f = c.f; showTip(c, cap);
      col.classList.add('drag');
    });
    f.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const fine = e.shiftKey ? 0.2 : 1;
      commit(drag.x0 + fine * (drag.y - e.clientY) / drag.h);
    });
    const end = () => { drag = null; col.classList.remove('drag'); };
    f.addEventListener('pointerup', end);
    f.addEventListener('pointercancel', end);
    f.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = (e.deltaY || -e.deltaX) < 0 ? 1 : -1;
      commit(x + dir * (n ? 1 / (n - 1) : e.shiftKey ? 0.002 : 0.01));
      tip.dataset.f = c.f; showTip(c, cap);
    }, { passive: false });
    f.addEventListener('keydown', (e) => {
      const s = n ? 1 / (n - 1) : e.shiftKey ? 0.002 : 0.01;
      const d = { ArrowUp: s, ArrowRight: s, ArrowDown: -s, ArrowLeft: -s, PageUp: n ? s : 0.1, PageDown: n ? -s : -0.1 }[e.key];
      if (d !== undefined) commit(x + d);
      else if (e.key === 'Home') commit(0);
      else if (e.key === 'End') commit(1);
      else return;
      e.preventDefault(); e.stopPropagation();
      tip.dataset.f = c.f; showTip(c, cap);
    });
    f.addEventListener('dblclick', () => {
      if (kind === 'gain') commit(1);
      else if (presetVals && idx !== undefined) commit(n ? presetVals[idx] / (n - 1) : inv(c.m, presetVals[idx]));
    });
    f.title = 'Drag, scroll or use the arrow keys. Double-click resets it to the preset.';
    f.onpointerenter = f.onfocus = () => { tip.dataset.f = c.f; showTip(c, cap); };
    f.onpointerleave = f.onblur = () => { if (!drag && document.activeElement !== f) hideTip(); };
    f.addEventListener('focusout', hideTip);
    col.append(el('span', 'fsc', sc[0]), f, el('span', 'fsc', sc[1]), lab);
    c.set = (v) => {
      if (c.dragging && performance.now() - c.dragging < 300) return; // do not fight the user's drag
      x = kind === 'gain' ? Math.sqrt(v) : n ? Math.min(n - 1, Math.max(0, Math.round(v))) / (n - 1) : inv(c.m, v);
      draw();
    };
    if (kind === 'gain') c.set(perf.gain);
  }
  c.idx = idx;
  c.el = col;
  controls.push(c);
  if (c.k !== 'gain') rawDefs[c.f] = c;
  byField.set(c.f, c);
  return col;
}

// light a control up when hardware (or a macro) moves it
function flash(f) {
  const c = byField.get(f); if (!c) return;
  c.el.classList.add('hit'); clearTimeout(c.tm); c.tm = setTimeout(() => c.el.classList.remove('hit'), 350);
}

function refreshPanel() {
  if (!values) return;
  for (const c of controls) if (c.idx !== undefined) c.set(values[c.idx]);
}

// shrink the faceplate to the space above the keyboard; very narrow screens wrap rows instead
function fitPanel() {
  const panel = $('panel'), face = panel.firstChild, box = $('sound');
  if (!face) return;
  panel.classList.remove('wrap');
  face.style.zoom = 1;
  face.style.setProperty('--fh', '96px');
  const w = face.scrollWidth, h = face.scrollHeight;
  const aw = box.clientWidth - 8, ah = box.clientHeight - 8;
  let s = Math.min(1, aw / w, ah / h);
  if (aw / w < 0.62) { panel.classList.add('wrap'); s = Math.min(1, aw / face.scrollWidth); }
  else {
    s = Math.max(0.62, s);
    // spare height: longer levers (three rows of them), up to about twice the travel
    const spare = ah / s - h;
    if (spare > 6) { face.style.setProperty('--fh', Math.min(190, 96 + Math.floor((spare - 6) / 3)) + 'px'); s = Math.max(0.62, Math.min(1, aw / w, ah / face.scrollHeight)); }
  }
  face.style.zoom = s.toFixed(3);
}
window.addEventListener('resize', () => requestAnimationFrame(fitPanel));

/* ---- presets ------------------------------------------------------------- */

function banks() {
  // without the library (offline, fetch failed) the engine's built-in sounds are the only bank
  const b = {};
  if (!library) b.Core = info.presets.map((name, i) => ({ name, core: i, bank: 'Core', slot: i + 1 }));
  else for (const p of library.presets) (b[p.bank] = b[p.bank] || []).push(p);
  b[USER_BANK] = userBank.map((u, i) => (u ? { ...u, bank: USER_BANK, slot: i + 1, origin: 'user' } : { name: 'empty', bank: USER_BANK, slot: i + 1, empty: true }));
  return b;
}
const firstLoadable = (list, from = 0) => { for (let k = 0; k < list.length; k++) { const i = (from + k) % list.length; if (!list[i].empty) return i; } return -1; };

function buildBrowser() {
  const sel = $('bank');
  sel.innerHTML = '';
  const all = banks();
  if (!all[current.bank]) current = { bank: Object.keys(all)[0], index: 0 };
  for (const name of Object.keys(all)) {
    const n = name === USER_BANK ? `${all[name].filter((p) => !p.empty).length}/${USER_SLOTS}` : all[name].length;
    sel.add(new Option(`${name} (${n})`, name));
  }
  sel.value = current.bank;
  sel.onchange = () => { midiBank = null; selectBank(sel.value); };
  const names = Object.keys(all);
  $('pc-hint').textContent = `Program change loads sounds from the bank on screen; bank select (CC 0) before it picks the bank: ${names.map((n, i) => `${i} ${n}`).join(', ')}. ` +
    `User slots are programs 1 to ${USER_SLOTS} in bank ${names.indexOf(USER_BANK)}. "Save to current user slot" can go on any button (Record by default).`;
  listPresets();
  const p = all[current.bank][current.index];
  if (p && !p.empty) $('preset-name').textContent = p.name;
}

/* show a bank and load its first sound; an empty User bank keeps the sound playing */
function selectBank(name) {
  const list = banks()[name];
  if (!list) return;
  const i = name === USER_BANK ? firstLoadable(list, userSlot) : 0;
  current = { bank: name, index: i };
  $('bank').value = name;
  listPresets();
  if (i >= 0) loadCurrent();
  else { showSaveTarget(); status(`The User bank is empty. Press Save to keep the sound you hear in User ${userSlot + 1}.`); }
}

function listPresets() {
  const ol = $('presets');
  ol.innerHTML = '';
  const user = current.bank === USER_BANK;
  ol.classList.toggle('user', user);
  banks()[current.bank].forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span>';
    li.firstChild.textContent = user ? `${i + 1}  ${p.name}` : p.name;
    li.classList.toggle('sel', i === current.index);
    li.classList.toggle('empty', !!p.empty);
    li.classList.toggle('target', user && i === userSlot);
    li.onclick = () => pickSlot(i);
    ol.appendChild(li);
  });
}

/* a click on a list entry: load it, or make an empty User slot the save target */
function pickSlot(i) {
  const p = banks()[current.bank][i];
  if (!p) return;
  if (p.empty) {
    setUserSlot(i);
    status(`User ${i + 1} is empty. Press Save to keep the sound you hear there.`);
    return;
  }
  current.index = i;
  loadCurrent();
}

function loadCurrent() {
  const list = banks()[current.bank];
  const p = list[current.index];
  if (!p || p.empty) return;
  loaded = p;
  if (p.origin === 'user') userSlot = p.slot - 1;
  $('preset-name').textContent = p.name;
  [...$('presets').children].forEach((li, i) => { li.classList.toggle('sel', i === current.index); li.classList.toggle('target', current.bank === USER_BANK && i === userSlot); });
  showSaveTarget();
  const infoEl = $('preset-info');
  infoEl.innerHTML = '';
  const add = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; infoEl.appendChild(d); };
  if (p.core !== undefined) {
    send({ type: 'preset', index: p.core });
    add('', p.reference ? `${p.bank} ${p.slot}: Core sound, built into the engine. ${p.reference}.` : 'Built-in patch.');
  } else {
    loadFields(p.fields);
    if (p.origin === 'user') {
      add('', `User ${p.slot}: saved ${new Date(p.t || 0).toLocaleString()}` + (p.base ? `, started from ${p.base}.` : '.'));
    } else if (p.origin === 'chart') {
      add('', `${p.bank} ${p.slot}: built from a published CS-80 panel chart. ${p.reference}`);
      if (p.chart_source) add('', `Chart: ${p.chart_source}`);
    } else if (p.arturia_name) {
      add('', `${p.bank} ${p.slot}: Arturia CS-80V factory preset ${p.arturia_name} (${p.arturia_category}, ${p.generation}).`);
      add('', `Mapped with the chart-calibrated curves in presets/arturia/CALIBRATION.md. Held-chord level: ${p.level_dbfs} dBFS RMS.`);
      for (const d of p.dropped_features) add('note', 'Left out: ' + d);
    } else {
      add('', `${p.bank} ${p.slot}: ${p.reference}`);
      add('', `Confidence: ${p.confidence}. Translated from presets.json, level-matched to ${p.level_dbfs ?? p.level_db} dBFS RMS.`);
    }
  }
  for (const n of p.notes || []) add('note', 'Approximation: ' + n);
}

function loadFields(fields) {
  const pairs = [];
  for (const [name, v] of Object.entries(fields)) if (name in fieldIx) pairs.push([fieldIx[name], v]);
  send({ type: 'blob', pairs, reset: true });
}

function step(d) {
  const list = banks()[current.bank];
  const n = list.length;
  let i = current.index < 0 ? (d > 0 ? n - 1 : 0) : current.index;
  for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!list[i].empty) { current.index = i; loadCurrent(); return; } }
  status(`The ${current.bank} bank is empty.`);
}

/* MIDI program change: bank select (CC 0) picks the bank by its place in the list, else the
   bank on screen; the program number picks the slot */
let midiBank = null;
function programChange(n) {
  if (!info) return;
  const all = banks(), names = Object.keys(all);
  const bank = midiBank !== null && names[midiBank] ? names[midiBank] : current.bank;
  const list = all[bank];
  if (n >= list.length) { status(`Program ${n + 1}: the ${bank} bank has ${list.length} sounds.`, 'err'); return; }
  if (bank !== current.bank) { current = { bank, index: -1 }; $('bank').value = bank; }
  if (list[n].empty) {
    listPresets(); setUserSlot(n);
    status(`User ${n + 1} is empty. Save sends the sound you hear there.`);
    return;
  }
  current.index = n;
  listPresets(); loadCurrent();
}

const pct = (d) => (Math.abs(d) < 0.005 ? 'preset' : (d > 0 ? '+' : '') + Math.round(d * 100) + '%');
function showVolume() { const c = byField.get('gain'); if (c) { c.set(perf.gain); if (fromMidi) flash('gain'); } }

/* ---- copy / load settings --------------------------------------------------- */

function settingsJSON() {
  const fields = {};
  info.fields.forEach((f, i) => {
    const v = values[i], d = info.defaults[i];
    if (Math.abs(v - d) > 1e-6) fields[f] = +v.toPrecision(4);
  });
  return JSON.stringify({ v: 1, engine: 'cs80v2', base: loaded ? `${loaded.bank}/${loaded.name}` : patchName, fields });
}

async function copySettings() {
  if (!values) { status('Start audio first.', 'err'); return; }
  const text = settingsJSON();
  try { await navigator.clipboard.writeText(text); status('Settings copied. Use Load settings to bring them back.', 'ok'); }
  catch { $('paste').value = text; $('paste-box').hidden = false; status('The clipboard is blocked, so the settings are in the box on the left.', 'err'); }
}

function pasteSettings() {
  try {
    const j = JSON.parse($('paste').value);
    if (!j.fields) throw new Error('this is not copied settings text');
    loadFields(j.fields);
    status('Settings loaded.', 'ok');
  } catch (e) { status('Could not load: ' + e.message, 'err'); }
}

/* ---- performance layer (perf.js) ------------------------------------------- */

const P = window.CS80Perf;
const LS = { layout: 'cs80.layout', map: 'cs80.perfmap', favs: 'cs80.favs', mode: 'cs80.ccmode' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const byName = (vals) => Object.fromEntries(info.fields.map((f, i) => [f, vals[i]]));

let pendingFields = [];
let fromMidi = false; // hardware is moving controls: light them up
let atLevel = 0; // aftertouch from a slider: re-sent after each new note, which starts at zero
const flushFields = () => { if (pendingFields.length) { send({ type: 'fields', pairs: pendingFields }); pendingFields = []; } };
const perf = P.create({
  emit(m) {
    if (m.type === 'field') { if (m.name in fieldIx) { pendingFields.push([fieldIx[m.name], m.value]); if (fromMidi) flash(m.name); } }
    else if (m.type === 'gain') { send({ type: 'gain', value: m.value }); showVolume(); }
    else if (m.type === 'pressure') { atLevel = m.value; send({ type: 'cp', value: m.value }); $('pressure').value = m.value; }
    else if (m.type === 'action') doAction(m.id);
  },
  raw: (f) => rawDefs[f] || null,
  fwd, inv,
  onLayout: (l) => save(LS.layout, l), // a CC turned out to be relative (or absolute)
});
perf.setLayout(load(LS.layout, { name: '', controls: {} }));
perf.setMap(load(LS.map, {}));
let favs = load(LS.favs, [null, null, null, null]);
let ccMode = load(LS.mode, 'perf'); // 'perf' | '0' Oxygen firmware map | '1' PM-80
const hasLayout = () => Object.values(perf.layout.controls).some(Boolean);

function showPerformanceView(view) {
  const keyboard = view !== 'legend';
  $('keyboard-view').hidden = !keyboard;
  $('legend').hidden = keyboard;
  $('tab-keyboard').setAttribute('aria-selected', String(keyboard));
  $('tab-legend').setAttribute('aria-selected', String(!keyboard));
}
$('tab-keyboard').onclick = () => showPerformanceView('keyboard');
$('tab-legend').onclick = () => showPerformanceView('legend');

/* called when the worklet reports a patch snapshot */
function perfPatch(m) {
  if (!info) return;
  if (m.reason === 'load') {
    if (ccMode === 'perf') {
      // performance-wide settings: bend range and a usable mod-wheel vibrato
      const fix = [];
      const set = (f, v) => { if (f in fieldIx && Math.abs(values[fieldIx[f]] - v) > 1e-6) { fix.push([fieldIx[f], v]); values[fieldIx[f]] = v; } };
      set('bend_up', P.BEND_RANGE); set('bend_down', P.BEND_RANGE);
      if (values[fieldIx.wheel_vco] < P.WHEEL_VIB_MIN) set('wheel_vco', P.WHEEL_VIB_MIN);
      if (fix.length) send({ type: 'fields', pairs: fix });
    }
    perf.rebase(byName(values));
    presetVals = values.slice();
    legendValues();
  } else perf.update(byName(values));
}

function doAction(id) {
  if (id === 'panic') { $('panic').onclick(); return; }
  if (!info) { status('Start audio first.', 'err'); return; }
  if (id === 'preset_reset') resetPreset();
  else if (id === 'user_save') quickSave(false);
  else if (id === 'preset_prev') step(-1);
  else if (id === 'preset_next') step(1);
  else if (id === 'bank_prev' || id === 'bank_next') {
    const names = Object.keys(banks()), i = names.indexOf(current.bank), d = id === 'bank_next' ? 1 : -1;
    midiBank = null;
    selectBank(names[(i + d + names.length) % names.length]);
  } else if (/^fav\d$/.test(id)) recallFav(+id[3] - 1);
}

/* Reset preset: the panel back to the preset as loaded. Held notes keep playing
   (only fields change), and macros pick up where their controls sit. */
function resetPreset() {
  if (!info || !presetVals) { status('Start audio first.', 'err'); return; }
  perf.resetPreset();
  flushFields();
  values = presetVals.slice();
  refreshPanel(); legendValues();
  status(`${$('preset-name').textContent || 'Preset'} reset to its stored values.`, 'ok');
}
$('reset-preset').onclick = resetPreset;
$('preset-name').ondblclick = resetPreset;

/* ---- favourites --------------------------------------------------------------- */

function recallFav(i) {
  const f = favs[i];
  if (!f) { status(`Favourite ${i + 1} is empty. Shift-click it to save the current preset there.`); return; }
  if (!info) return;
  // a sound that moved bank (the old Core bank was split up) is still found by name
  const all = banks(), inBank = (b) => (all[b] ? all[b].findIndex((p) => !p.empty && p.name === f.name) : -1);
  const bank = inBank(f.bank) >= 0 ? f.bank : Object.keys(all).find((b) => inBank(b) >= 0);
  if (!bank) { status(`Favourite ${i + 1} (${f.name}) is no longer in the library.`, 'err'); return; }
  const j = inBank(bank);
  if (bank !== f.bank) { favs[i] = { bank, name: f.name }; save(LS.favs, favs); buildFavs(); }
  current = { bank, index: j };
  $('bank').value = current.bank; listPresets(); loadCurrent();
}
function storeFav(i) {
  if (!info) { status('Start audio first.', 'err'); return; }
  const p = loaded;
  if (!p) { status('Load a preset first.', 'err'); return; }
  favs[i] = { bank: p.bank, name: p.name };
  save(LS.favs, favs); buildFavs();
  status(`Saved ${p.name} as favourite ${i + 1}.`, 'ok');
}
function buildFavs() {
  const box = $('favs');
  box.innerHTML = '';
  favs.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'fav' + (f ? '' : ' empty');
    b.textContent = `${i + 1} ${f ? f.name : 'empty'}`;
    b.title = (f ? `${f.bank}/${f.name}. ` : '') + 'Click to load. Shift-click or long-press to save the current preset here.';
    let timer = null, long = false;
    b.onpointerdown = () => { long = false; timer = setTimeout(() => { long = true; storeFav(i); }, 600); };
    b.onpointerup = b.onpointerleave = () => clearTimeout(timer);
    b.onclick = (e) => { if (long) return; if (e.shiftKey) storeFav(i); else recallFav(i); };
    box.appendChild(b);
  });
}

/* ---- User bank: saved sounds, in localStorage -------------------------------------
   USER_SLOTS slots, each null or {name, fields (every engine field by name), base, t}.
   Save writes the sound as you hear it to the selected slot (userSlot); Save as picks a
   name and slot. Replacing a different sound asks first, except from a hardware button
   (no dialog there): Undo brings back the bank as it was before the last change. The
   bank is kept apart from the controller setup, so Reset controller setup leaves it. */

const USER_BANK = 'User', USER_SLOTS = 16;
const USER_KEY = 'cs80.userbank', USER_SLOT_KEY = 'cs80.userslot';
const cleanSlot = (u) => (u && typeof u.name === 'string' && u.fields && typeof u.fields === 'object' ? { name: u.name.slice(0, 40), fields: u.fields, base: u.base || '', t: u.t || 0 } : null);
let userBank = (() => { const j = load(USER_KEY, null), a = j && Array.isArray(j.slots) ? j.slots : []; return Array.from({ length: USER_SLOTS }, (_, i) => cleanSlot(a[i])); })();
let userSlot = Math.min(USER_SLOTS - 1, Math.max(0, +load(USER_SLOT_KEY, 0) || 0));
let userUndo = null; // the bank before the last change
const persistUser = () => { save(USER_KEY, { v: 1, slots: userBank }); save(USER_SLOT_KEY, userSlot); };
const slotLabel = (i) => `User ${i + 1}` + (userBank[i] ? `: ${userBank[i].name}` : ' (empty)');
const isLoadedUser = (i) => !!loaded && loaded.origin === 'user' && loaded.slot === i + 1;

function setUserSlot(i) {
  userSlot = i;
  save(USER_SLOT_KEY, userSlot);
  if (current.bank === USER_BANK) [...$('presets').children].forEach((li, k) => li.classList.toggle('target', k === i));
  showSaveTarget();
}
function showSaveTarget() {
  const u = userBank[userSlot];
  $('save-target').textContent = `Saves to ${slotLabel(userSlot)}` + (u && !isLoadedUser(userSlot) ? ' (asks first)' : '') + '.';
  $('user-rename').disabled = $('user-delete').disabled = !u;
  $('user-undo').hidden = !userUndo;
}
// the bank dropdown counts, the list and the target line after the bank changed
function refreshUser() {
  persistUser();
  const keep = current;
  buildBrowser();
  current = keep; $('bank').value = current.bank;
  listPresets(); showSaveTarget();
}
const remember = () => { userUndo = userBank.slice(); };

/* the patch as the engine has it now (edits still in flight are flushed first) */
let patchWaiters = [];
function freshFields() {
  flushFields();
  return new Promise((res) => {
    const done = () => res(Object.fromEntries(info.fields.map((f, i) => [f, +values[i].toPrecision(7)])));
    const t = setTimeout(() => { patchWaiters = patchWaiters.filter((w) => w !== done); done(); }, 400);
    patchWaiters.push(() => { clearTimeout(t); done(); });
    send({ type: 'getpatch' });
  });
}

/* inline confirm in the save box: resolves true for the OK button */
let askDone = null;
function ask(text, ok) {
  if (askDone) askDone(false);
  $('save-ask-text').textContent = text;
  $('save-ask-ok').textContent = ok;
  $('save-ask').hidden = false;
  $('save-ask-ok').focus();
  return new Promise((res) => { askDone = (v) => { askDone = null; $('save-ask').hidden = true; res(v); }; });
}
$('save-ask-ok').onclick = () => askDone && askDone(true);
$('save-ask-no').onclick = () => askDone && askDone(false);

async function saveTo(slot, name, confirmIt) {
  if (!info || !values) { status('Start audio first.', 'err'); return false; }
  const prev = userBank[slot], self = isLoadedUser(slot);
  if (prev && !self && confirmIt && !(await ask(`User ${slot + 1} holds "${prev.name}". Replace it?`, 'Replace'))) { status('Not saved.'); return false; }
  const fields = await freshFields();
  remember();
  const base = loaded ? (loaded.origin === 'user' ? loaded.base : `${loaded.bank}/${loaded.name}`) : patchName;
  userBank[slot] = { name: (name || '').trim().slice(0, 40) || 'Untitled', fields, base, t: Date.now() };
  userSlot = slot;
  current = { bank: USER_BANK, index: slot };
  refreshUser();
  loadCurrent(); // the stored copy becomes the preset: Reset preset and the macros start from it
  status(`Saved "${userBank[slot].name}" to User ${slot + 1}.` + (prev && !self ? ` It replaced "${prev.name}"; Undo brings that back.` : ''), 'ok');
  return true;
}
function quickSave(confirmIt = true) {
  const u = userBank[userSlot];
  return saveTo(userSlot, isLoadedUser(userSlot) && u ? u.name : (loaded ? loaded.name : patchName), confirmIt);
}

let formMode = null; // 'save' | 'rename'
function openForm(mode) {
  if (!info) { status('Start audio first.', 'err'); return; }
  formMode = mode;
  const sel = $('save-slot');
  sel.innerHTML = '';
  for (let i = 0; i < USER_SLOTS; i++) sel.add(new Option(slotLabel(i), String(i)));
  const firstEmpty = userBank.findIndex((u) => !u);
  sel.value = String(mode === 'rename' || !userBank[userSlot] || isLoadedUser(userSlot) || firstEmpty < 0 ? userSlot : firstEmpty);
  sel.hidden = mode === 'rename';
  $('save-name').value = mode === 'rename' ? userBank[userSlot].name : (loaded ? loaded.name : patchName);
  $('save-ok').textContent = mode === 'rename' ? 'Rename' : 'Save';
  $('save-form').hidden = false;
  $('save-name').focus(); $('save-name').select();
}
const closeForm = () => { $('save-form').hidden = true; formMode = null; };
$('save-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('save-name').value.trim().slice(0, 40) || 'Untitled', mode = formMode;
  closeForm();
  if (mode === 'rename') {
    const u = userBank[userSlot]; if (!u) return;
    remember();
    userBank[userSlot] = { ...u, name };
    if (isLoadedUser(userSlot)) { loaded = { ...loaded, name }; $('preset-name').textContent = name; }
    refreshUser();
    status(`User ${userSlot + 1} renamed to "${name}".`, 'ok');
  } else await saveTo(+$('save-slot').value, name, true);
};
$('save-cancel').onclick = closeForm;
$('save-form').onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeForm(); } };
$('save').onclick = () => quickSave(true);
$('save-as').onclick = () => openForm('save');
$('user-rename').onclick = () => userBank[userSlot] && openForm('rename');
$('user-delete').onclick = async () => {
  const u = userBank[userSlot]; if (!u) return;
  if (!(await ask(`Delete "${u.name}" from User ${userSlot + 1}?`, 'Delete'))) return;
  remember();
  userBank[userSlot] = null;
  if (current.bank === USER_BANK && current.index === userSlot) current.index = -1;
  if (isLoadedUser(userSlot)) loaded = { ...loaded, origin: 'deleted' }; // the sound keeps playing
  refreshUser();
  status(`Deleted "${u.name}" from User ${userSlot + 1}. Undo brings it back.`, 'ok');
};
$('user-undo').onclick = () => {
  if (!userUndo) return;
  userBank = userUndo; userUndo = null;
  if (current.bank === USER_BANK && current.index >= 0 && !userBank[current.index]) current.index = -1;
  refreshUser();
  status('User bank restored.', 'ok');
};
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyS') {
    e.preventDefault();
    if (!$('save-form').hidden) $('save-form').requestSubmit(); else quickSave(true);
  }
});

/* Export / Import: {format: 'cs80v2-user-bank', v: 1, slots: [{slot, name, base, t, fields}]}.
   Import also takes Copy settings text or a single exported preset ({fields}), into the selected slot. */
function userBankJSON() {
  const slots = userBank.map((u, i) => (u ? { slot: i + 1, ...u } : null)).filter(Boolean);
  return { format: 'cs80v2-user-bank', v: 1, engine: 'cs80v2', app: VERSION, exported: new Date().toISOString(), slots };
}
$('user-export').onclick = () => {
  const j = userBankJSON();
  if (!j.slots.length) { status('The User bank is empty, so there is nothing to export yet.', 'err'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' }));
  a.download = 'cs80-user-bank.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status(`Exported ${j.slots.length} User preset${j.slots.length > 1 ? 's' : ''} to cs80-user-bank.json.`, 'ok');
};
$('user-import').onclick = () => $('user-file').click();
$('user-file').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) await importUser(await f.text());
};
async function importUser(text) {
  let entries;
  try {
    const j = JSON.parse(text);
    const ok = (fl) => fl && typeof fl === 'object' && Object.values(fl).every((v) => typeof v === 'number' && Number.isFinite(v));
    if (j && j.format === 'cs80v2-user-bank' && Array.isArray(j.slots)) {
      entries = j.slots.map((u) => ({ i: (u.slot | 0) - 1, u: cleanSlot(u) }));
      if (entries.some((x) => x.i < 0 || x.i >= USER_SLOTS || !x.u || !ok(x.u.fields))) throw new Error('a slot is out of range or has no sound');
    } else if (j && ok(j.fields) && Object.keys(j.fields).length) {
      const name = j.name || (j.base ? String(j.base).split('/').pop() : 'Imported');
      entries = [{ i: userSlot, u: { name: String(name).slice(0, 40), fields: j.fields, base: j.base || '', t: Date.now() } }];
    } else throw new Error('this is not a User bank or settings file');
  } catch (err) { status('Could not import: ' + err.message, 'err'); return false; }
  const hit = entries.filter((x) => userBank[x.i]);
  if (hit.length && !(await ask(`Import replaces ${hit.length} User preset${hit.length > 1 ? 's' : ''} (${hit.map((x) => 'User ' + (x.i + 1)).join(', ')}). Replace?`, 'Replace'))) { status('Nothing imported.'); return false; }
  remember();
  for (const x of entries) userBank[x.i] = x.u;
  current = { bank: USER_BANK, index: -1 };
  refreshUser();
  status(`Imported ${entries.length} User preset${entries.length > 1 ? 's' : ''}.` + (hit.length ? ' Undo brings back what they replaced.' : ''), 'ok');
  return true;
}

/* ---- Controls tab: what each hardware control does ---------------------------- */

const legendRows = new Map(); // slot -> {row, v}
function targetOptions(sel, cur) {
  sel.innerHTML = '';
  sel.add(new Option('- nothing -', 'none'));
  const og = (label, items) => { const g = document.createElement('optgroup'); g.label = label; items.forEach(([v, l]) => g.appendChild(new Option(l, v))); sel.appendChild(g); };
  og('Sound', P.MACROS.map((m) => [m.id, m.l]));
  og('Actions', P.ACTIONS.map((a) => [a.id, a.l]));
  const seen = new Set();
  const fields = controls.filter((c) => c.idx !== undefined && !seen.has(c.f) && seen.add(c.f));
  if (fields.length) og('Panel controls (absolute)', fields.map((c) => ['field:' + c.f, rawLabel(c.f)]));
  sel.value = cur || 'none';
}
function buildLegend() {
  const box = $('legend-map');
  box.innerHTML = '';
  legendRows.clear();
  const extra = Object.keys(perf.layout.controls).filter((k) => !P.SLOT[k]);
  const dead = /oxygen/i.test(perf.layout.name) ? P.HARDWIRED.oxygen : []; // e.g. a B9 learned before it was skipped
  const learned = (s) => !!perf.layout.controls[s.id] && !dead.includes(s.id);
  const cols = [
    ['Sliders', P.SLOTS.filter((s) => s.id[0] === 's')],
    ['Knobs', P.SLOTS.filter((s) => s.id[0] === 'k')],
    ['Pads', P.SLOTS.filter((s) => s.id[0] === 'p')],
    // optional buttons only once learned, so an unset keyboard shows a short list
    ['Buttons', [...P.SLOTS.filter((s) => (s.id[0] === 'b' || s.id[0] === 't') && learned(s)), ...extra.map((id) => ({ id, label: id.toUpperCase() }))]],
  ].filter(([, slots]) => slots.length);
  for (const [title, slots] of cols) {
    const col = document.createElement('div');
    col.className = 'lcol';
    col.innerHTML = `<h3>${title}</h3>`;
    for (const s of slots) {
      const row = document.createElement('div');
      const hw = perf.layout.controls[s.id];
      row.className = 'lrow' + (hw ? '' : ' unlearned');
      row.title = `${s.label}: ${hw ? P.describe(hw) : 'not learned'}. Click to change what it does.`;
      row.innerHTML = `<span class="k"></span><span class="t"></span><span class="v"></span>`;
      row.children[0].textContent = s.label;
      row.children[1].textContent = P.targetLabel(perf.map[s.id], rawLabel);
      row.onclick = () => {
        if (row.querySelector('select')) return;
        const sel = document.createElement('select');
        targetOptions(sel, perf.map[s.id]);
        sel.onchange = () => setTarget(s.id, sel.value);
        sel.onblur = () => buildLegend();
        row.children[1].replaceWith(sel); sel.focus();
      };
      col.appendChild(row);
      legendRows.set(s.id, { row, v: row.children[2] });
    }
    box.appendChild(col);
  }
  const lay = perf.layout;
  $('legend-title').textContent = ccMode !== 'perf' ? 'A fixed CC map is on (see Advanced), so this list is not used.' :
    hasLayout() ? `${lay.name || 'Your controller'}` : 'Controller not set up yet. Crossed-out controls are not learned.';
  legendValues();
}
function setTarget(slot, t) {
  const m = { ...perf.map, [slot]: t };
  perf.setMap(m);
  save(LS.map, diffMap(m));
  buildLegend();
}
const diffMap = (m) => Object.fromEntries(Object.entries(m).filter(([k, v]) => P.DEFAULT_MAP[k] !== v));
function showSlotValue(r) {
  const e = legendRows.get(r.slot); if (!e) return;
  e.row.classList.add('hit'); clearTimeout(e.tm); e.tm = setTimeout(() => e.row.classList.remove('hit'), 180);
  let txt = '';
  if (r.d !== undefined) txt = pct(r.d);
  else if (r.t === 'master') txt = dbText(r.value);
  else if (r.t === 'pressure') txt = Math.round(r.value * 100) + '%';
  else if (r.waiting !== undefined) txt = (perf.state(r.slot).h < r.waiting ? 'up' : 'down') + ' to pick up';
  else if (r.value !== undefined && rawDefs[r.t.slice(6)]) txt = fmt(rawDefs[r.t.slice(6)], r.value);
  e.v.textContent = txt;
}
function legendValues() {
  for (const [slot, e] of legendRows) {
    const t = perf.map[slot], s = perf.state(slot);
    e.v.textContent = t === 'master' ? (s.h === null ? '' : dbText(s.h * s.h)) : (P.MACRO[t] && s.h !== null && !P.MACRO[t].abs ? 'preset' : '');
  }
}

/* ---- assign: pick a target, move a control ------------------------------------ */

let assigning = null; // target id waiting for a control
function startAssign(t) {
  if (ccMode !== 'perf') { status('Assigning needs Control map: Learned controls (in Advanced).', 'err'); return; }
  assigning = t;
  const sel = $('assign-target');
  targetOptions(sel, t);
  $('assign-box').hidden = false;
  status(`Move the slider, knob, pad or button that should control "${P.targetLabel(t, rawLabel)}". Esc cancels.`);
}
function finishAssign(c) {
  const t = $('assign-target').value;
  let slot = perf.lookup(c, c.port);
  if (!slot) {
    // a control the wizard did not learn: add it as an extra slot
    let n = 1; while (perf.layout.controls['x' + n]) n++;
    slot = 'x' + n;
    const lay = perf.layout; lay.controls[slot] = c; perf.setLayout(lay); save(LS.layout, perf.layout);
  }
  assigning = null;
  $('assign-box').hidden = true;
  setTarget(slot, t);
  status(`${(P.SLOT[slot] || { label: slot.toUpperCase() }).label} now controls ${P.targetLabel(t, rawLabel)}.`, 'ok');
}
function cancelAssign() { assigning = null; $('assign-box').hidden = true; }

/* ---- Learn controller wizard --------------------------------------------------- */

const learn = P.learner(renderLearn);
let learnTimer = null, learnFromSetup = false;
const isOxygen = () => /oxygen/i.test(selectedPortName() || (midiAccess ? [...midiAccess.inputs.values()].map((i) => i.name).join(' ') : ''));
function openLearn(opts = {}) {
  if (ccMode !== 'perf') setCcMode('perf');
  $('learn-nudge').hidden = true;
  $('learn').hidden = false;
  learn.start({}, { hardwired: isOxygen() ? 'oxygen' : '', ...opts });
  clearInterval(learnTimer);
  learnTimer = setInterval(() => { if (learn.active && learn.idleMs() > 8000) renderLearn(learn.view()); }, 1000);
}
function closeLearn(saveIt) {
  if ($('learn').hidden) return;
  $('learn').hidden = true; // first, so the wizard's own change callback does not re-enter
  clearInterval(learnTimer);
  const fromSetup = learnFromSetup; learnFromSetup = false;
  if (saveIt) {
    const controls = learn.finish();
    const keybed = learn.keybed || perf.keybed;
    perf.setLayout({ name: selectedPortName() || 'Controller', controls, keybed });
    save(LS.layout, perf.layout);
    status(`Learned ${Object.keys(controls).length} controls.`, 'ok');
    buildLegend();
    showPerformanceView('legend');
    if (fromSetup) openSetupAt('done');
  } else {
    learn.cancel();
    if (fromSetup) openSetupAt('learn');
  }
}
function renderLearn(v) {
  if ($('learn').hidden) return;
  if (v.done) { closeLearn(true); return; }
  $('learn-step').textContent = `Step ${v.step + 1} of ${v.total}${v.optional ? ' (optional)' : ''}`;
  $('learn-prompt').textContent = v.prompt;
  const what = v.slot === 'kb' ? 'This tells the app which channel your keys use, so they never trigger actions.' : P.targetLabel(perf.map[v.slot], rawLabel);
  $('learn-does').textContent = v.slot === 'kb' ? what : what !== '-' ? `It will control: ${what}` : 'No job yet; pick one later in the Controls tab.';
  const idle = learn.idleMs() > 8000 && !v.hint;
  $('learn-hint').textContent = v.hint || (idle ? 'Nothing arriving? Check the MIDI input at the top, or press Skip.' : v.tip || v.note);
  const c = v.conflict;
  $('learn-conflict').hidden = !c;
  if (c) {
    const g = c.group === 'pads' ? 'pads' : 'these buttons';
    $('learn-conflict-text').textContent = `Your ${g} and keys both send notes on channel ${c.ch + 1}, so the app cannot tell a ${c.group === 'pads' ? 'pad' : 'button'} from a key.`;
    $('learn-conflict-how').innerHTML = isOxygen()
      ? 'To fix it on the Oxygen: hit a pad, hold <b>SHIFT</b> and press the <b>CHANNEL UP</b> key until the display shows <b>10</b>, release, then hit the pad again. The app re-checks by itself.'
      : 'To fix it, set the pads to another MIDI channel (often 10) in your controller\'s settings, then hit the pad again.';
    $('learn-skip-pads').textContent = c.group === 'pads' ? 'Skip pads' : 'Skip these buttons';
  }
  $('learn-skip-group').hidden = !v.group || !!c;
  if (v.group) $('learn-skip-group').textContent = `Skip all ${v.group}`;
  const got = P.SLOTS.filter((s) => v.captured[s.id]);
  $('learn-got').textContent = (v.keybed ? `\u2713 Keys (channel ${v.keybed.ch + 1})  ` : '') + got.map((s) => `\u2713 ${s.label}`).join(' ');
  $('learn-got').title = got.map((s) => `${s.label}: ${P.describe(v.captured[s.id])}`).join('\n');
  $('learn-back').disabled = v.step === 0;
}

function exportLayout() {
  const text = JSON.stringify({ v: 1, kind: 'cs80v2-controller', layout: perf.layout, map: diffMap(perf.map), favourites: favs }, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `cs80-controller-${(perf.layout.name || 'layout').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status('Controller setup saved to a file.', 'ok');
}
async function importLayout(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.kind !== 'cs80v2-controller' || !j.layout) throw new Error('not a controller setup file');
    // a file cannot vouch for notes shared with the keys; only Learn can confirm that
    const controls = Object.fromEntries(Object.entries(j.layout.controls || {}).map(([k, c]) => [k, c && { ...c, shared: undefined }]));
    perf.setLayout({ ...j.layout, controls }); save(LS.layout, perf.layout);
    perf.setMap(j.map || {}); save(LS.map, diffMap(perf.map));
    if (Array.isArray(j.favourites)) { favs = j.favourites.slice(0, 4); while (favs.length < 4) favs.push(null); save(LS.favs, favs); buildFavs(); }
    buildLegend();
    status(`Loaded controller setup "${perf.layout.name}".`, 'ok');
  } catch (e) { status('Could not load: ' + e.message, 'err'); }
}
function resetSetup() {
  if (!confirm('Forget the learned controller, your control changes and favourites?')) return;
  for (const k of Object.values(LS)) { try { localStorage.removeItem(k); } catch {} }
  perf.setLayout({ name: '', controls: {} });
  perf.setMap({});
  favs = [null, null, null, null];
  setCcMode('perf');
  try { localStorage.removeItem(LS.mode); } catch {}
  buildFavs(); buildLegend();
  status('Controller setup reset. Use Set up my controller to start again.', 'ok');
}

/* ---- MIDI ------------------------------------------------------------------- */

let midiAccess = null;
const isDaw = (input) => P.isDawPort(input.name || '');
const selectedPortName = () => { const i = midiAccess && midiAccess.inputs.get($('midi-in').value); return i ? i.name : ''; };
// notes, wheels and pressure play only from the selected music input (a DAW port
// would double the notes); learned controls answer from any input, DAW ports included
function portSelected(input) {
  const want = $('midi-in').value;
  if (isDaw(input)) return false;
  return want === 'all' || input.id === want;
}

function describeMsg(bytes) {
  const [st, d1 = 0, d2 = 0] = bytes, ch = (st & 15) + 1;
  switch (st & 0xf0) {
    case 0xb0: return `ch${ch} CC${d1} = ${d2}`;
    case 0x90: return d2 ? `ch${ch} note ${d1} vel ${d2}` : `ch${ch} note ${d1} off`;
    case 0x80: return `ch${ch} note ${d1} off`;
    case 0xe0: return `ch${ch} bend ${(d1 | (d2 << 7)) - 8192}`;
    case 0xd0: return `ch${ch} pressure ${d1}`;
    case 0xa0: return `ch${ch} poly pressure ${d1} = ${d2}`;
    case 0xc0: return `ch${ch} program ${d1}`;
  }
  return null; // clock, active sensing, sysex
}
function monitor(bytes, input, used) {
  const t = describeMsg(bytes);
  if (t) $('monitor').textContent = `last MIDI: ${t}  (${input.name}${used ? '' : ', ignored input'})`;
}

/* ---- guided setup ------------------------------------------------------------
   The keyboard's display is not readable over Web MIDI, so each step checks the
   messages its instructions should produce. Oxygen 49 MKV steps follow the MKV
   user guide v1.2; other controllers get generic text. */
const MANUAL = 'https://cdn.inmusicbrands.com/m-audio/maudio_documentation/Oxygen%20Series%20MKV%20-%20User%20Guide%20-%20v1.2.pdf';
const SETUP = [
  { id: 'mode', title: 'Plain MIDI mode',
    oxygen: `<ol><li>Press <b>DAW/PRESET</b> so its DAW light is on.</li><li>Hold <b>SHIFT</b> and <b>DAW/PRESET</b>, press <b>&lt;</b> or <b>&gt;</b> until the display shows <b>N2</b>, then release. (If nothing changes, hold DAW/PRESET alone and use &lt; or &gt;.)</li></ol><p class="dim">Or use Preset mode: press DAW/PRESET so the light is off, then &lt; or &gt; to preset <b>9</b>, General MIDI.</p><p>Then turn knob 1.</p><p class="small"><a href="${MANUAL}" target="_blank" rel="noopener">Oxygen MKV user guide</a></p>`,
    generic: '<p>Set your controller to send plain MIDI notes and CCs. Many controllers call this MIDI, Generic or User mode. Avoid Mackie or HUI modes.</p><p>Then turn any knob.</p>' },
  { id: 'input', title: 'Pick the keyboard input',
    oxygen: '<p>Choose the input named like <b>Oxygen 49 … USB MIDI</b>, not the one with Mackie or DAW in its name. Then press a key.</p>',
    generic: '<p>Choose your keyboard\'s MIDI input (not a DAW or Mackie input), then press a key.</p>' },
  { id: 'pads', title: 'Pads on channel 10',
    oxygen: '<ol><li>Hit any pad once.</li><li>Hold <b>SHIFT</b> and press the key labelled <b>CHANNEL UP</b> until the display shows <b>10</b> (CHANNEL DOWN goes back).</li><li>Release SHIFT. Hit a pad, then press a key.</li></ol><p class="dim">Keys stay on their own channel, so pads and keys can be told apart.</p>',
    generic: '<p>Set the pads to a different MIDI channel from the keys (channel 10 is common; see your controller\'s manual). Then hit a pad, then press a key.</p>' },
  { id: 'learn', title: 'Learn sliders, knobs and pads',
    oxygen: '<p>The app asks for each control in turn: move it when asked, or press Skip. Each one shows a check as soon as it arrives.</p>',
    generic: '<p>The app asks for each control in turn: move it when asked, or press Skip. Each one shows a check as soon as it arrives.</p>' },
  { id: 'done', title: 'All set', oxygen: '', generic: '' },
];
const setup = { i: 0, oxygen: true, knob: null, key: null, pad: null, padKey: null, waitFor: 'pad', padsSkipped: false };
function openSetupAt(id) {
  setup.i = Math.max(0, SETUP.findIndex((s) => s.id === id));
  $('setup').hidden = false;
  renderSetup();
}
function openSetup() {
  Object.assign(setup, { i: 0, oxygen: isOxygen() || !midiAccess, knob: null, key: null, pad: null, padKey: null, waitFor: 'pad', padsSkipped: false });
  $('learn-nudge').hidden = true;
  openSetupAt('mode');
}
const ok = (pass, text) => ({ pass, text });
function setupChecks(id) {
  const port = selectedPortName();
  if (id === 'mode') {
    const k = setup.knob;
    if (!k) return [ok(null, setup.oxygen ? 'Waiting for knob 1…' : 'Waiting for a knob…')];
    if (k.daw) return [ok(false, `The knob arrived on ${k.port} as a Mackie control. Choose N2 (or Preset 9) and turn it again.`)];
    return [ok(true, `Knob sends plain MIDI (CC${k.n}, channel ${k.ch + 1}) on ${k.port}.`)];
  }
  if (id === 'input') {
    const list = [];
    const inp = midiAccess && midiAccess.inputs.get($('midi-in').value);
    if (inp && isDaw(inp)) list.push(ok(false, `${inp.name} is the DAW port. Pick the USB MIDI one.`));
    else if (!port) list.push(ok(false, 'No single input selected.'));
    else list.push(ok(true, `Input: ${port}.`));
    const k = setup.key;
    if (!k) list.push(ok(null, 'Waiting for a key…'));
    else if (k.port !== port) list.push(ok(false, `That key came from ${k.port}. Select that input above.`));
    else list.push(ok(true, `Keys play on channel ${k.ch + 1}.`));
    return list;
  }
  if (id === 'pads') {
    const list = [], p = setup.pad, k = setup.padKey;
    list.push(!p ? ok(null, setup.waitFor === 'pad' ? 'Hit a pad…' : '') : ok(true, `Pad: channel ${p.ch + 1}${p.daw ? ` on ${p.port}` : ''}.`));
    if (p) list.push(!k ? ok(null, 'Now press a key…') : ok(true, `Keys: channel ${k.ch + 1}.`));
    if (p && k) {
      const apart = p.daw || p.ch !== k.ch || p.port !== k.port;
      list.push(apart ? ok(true, 'Pads and keys are separate.') : ok(false, `Pads and keys share channel ${k.ch + 1}, so a pad looks exactly like a key. Do the steps above, then press Check again.`));
    }
    return list;
  }
  if (id === 'learn') {
    const kb = setup.padKey || setup.key || perf.keybed;
    return [ok(kb ? true : null, kb ? `Keys on channel ${kb.ch + 1} will never trigger actions.` : 'Learn starts by asking for one key press.'),
      ok(setup.padsSkipped ? null : true, setup.padsSkipped ? 'Pads skipped: they keep playing notes.' : 'Pads will be learned.')];
  }
  return [];
}
const setupPassed = (id) => { const c = setupChecks(id); return c.length > 0 && c.every((x) => x.pass === true || (x.pass === null && id === 'learn')); };
function renderSetup() {
  if ($('setup').hidden) return;
  const s = SETUP[setup.i];
  $('setup-step').textContent = `${setup.oxygen ? 'Oxygen 49 MKV' : 'Your controller'} · step ${setup.i + 1} of ${SETUP.length}`;
  $('setup-title').textContent = s.title;
  const extra = $('setup-extra');
  extra.innerHTML = '';
  if (s.id === 'done') $('setup-body').innerHTML = mapSummaryHTML();
  else $('setup-body').innerHTML = setup.oxygen ? s.oxygen : s.generic;
  if (s.id === 'mode') {
    const b = document.createElement('button');
    b.textContent = setup.oxygen ? 'I have a different controller' : 'I have an Oxygen MKV';
    b.onclick = () => { setup.oxygen = !setup.oxygen; renderSetup(); };
    extra.appendChild(b);
  }
  if (s.id === 'input') {
    const sel = $('midi-in').cloneNode(true);
    sel.id = 'setup-input'; sel.value = $('midi-in').value;
    sel.onchange = () => { $('midi-in').value = sel.value; bindMidi(); renderSetup(); };
    const lab = document.createElement('label'); lab.textContent = 'MIDI input '; lab.appendChild(sel);
    extra.appendChild(lab);
  }
  if (s.id === 'pads') {
    const again = document.createElement('button');
    again.textContent = 'Check again';
    again.onclick = () => { setup.pad = null; setup.padKey = null; setup.waitFor = 'pad'; renderSetup(); };
    const skip = document.createElement('button');
    skip.id = 'setup-skip-pads';
    skip.textContent = 'Skip pads';
    skip.title = 'Pads keep playing notes and get no actions';
    skip.onclick = () => { setup.padsSkipped = true; setup.i++; renderSetup(); };
    extra.append(again, skip);
  }
  const checks = setupChecks(s.id);
  $('setup-checks').innerHTML = '';
  for (const c of checks) {
    if (!c.text) continue;
    const li = document.createElement('li');
    li.className = c.pass === true ? 'yes' : c.pass === false ? 'no' : 'wait';
    li.textContent = c.text;
    $('setup-checks').appendChild(li);
  }
  $('setup-back').disabled = setup.i === 0;
  $('setup-skip').hidden = s.id === 'done';
  $('setup-next').textContent = s.id === 'learn' ? 'Start Learn' : s.id === 'done' ? 'Done' : 'Next';
  $('setup-next').disabled = !(s.id === 'learn' || s.id === 'done' || setupPassed(s.id));
}
function mapSummaryHTML() {
  if (!hasLayout()) return '<p>No controls learned yet. You can run Learn any time from the Controls tab.</p>';
  const rows = Object.keys(perf.layout.controls).filter((k) => perf.layout.controls[k]).map((slot) => {
    const s = P.SLOT[slot] || { label: slot.toUpperCase() };
    return `<li><b>${s.label}</b> ${esc(P.targetLabel(perf.map[slot], rawLabel))}</li>`;
  });
  const kb = perf.keybed;
  return `<p>Play a key: it should sound. Move slider 2 for the filter, knob 8 for volume${perf.layout.controls.p2 ? ', pad 2 for the next preset' : ''}.${kb ? ` Keys on channel ${kb.ch + 1} never trigger actions.` : ''}</p><ul class="map-summary">${rows.join('')}</ul><p class="dim small">The Controls tab below shows this map. Click any row there to change it.</p>`;
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function observeSetup(bytes, input) {
  if ($('setup').hidden) return;
  const [st, d1 = 0, d2 = 0] = bytes, ty = st & 0xf0, ch = st & 15;
  const daw = isDaw(input), id = SETUP[setup.i].id;
  const noteOn = ty === 0x90 && d2 > 0;
  if (id === 'mode') {
    if (ty === 0xb0 && !(daw && ((d1 >= 32 && d1 <= 39) || d1 === 15 || d1 === 47))) setup.knob = { ch, n: d1, port: input.name, daw: daw && d1 >= 16 && d1 <= 23 };
    else if (ty === 0xe0 && daw) setup.knob = { ch, n: 0, port: input.name, daw: true };
    else return;
  } else if (id === 'input') {
    if (!noteOn || daw) return;
    setup.key = { ch, port: input.name };
  } else if (id === 'pads') {
    if (!noteOn || (daw && d1 >= 104 && d1 <= 112)) return;
    if (setup.waitFor === 'pad') { setup.pad = { ch, port: input.name, daw }; setup.waitFor = 'key'; }
    else if (setup.waitFor === 'key' && !daw) { setup.padKey = { ch, port: input.name }; setup.waitFor = 'done'; }
    else return;
  } else return;
  renderSetup();
}
$('setup-back').onclick = () => { if (setup.i > 0) { setup.i--; renderSetup(); } };
$('setup-skip').onclick = () => { if (SETUP[setup.i].id === 'pads') setup.padsSkipped = true; setup.i++; renderSetup(); };
$('setup-next').onclick = () => {
  const id = SETUP[setup.i].id;
  if (id === 'learn') {
    $('setup').hidden = true;
    learnFromSetup = true;
    const kb = setup.padKey || setup.key;
    openLearn({ keybed: kb ? { ch: kb.ch, port: kb.port } : null, skipPads: setup.padsSkipped, hardwired: setup.oxygen ? 'oxygen' : '' });
    return;
  }
  if (id === 'done') { $('setup').hidden = true; showPerformanceView('legend'); return; }
  setup.i++; renderSetup();
};
$('setup-close').onclick = () => { $('setup').hidden = true; };

function onMidi(e, input) {
  const bytes = e.data;
  const play = portSelected(input);
  observeSetup(bytes, input);
  if (learn.active && !$('learn').hidden) {
    monitor(bytes, input, true);
    if (learn.feed(bytes, input.name)) return;
  }
  const [st, d1 = 0, d2 = 0] = bytes;
  const ty = st & 0xf0;
  if (assigning) {
    const c = P.controlOf(bytes, input.name, perf.keybed);
    if (c) { monitor(bytes, input, true); finishAssign(c); return; }
  }
  if (ccMode === 'perf') {
    let r;
    fromMidi = true;
    try { r = perf.midi(bytes, input.name); } finally { fromMidi = false; }
    flushFields();
    monitor(bytes, input, play || !!r);
    if (r) { if (!r.detecting) showSlotValue(r); return; }
  } else monitor(bytes, input, play);
  if (!play) return;
  switch (ty) {
    case 0x90: if (d2) noteOn(d1, d2); else noteOff(d1); break;
    case 0x80: noteOff(d1); break;
    case 0xa0: send({ type: 'pp', note: d1, value: d2 }); break;
    case 0xb0:
      // bank select (MSB; the LSB is ignored): takes effect at the next program change
      if (d1 === 0) { midiBank = d2; break; }
      if (d1 === 32) break;
      // performance mode: only the standard performance CCs reach the engine
      if (ccMode === 'perf' && ![1, 7, 11, 64, 120, 123].includes(d1)) break;
      send({ type: 'cc', num: d1, value: d2 }); if (d1 === 1) $('mod').value = d2; if (d1 === 64) $('sustain').checked = d2 >= 64; break;
    case 0xc0: programChange(d1); break;
    case 0xd0: atLevel = 0; send({ type: 'cp', value: d1 }); $('pressure').value = d1; break;
    case 0xe0: send({ type: 'bend', value: d1 | (d2 << 7) }); $('bend').value = (d1 | (d2 << 7)) - 8192; break;
  }
}

function bindMidi() {
  for (const input of midiAccess.inputs.values()) input.onmidimessage = (e) => onMidi(e, input);
  const i = midiAccess.inputs.get($('midi-in').value);
  if (i && isDaw(i)) status(`"${i.name}" is a DAW port and does not play notes. Pick the USB MIDI input to play.`, 'err');
}

let promptedSetup = false;
function listMidi() {
  const sel = $('midi-in');
  const prev = sel.value;
  const inputs = [...midiAccess.inputs.values()];
  sel.innerHTML = '';
  sel.disabled = false;
  sel.add(new Option('none', 'none'));
  sel.add(new Option('all inputs', 'all'));
  for (const i of inputs) sel.add(new Option(isDaw(i) ? `${i.name} (DAW port)` : i.name, i.id));
  const music = inputs.filter((i) => !isDaw(i));
  const oxygen = music.find((i) => /oxygen/i.test(i.name));
  if (inputs.some((i) => i.id === prev) || prev === 'all' || prev === 'none') sel.value = prev;
  else sel.value = oxygen ? oxygen.id : (music.length ? 'all' : 'none');
  bindMidi();
  if (music.length && !hasLayout() && ccMode === 'perf' && !promptedSetup) {
    promptedSetup = true;
    $('learn-nudge').hidden = false;
    $('learn-nudge-text').textContent = `${(oxygen || music[0]).name} connected. A two-minute guided setup gets every slider, knob and pad working.`;
  }
  renderSetup();
}

async function initMidi() {
  if (!navigator.requestMIDIAccess) return;
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    listMidi();
    midiAccess.onstatechange = listMidi;
    $('midi-in').onchange = bindMidi;
  } catch (e) {
    $('midi-in').innerHTML = '<option>MIDI permission denied</option>';
  }
}

function setCcMode(v) {
  ccMode = v; save(LS.mode, v);
  $('cc-map').value = v;
  if (v !== 'perf') send({ type: 'map', which: +v });
  else send({ type: 'map', which: 0 }); // raw CCs no longer reach the map in performance mode
  buildLegend();
}
$('cc-map').onchange = (e) => setCcMode(e.target.value);
$('setup-open').onclick = openSetup;
$('learn-nudge-setup').onclick = openSetup;
$('learn-nudge-x').onclick = () => { $('learn-nudge').hidden = true; };
$('learn-open').onclick = () => openLearn();
$('learn-skip').onclick = () => learn.skip();
$('learn-skip-group').onclick = () => learn.skipGroup();
$('learn-skip-pads').onclick = () => learn.skipGroup();
$('learn-retry').onclick = () => learn.retry();
$('learn-shared').onclick = () => {
  const c = learn.view().conflict;
  if (c && confirm(`Keys that play note ${c.n} on channel ${c.ch + 1} will also trigger this action. Use it anyway?`)) learn.allowShared();
};
$('learn-back').onclick = () => learn.back();
$('learn-done').onclick = () => closeLearn(true);
$('learn-cancel').onclick = () => closeLearn(false);
$('assign-open').onclick = () => startAssign($('assign-target').value || 'lpf');
$('assign-cancel').onclick = cancelAssign;
$('assign-target').onchange = (e) => { if (assigning) assigning = e.target.value; };
$('export-layout').onclick = exportLayout;
$('import-layout').onclick = () => $('import-file').click();
$('import-file').onchange = (e) => { if (e.target.files[0]) importLayout(e.target.files[0]); e.target.value = ''; };
$('reset-setup').onclick = resetSetup;
$('paste-open').onclick = () => { $('paste-box').hidden = !$('paste-box').hidden; if (!$('paste-box').hidden) $('paste').focus(); };
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (assigning) cancelAssign();
  else if (!$('learn').hidden) closeLearn(false);
  else if (!$('setup').hidden) $('setup').hidden = true;
});

/* ---- computer and on-screen keyboards ------------------------------------- */

const KEYMAP = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
let octave = 4, kbVel = 100;
const held = new Map(); // code -> note
const showKbd = () => { $('kbd-state').textContent = `Octave C${octave}, velocity ${kbVel}.`; };

function noteOn(n, v) {
  send({ type: 'on', note: n, vel: v }); keyLight(n, true);
  if (atLevel > 0) send({ type: 'cp', value: atLevel }); // a new voice starts without pressure
}
function noteOff(n) { send({ type: 'off', note: n }); keyLight(n, false); }

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.repeat) { if (KEYMAP.includes(e.code)) e.preventDefault(); return; }
  const i = KEYMAP.indexOf(e.code);
  if (i >= 0) { e.preventDefault(); const n = 12 * (octave + 1) + i; held.set(e.code, n); noteOn(n, kbVel); return; }
  if (e.code === 'KeyZ') octave = Math.max(0, octave - 1);
  else if (e.code === 'KeyX') octave = Math.min(8, octave + 1);
  else if (e.code === 'KeyC') kbVel = Math.max(1, kbVel - 16);
  else if (e.code === 'KeyV') kbVel = Math.min(127, kbVel + 16);
  else return;
  showKbd();
});
document.addEventListener('keyup', (e) => {
  const n = held.get(e.code);
  if (n !== undefined) { held.delete(e.code); noteOff(n); }
});
window.addEventListener('blur', () => { for (const n of held.values()) noteOff(n); held.clear(); });

const keyEls = new Map();
const LO = 36, HI = 96; // C2..C7
function buildKeyboard() {
  const kb = $('keyboard');
  kb.innerHTML = '';
  const whites = [];
  for (let n = LO; n <= HI; n++) if (![1, 3, 6, 8, 10].includes(n % 12)) whites.push(n);
  const ww = 100 / whites.length;
  let wi = 0;
  for (let n = LO; n <= HI; n++) {
    const black = [1, 3, 6, 8, 10].includes(n % 12);
    const k = document.createElement('div');
    k.className = 'key ' + (black ? 'b' : 'w');
    if (black) { k.style.left = `calc(${wi * ww}% - ${ww * 0.3}%)`; k.style.width = `${ww * 0.6}%`; }
    else { k.style.left = `${wi * ww}%`; k.style.width = `${ww}%`; wi++; if (n % 12 === 0) k.innerHTML = `<span class="lbl">C${n / 12 - 1}</span>`; }
    k.dataset.note = n;
    keyEls.set(n, k);
    kb.appendChild(k);
  }
  // velocity from where the key is struck (higher on the key = softer);
  // sliding up or down while held sends poly aftertouch
  const ptr = new Map();
  kb.addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.key'); if (!k) return;
    kb.setPointerCapture(e.pointerId);
    const r = k.getBoundingClientRect();
    const n = +k.dataset.note, vel = Math.max(20, Math.min(127, Math.round(20 + 107 * (e.clientY - r.top) / r.height)));
    ptr.set(e.pointerId, { n, y0: e.clientY });
    noteOn(n, vel);
  });
  kb.addEventListener('pointermove', (e) => {
    const p = ptr.get(e.pointerId); if (!p) return;
    const at = Math.max(0, Math.min(127, Math.round(Math.abs(e.clientY - p.y0) * 2)));
    send({ type: 'pp', note: p.n, value: at });
  });
  const up = (e) => { const p = ptr.get(e.pointerId); if (!p) return; ptr.delete(e.pointerId); noteOff(p.n); };
  kb.addEventListener('pointerup', up);
  kb.addEventListener('pointercancel', up);
}
function keyLight(n, on) { const k = keyEls.get(n); if (k) k.classList.toggle('on', on); }

/* ---- on-screen performance controls (Advanced) ------------------------------- */

$('bend').addEventListener('input', (e) => send({ type: 'bend', value: +e.target.value + 8192 }));
const springBack = () => { $('bend').value = 0; send({ type: 'bend', value: 8192 }); };
$('bend').addEventListener('pointerup', springBack);
$('bend').addEventListener('change', springBack);
$('mod').addEventListener('input', (e) => send({ type: 'cc', num: 1, value: +e.target.value }));
$('pressure').addEventListener('input', (e) => { atLevel = +e.target.value; send({ type: 'cp', value: atLevel }); });
$('sustain').addEventListener('change', (e) => send({ type: 'cc', num: 64, value: e.target.checked ? 127 : 0 }));
$('panic').onclick = () => { send({ type: 'panic' }); keyEls.forEach((k) => k.classList.remove('on')); };
$('copy').onclick = copySettings;
$('load-json').onclick = pasteSettings;
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);

/* ---- output meter (header) ----------------------------------------------------
   dBFS of what is heard: bar = RMS over the last 50 ms, tick = sample peak (held
   briefly), LIM = the engine's output limiter is reducing gain */
const dbText = (g) => (g <= 1e-5 ? '-inf dB' : (g >= 0.9999 ? '0' : (20 * Math.log10(g)).toFixed(1)) + ' dB');
const meterPos = (v) => Math.max(0, Math.min(1, (20 * Math.log10(v + 1e-9) + 60) / 60)); // -60..0 dBFS
let meterHold = { peak: 0, t: 0 }, grHold = 0;
function showMeter(m) {
  const t = performance.now();
  if (m.peak >= meterHold.peak || t - meterHold.t > 1200) meterHold = { peak: m.peak, t };
  $('meter-rms').style.width = (meterPos(m.rms) * 100).toFixed(1) + '%';
  $('meter-peak').style.left = (meterPos(meterHold.peak) * 100).toFixed(1) + '%';
  const db = (v) => (v < 1e-6 ? '-inf' : (20 * Math.log10(v)).toFixed(1));
  const gr = -20 * Math.log10(Math.max(1e-6, m.gr));
  grHold = gr > 0.1 ? t : grHold;
  $('meter-text').textContent = `${db(m.rms)} RMS ${db(meterHold.peak)} pk`;
  $('meter-gr').classList.toggle('on', t - grHold < 300);
  $('meter-gr').textContent = gr > 0.1 ? `LIM -${gr.toFixed(1)}` : 'LIM';
}

/* ---- audio start ------------------------------------------------------------ */

async function start() {
  const btn = $('start');
  if (ctx) {
    if (ctx.state === 'running') { await ctx.suspend(); btn.textContent = 'Resume audio'; btn.classList.remove('running'); }
    else { await ctx.resume(); btn.textContent = 'Audio on'; btn.classList.add('running'); }
    return;
  }
  if (!window.isSecureContext || !window.AudioWorkletNode) { status('This browser cannot run the synth here (it needs HTTPS and a current browser).', 'err'); return; }
  btn.disabled = true;
  status('Loading…');
  try {
    // run at the device's own rate: forcing 48 kHz makes the browser add a
    // resampler and extra buffering (noticeable lag on Bluetooth headphones).
    // The engine supports 8 to 48 kHz; only clamp devices running above that.
    ctx = new AudioContext({ latencyHint: 0 });
    if (ctx.sampleRate > 48000) { await ctx.close(); ctx = new AudioContext({ sampleRate: 48000, latencyHint: 0 }); }
    const [bytes, lib] = await Promise.all([
      fetch('cs80v2.wasm?v=7').then((r) => { if (!r.ok) throw new Error('cs80v2.wasm: HTTP ' + r.status); return r.arrayBuffer(); }),
      loadLibrary(),
      ctx.audioWorklet.addModule('cs80-worklet.js?v=4'),
    ]);
    library = lib;
    node = new AudioWorkletNode(ctx, 'cs80v2', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { wasm: bytes } });
    node.port.onmessage = onWorklet;
    node.connect(ctx.destination);
    await ctx.resume();
    btn.textContent = 'Audio on';
    btn.classList.add('running');
  } catch (e) {
    status('Could not start: ' + e.message, 'err');
    ctx = null;
  }
  btn.disabled = false;
}
$('start').onclick = start;
function latencyMs() {
  if (!ctx) return '?';
  const l = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
  return (l * 1000).toFixed(0);
}

function onWorklet(e) {
  const m = e.data;
  switch (m.type) {
    case 'ready':
      info = m;
      fieldIx = Object.fromEntries(m.fields.map((f, i) => [f, i]));
      buildPanel();
      buildBrowser();
      loadCurrent(); // the engine starts on its own preset 0; show and play the library's first sound
      setCcMode(ccMode);
      if (perf.gain !== 1) send({ type: 'gain', value: perf.gain });
      status('Ready. Play, or pick a preset.', 'ok');
      break;
    case 'patch':
      values = m.values; patchName = m.name;
      refreshPanel();
      perfPatch(m);
      if (patchWaiters.length) { const w = patchWaiters; patchWaiters = []; w.forEach((f) => f()); }
      break;
    case 'meter': showMeter(m); break;
    case 'cpu': {
      const a = Math.min(1, m.avg), p = Math.min(1, m.peak);
      $('cpu-avg').style.width = (a * 100).toFixed(1) + '%';
      $('cpu-peak').style.left = (p * 100).toFixed(1) + '%';
      $('cpu-avg').style.background = a > 0.7 ? 'var(--red)' : a > 0.4 ? 'var(--yellow)' : 'var(--green)';
      $('cpu-text').textContent = `CPU ${(m.avg * 100).toFixed(1)}% avg, ${(m.peak * 100).toFixed(0)}% peak, ${m.voices} voices${m.echo ? ` + ${m.echo} echo` : ''}, ${ctx.sampleRate} Hz, ${latencyMs()} ms output latency`;
      break;
    }
    case 'error':
      status('Engine error: ' + m.message, 'err');
      break;
  }
}

buildKeyboard();
showKbd();
buildFavs();
showSaveTarget();
$('app-version').textContent = 'v' + VERSION;
$('cc-map').value = ccMode;
buildLegend();
initMidi();
