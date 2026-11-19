// Build cs80v2 presets from published CS-80 panel charts.
//
//   node presets/charts/chart_presets.mjs   ->  presets/charts/cs80v2_chart_presets.json
//
// Input: presets/charts/charts.json (the charts, in the instrument's own panel units) and
// presets/charts/yamaha_preset_tones.json (Yamaha's 22 preset tones as panel positions,
// for charts that call a channel by its preset tone).
//
// Units, as printed on the CS-80:
//   channel sliders: 0 (bottom) .. 10 (top) on the printed scale, switches true = on
//   control-panel paddles (sub oscillator, ring modulator, touch response, Resonance):
//     0 = pushed up (off) .. 10 = pulled fully toward the player
//   two-way paddles (Detune, Mix, Brilliance, keyboard control): -5 .. +5 from the centre,
//     + = pulled toward the player (Detune sharp, Mix toward II, Brilliance brighter)
//   left-hand panel: Sustain and Portamento 0..10 (short .. long), chorus/tremolo knobs 0..10
// Every value goes through the engine's own panel scaling (apply_param via cs80_set_param),
// so a chart preset is exactly what the same lever positions give on the cs80v2 panel. If a
// chart sounds wrong here, the panel curve is wrong, not the chart.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEngine } from '../../web/tools/wasm.mjs';

const here = new URL('./', import.meta.url);
const charts = JSON.parse(readFileSync(new URL('charts.json', here))).charts;
const tones = Object.fromEntries(JSON.parse(readFileSync(new URL('yamaha_preset_tones.json', here))).tones.map((t) => [t.tone, t]));
const eng = loadEngine();
const { w, params: P, fieldIndex: F, fields } = eng;
const CH_STRIDE = (P.P_RING_A - P.P_PWM_SPEED) / 2;
const SLIDER = { speed: 'P_PWM_SPEED', pwm: 'P_PWM', pw: 'P_PW', noise: 'P_NOISE', hpf: 'P_HPF', res_h: 'P_RES_H', lpf: 'P_LPF',
  res_l: 'P_RES_L', il: 'P_IL', al: 'P_AL', fa: 'P_FA', fd: 'P_FD', fr: 'P_FR', vcf_level: 'P_VCF_LEVEL', sine: 'P_SINE',
  a: 'P_A', d: 'P_D', s: 'P_S', r: 'P_R', level: 'P_LEVEL', init_bril: 'P_INIT_BRIL', init_level: 'P_INIT_LEVEL',
  after_bril: 'P_AFTER_BRIL', after_level: 'P_AFTER_LEVEL' };
const FEET = ["16'", "8'", "5 1/3'", "4'", "2 2/3'", "2'"];
// the CS-80's sub-oscillator functions, top to bottom, and cs80v2's SubWave numbers
const SUBFN = { sine: 0, saw: 1, 'saw down': 1, 'inverted saw': 2, 'saw up': 2, square: 3, 'sample and hold': 4, noise: 5 };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const set = (name, x) => { if (P[name] === undefined) throw new Error('no param ' + name); w.cs80_set_param(P[name], clamp01(x)); };
const lever = (v) => (v ?? 0) / 10;          // 0..10 from the top (off)
const twoWay = (v) => 0.5 + (v ?? 0) / 10;   // -5..+5 from the centre
const enumX = (i, n) => (i + 0.5) / n;        // apply_param takes enums as x * (n - 0.01)

function channel(c, spec, notes) {
  const t = spec.tone ? tones[spec.tone] : null;
  if (spec.tone && !t) throw new Error('unknown preset tone ' + spec.tone);
  const s = { ...(t ? t.sliders : {}), ...(spec.sliders || {}) };
  const square = spec.square ?? (t ? t.square : false), saw = spec.saw ?? (t ? t.saw : false);
  for (const [k, p] of Object.entries(SLIDER)) {
    if (s[k] === undefined || s[k] === null) throw new Error(`channel ${c ? 'II' : 'I'}: no ${k}`);
    w.cs80_set_param(P[p] + (c ? CH_STRIDE : 0), clamp01(s[k] / 10));
  }
  w.cs80_set_param(P.P_SQUARE + (c ? CH_STRIDE : 0), square ? 1 : 0);
  w.cs80_set_param(P.P_SAW + (c ? CH_STRIDE : 0), saw ? 1 : 0);
  if (t) notes.push(`channel ${c ? 'II' : 'I'}: Yamaha's ${t.tone} tone (owner's manual p. ${t.manual_page})` + (spec.sliders ? ', with changes' : ''));
}

function build(ch) {
  const notes = [...(ch.notes || [])];
  w.cs80_init(48000);
  w.cs80_reset_patch();
  channel(0, ch.channels.I, notes);
  channel(1, ch.channels.II, notes);
  const p = ch.panel || {};
  set('P_FEET_I', enumX(FEET.indexOf(p.feet_I ?? "8'"), 6));
  set('P_FEET_II', enumX(FEET.indexOf(p.feet_II ?? "8'"), 6));
  set('P_DETUNE', twoWay(p.detune));
  set('P_MIX', twoWay(p.mix));
  set('P_BRILLIANCE', twoWay(p.brilliance));
  set('P_RESONANCE', lever(p.resonance));
  const sub = p.sub || {};
  set('P_SUB_FUNCTION', enumX(SUBFN[sub.function ?? 'sine'], 6));
  set('P_SUB_SPEED', lever(sub.speed)); set('P_SUB_VCO', lever(sub.vco)); set('P_SUB_VCF', lever(sub.vcf)); set('P_SUB_VCA', lever(sub.vca));
  const tr = p.touch || {};
  set('P_INIT_BEND', lever(tr.pitch_bend)); set('P_AT_SUB_SPEED', lever(tr.speed)); set('P_AT_SUB_VCO', lever(tr.vco)); set('P_AT_SUB_VCF', lever(tr.vcf));
  const kb = p.kbd || {};
  set('P_KBD_BRIL_LOW', twoWay(kb.bril_low)); set('P_KBD_BRIL_HIGH', twoWay(kb.bril_high));
  set('P_KBD_LEVEL_LOW', twoWay(kb.level_low)); set('P_KBD_LEVEL_HIGH', twoWay(kb.level_high));
  const rg = p.ring || {};
  set('P_RING_A', lever(rg.attack)); set('P_RING_D', lever(rg.decay)); set('P_RING_DEPTH', lever(rg.depth));
  set('P_RING_SPEED', lever(rg.speed)); set('P_RING_MOD', lever(rg.mod));
  set('P_SUSTAIN_TIME', lever(p.sustain)); set('P_PORTA_TIME', lever(p.portamento)); set('P_GLISS', p.gliss ? 1 : 0);
  const co = p.chorus || {};
  set('P_CHORUS_ON', co.on && !co.tremolo ? 1 : 0); set('P_TREM_ON', co.on && co.tremolo ? 1 : 0);
  set('P_CHORUS_SPEED', lever(co.speed)); set('P_CHORUS_DEPTH', lever(co.depth));
  set('P_TREM_SPEED', lever(co.speed)); set('P_TREM_DEPTH', lever(co.depth));
  set('P_REVERB_MIX', 0); // the CS-80 has no reverb
  w.cs80_field_set(F['fx.echo_mode'], 0);
  const out = {};
  fields.forEach((f, i) => { out[f] = +w.cs80_field_get(i).toPrecision(5); });
  return { fields: out, notes };
}

const presets = charts.map((ch) => {
  const { fields: f, notes } = build(ch);
  return { bank: ch.bank, name: ch.name, reference: ch.reference, chart_source: ch.chart_source, source_urls: ch.source_urls,
    confidence: ch.confidence, chart: { channels: ch.channels, panel: ch.panel }, notes, fields: f };
});
writeFileSync(new URL('cs80v2_chart_presets.json', here), JSON.stringify({
  source: 'published CS-80 panel charts (presets/charts/charts.json), through the cs80v2 panel curves', presets }, null, 1));
for (const p of presets) console.log(`${p.bank.padEnd(16)} ${p.name.padEnd(36)} detune ${p.fields.detune_cents.toFixed(1)} ct  I.lpf ${p.fields['I.lpf_hz'].toFixed(0)} Hz  I.a ${p.fields['I.a'].toFixed(3)} s`);
