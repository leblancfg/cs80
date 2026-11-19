// Translate presets/presets.json (normalized CS-80 panel fields) into cs80v2
// patches, then level-match each one in the real engine.
//
//   node web/tools/translate_presets.mjs   ->  web/presets-scouted.json
//   python3 web/tools/build_library.py     ->  web/presets-library.json
//
// Each panel field is applied through the engine's own apply_param() (the
// same scaling a MIDI CC gets), so the curves live in one place. Output per
// preset: the full field diff against patch_init(), plus translation notes.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEngine, stats, chordTest } from './wasm.mjs';

const root = new URL('../../', import.meta.url);
const src = JSON.parse(readFileSync(new URL('presets/presets.json', root)));
const eng = loadEngine();
const { w, params: P, fieldIndex: F, fields } = eng;

const FEET = { 16: 0, 8: 1, 4: 3 };
// channel II Param ids follow channel I by CH_STRIDE; the shared block starts after both
const CH_STRIDE = (P.P_RING_A - P.P_PWM_SPEED) / 2;
const TMAX = { A: 3, D: 8, R: 10 }; // seconds at full travel
const set = (name, x) => w.cs80_set_param(P[name], Math.min(1, Math.max(0, x)));
const field = (name, v) => w.cs80_field_set(F[name], v);
const exp01 = (v, lo, hi) => Math.log2(v / lo) / Math.log2(hi / lo); // inverse of expmap

function applyChannel(c, ch, notes) {
  const tag = c ? 'II' : 'I';
  const id = (name) => P[name] + (c ? CH_STRIDE : 0);
  const v = ch.vco;
  const p = (name, x) => w.cs80_set_param(id(name), Math.min(1, Math.max(0, x)));
  // Keep each waveform's level relative to the loudest VCF-path source.
  // VCF level carries the overall amplitude; individual levels carry the mix.
  const osc = Math.max(v.saw, v.square, v.noise);
  p('P_SAW', osc ? v.saw / osc : 0);
  p('P_SQUARE', osc ? v.square / osc : 0);
  p('P_VCF_LEVEL', 0.75 * osc);
  p('P_SINE', 0.75 * v.sine);
  p('P_NOISE', osc ? v.noise / osc : 0);
  p('P_PWM', v.pwm_depth);
  if (v.pwm_depth > 0) p('P_PWM_SPEED', exp01(0.8, 0.1, 40)); // no PWM speed in the source; 0.8 Hz
  if (!(v.feet in FEET)) notes.add(`ch ${tag}: feet ${v.feet} not in 16/8/4, kept 8'`);
  else set(c ? 'P_FEET_II' : 'P_FEET_I', (FEET[v.feet] + 0.5) / 5.99);
  p('P_HPF', ch.hpf.cutoff); p('P_RES_H', ch.hpf.res);
  p('P_LPF', ch.lpf.cutoff); p('P_RES_L', ch.lpf.res);
  // The source gives times as "normalized log 0..1" without a range, and its slow
  // pads sit at 0.5 to 0.8. Through the panel curves (A tops out at 0.885 s)
  // those would all be under 0.3 s, so times use 10 ms .. TMAX on a log scale.
  // IL/AL use 3 octaves at full travel, close to the Core bank's envelopes.
  const pre = c ? 'II.' : 'I.';
  const t = (x, hi) => 0.01 * Math.pow(hi / 0.01, x);
  const e = ch.filter_env;
  field(pre + 'il', 3 * e.IL); field(pre + 'al', 3 * e.AL);
  field(pre + 'fa', t(e.A, TMAX.A)); field(pre + 'fd', t(e.D, TMAX.D)); field(pre + 'fr', t(e.R, TMAX.R));
  const a = ch.vca_env;
  field(pre + 'a', t(a.A, TMAX.A)); field(pre + 'd', t(a.D, TMAX.D)); p('P_S', a.S); field(pre + 'r', t(a.R, TMAX.R));
}

function translate(pr) {
  const q = pr.params;
  const notes = new Set();
  w.cs80_init(48000);
  w.cs80_reset_patch();
  [q.channel_I, q.channel_II].forEach((ch, c) => applyChannel(c, ch, notes));

  // per-channel brilliance and keyboard scaling are global in cs80v2
  const bril = (q.channel_I.brilliance + q.channel_II.brilliance) / 2;
  if (q.channel_I.brilliance !== q.channel_II.brilliance) notes.add('per-channel brilliance averaged into the global Brilliance');
  set('P_BRILLIANCE', bril);
  const kl = (q.channel_I.key_level + q.channel_II.key_level) / 2;
  const kb = (q.channel_I.key_brilliance + q.channel_II.key_brilliance) / 2;
  // 0.5 is neutral; above it the top of the keyboard gets brighter/louder and the bottom darker/softer
  set('P_KBD_LEVEL_HIGH', kl); set('P_KBD_LEVEL_LOW', 1 - kl);
  set('P_KBD_BRIL_HIGH', kb); set('P_KBD_BRIL_LOW', 1 - kb);
  if (q.channel_I.key_level !== q.channel_II.key_level || q.channel_I.key_brilliance !== q.channel_II.key_brilliance)
    notes.add('per-channel keyboard level/brilliance averaged (global in cs80v2)');

  set('P_MIX', 1 - q.balance_I_II); // source 0 = channel I; the Mix lever is up (1) for I
  field('detune_cents', 25 * q.detune); // source detune is an amount; 1.0 = 25 cents on channel II

  // touch response: same for both channels; Level (the dynamics floor) leaves room for the touch terms
  const it = q.initial_touch, at = q.after_touch;
  const floor = Math.min(1, Math.max(0.2, 1 - 0.5 * it.amp - 0.5 * at.amp));
  for (const c of [0, 1]) {
    const pre = c ? 'II.' : 'I.';
    field(pre + 'init_level', it.amp); field(pre + 'after_level', at.amp);
    field(pre + 'init_bril', 3 * it.brilliance); field(pre + 'after_bril', 3 * at.brilliance);
    field(pre + 'level', floor);
  }
  set('P_AT_SUB_SPEED', at.lfo_speed);
  set('P_AT_SUB_VCO', at.lfo_depth);
  set('P_INIT_BEND', q.initial_pitchbend);

  const lfo = q.sub_oscillator_lfo;
  set('P_SUB_SPEED', lfo.speed);
  switch (lfo.dest) {
    case 'vibrato': set('P_SUB_VCO', lfo.depth); break;
    case 'filter': set('P_SUB_VCF', lfo.depth); break;
    case 'tremolo': set('P_SUB_VCA', lfo.depth); break;
    case 'pwm': {
      // cs80v2 has no sub osc -> PWM route; each channel's own PWM LFO takes the speed and depth
      for (const c of [0, 1]) {
        const pre = c ? 'II.' : 'I.';
        field(pre + 'pwm_hz', 0.1 * Math.pow(400, lfo.speed));
        field(pre + 'pwm_depth', Math.max(w.cs80_field_get(F[pre + 'pwm_depth']), 0.4 * lfo.depth));
      }
      notes.add('sub osc -> PWM moved to the channel PWM LFOs (no such route in cs80v2)');
      break;
    }
    case 'ring':
      set('P_RING_SPEED', lfo.speed);
      notes.add('sub osc -> ring mod has no route; its speed became the ring mod speed');
      break;
    default: notes.add(`sub osc destination "${lfo.dest}" untranslatable`);
  }

  const r = q.ring_mod;
  set('P_RING_MOD', r.depth); set('P_RING_SPEED', lfo.dest === 'ring' ? lfo.speed : r.speed);
  set('P_RING_A', r.attack); set('P_RING_D', r.decay); set('P_RING_DEPTH', 0);
  set('P_CHORUS_ON', q.chorus > 0 ? 1 : 0); set('P_CHORUS_DEPTH', q.chorus);
  set('P_TREM_ON', q.tremolo > 0 ? 1 : 0); set('P_TREM_DEPTH', q.tremolo);

  const vals = eng.getAll();
  return { vals, notes: [...notes] };
}

// loudest 100 ms window of the chord test, so plucks and pads compare fairly
function measure(loadFn) {
  w.cs80_init(48000);
  loadFn();
  const s = chordTest(eng);
  const win = 4800;
  let best = { rms: 0, finite: true, peak: 0 };
  for (let i = 0; i + win <= s.L.length; i += win) {
    const m = stats(s, i, i + win);
    if (!m.finite) return m;
    if (m.rms > best.rms) best = { ...m, peak: Math.max(best.peak, m.peak) };
    else best.peak = Math.max(best.peak, m.peak);
  }
  best.dbfs = 20 * Math.log10(best.rms + 1e-12);
  return best;
}

const loadVals = (vals) => vals.forEach((v, i) => w.cs80_field_set(i, v));

// level match: the same chord as the Core bank, scaled to the Core bank's median RMS
const core = eng.presets.map((_, i) => measure(() => w.cs80_load_preset(i)).rms);
const target = [...core].sort((a, b) => a - b)[Math.floor(core.length / 2)];

// defaults to diff against
w.cs80_init(48000); w.cs80_reset_patch();
const defaults = eng.getAll();

const out = [], failed = [];
for (const pr of src) {
  const { vals, notes } = translate(pr);
  const m = measure(() => loadVals(vals));
  const iMaster = F.master;
  if (!m.finite || m.rms < 1e-5) { failed.push({ name: pr.name, reason: m.finite ? 'silent' : 'non-finite output' }); continue; }
  vals[iMaster] = Math.min(8, vals[iMaster] * (target / m.rms));
  const m2 = measure(() => loadVals(vals));
  // the engine's output limiter takes the peaks; keep the chord within +6 dBFS before it
  const pre = w.cs80_lim_peak_in();
  if (pre > 2) vals[iMaster] *= 2 / pre;
  const diff = {};
  vals.forEach((v, i) => { if (Math.abs(v - defaults[i]) > 1e-6) diff[fields[i]] = +v.toPrecision(4); });
  out.push({ bank: pr.bank, slot: pr.slot, name: pr.name, confidence: pr.confidence, reference: pr.reference,
    fields: diff, notes, level_db: +m2.dbfs.toFixed(1) });
}

writeFileSync(new URL('web/presets-scouted.json', root), JSON.stringify({ target_rms: target, presets: out }));
const counts = {};
for (const p of out) for (const n of p.notes) counts[n] = (counts[n] || 0) + 1;
console.log(`translated ${out.length}/${src.length}; core median RMS ${(20 * Math.log10(target)).toFixed(1)} dBFS`);
console.log('notes:', counts);
console.log('failed:', failed);
