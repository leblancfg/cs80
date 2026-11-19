// Performance-layer test: simulated controller messages go through perf.js
// (learn wizard, macros, pickup, actions) into the real AudioWorklet
// processor (cs80-worklet.js, with a stubbed AudioWorklet scope) and the
// real cs80v2.wasm. Checks that targets move around the preset value, that
// presets keep their character at the pickup position, and that master
// volume at 0 is silent.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const P = require('../perf.js');
const here = (f) => new URL('../' + f, import.meta.url);

let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/* ---- the worklet, in a stub AudioWorkletGlobalScope ---- */
let Proc = null;
const scope = {
  sampleRate: 48000, performance, WebAssembly, console, Float32Array, Uint8Array, Math, String, Date,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => this.port.onposted && this.port.onposted(m) }; } },
  registerProcessor: (name, cls) => { Proc = cls; },
};
vm.runInNewContext(readFileSync(here('cs80-worklet.js'), 'utf8'), scope);
const wasm = readFileSync(here('cs80v2.wasm'));
const posted = [];
const proc = await new Promise((resolve) => {
  // boot() is async, so onposted is in place before the first message
  const p = new Proc({ processorOptions: { wasm } });
  p.port.onposted = (m) => { posted.push(m); if (m.type === 'ready') resolve(p); };
});
const ready = posted.find((m) => m.type === 'ready');
const fields = ready.fields, fieldIx = Object.fromEntries(fields.map((f, i) => [f, i]));
const toWorklet = (m) => proc.port.onmessage({ data: m });
const lastPatch = () => posted.filter((m) => m.type === 'patch').pop();
const engineValue = (f) => proc.w.cs80_field_get(fieldIx[f]);
const snapshot = () => Object.fromEntries(fields.map((f, i) => [f, proc.w.cs80_field_get(i)]));
function render(seconds) {
  const L = new Float32Array(128), R = new Float32Array(128);
  let ss = 0, n = 0, peak = 0;
  for (let b = 0; b < Math.ceil(seconds * 48000 / 128); b++) {
    proc.process([], [[L, R]]);
    for (let i = 0; i < 128; i++) { ss += L[i] * L[i] + R[i] * R[i]; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
    n += 256;
  }
  return { rms: Math.sqrt(ss / n), peak };
}

/* ---- the performance layer, wired like app.js ---- */
const actions = [];
let pending = [];
const fwd = (m, x) => (m[0] === 'lin' ? m[1] * x : m[0] === 'exp' ? m[1] * Math.pow(m[2] / m[1], x) : x);
const inv = (m, v) => Math.min(1, Math.max(0, m[0] === 'lin' ? v / m[1] : m[0] === 'exp' ? Math.log(v / m[1]) / Math.log(m[2] / m[1]) : v));
const RAW = { 'I.pw': { m: ['lin', 0.4] }, 'sub_hz': { m: ['exp', 0.5, 100] } };
const perf = P.create({
  emit(m) {
    if (m.type === 'field') pending.push([fieldIx[m.name], m.value]);
    else if (m.type === 'gain') toWorklet({ type: 'gain', value: m.value });
    else { actions.push(m.id); if (m.id === 'preset_reset') perf.resetPreset(); } // as app.js doAction
  },
  raw: (f) => RAW[f] || null, fwd, inv,
});
const midi = (bytes, port = 'Oxygen 49 USB MIDI') => { const r = perf.midi(bytes, port); if (pending.length) { toWorklet({ type: 'fields', pairs: pending }); pending = []; } return r; };
const cc = (n, v, ch = 0) => midi([0xb0 | ch, n, v]);
function loadPreset(i) {
  toWorklet({ type: 'preset', index: i });
  const m = lastPatch();
  check(m.reason === 'load', `preset ${i} load is flagged reason=load`);
  perf.rebase(Object.fromEntries(fields.map((f, k) => [f, m.values[k]])));
}

/* ---- 1. Learn wizard: an "unknown" unit with CCs 40-48 / 60-67, pads notes 36-43 on ch10 ---- */
const learn = P.learner();
learn.start();
check(learn.view().slot === 'kb', 'wizard: starts by asking for one key');
learn.feed([0x90, 60, 90], 'Oxygen 49 USB MIDI');
check(learn.view().slot === 's1' && learn.keybed.ch === 0 && learn.keybed.port === 'Oxygen 49 USB MIDI', 'wizard: the key press records the keybed channel and input');
const SL = [40, 41, 42, 43, 44, 45, 46, 47, 48], KN = [60, 61, 62, 63, 74, 75, 76, 77];
for (const n of SL) learn.feed([0xb0, n, 64], 'Oxygen 49 USB MIDI');
check(learn.view().slot === 'k1', 'wizard: 9 sliders captured, now asking for knob 1');
learn.feed([0xb0, 48, 65], 'Oxygen 49 USB MIDI'); // slider 9 still settling: ignored
check(learn.view().slot === 'k1', 'wizard: jitter from the previous slider is not captured');
learn.feed([0x90, 104, 127], 'Oxygen 49 MKV Mackie/HUI'); // fader touch from the DAW port
learn.feed([0xf0, 0x00, 0x00, 0x66, 0x14, 0x00, 0xf7], 'Oxygen 49 MKV Mackie/HUI'); // SysEx
check(learn.view().slot === 'k1' && !learn.view().captured.k1, 'wizard: Mackie fader touch and SysEx are not captured');
for (const n of KN) learn.feed([0xb0, n, 10], 'Oxygen 49 USB MIDI');
learn.skip(); // pad 1 skipped
for (let p = 1; p < 8; p++) { learn.feed([0x99, 36 + p, 100], 'Oxygen 49 USB MIDI'); learn.feed([0x89, 36 + p, 0], 'Oxygen 49 USB MIDI'); }
check(learn.view().slot === 'b1', 'wizard: pads captured, now on the under-slider buttons');
for (let i = 0; i < 9; i++) learn.feed([0xb0, 80 + i, 127], 'Oxygen 49 USB MIDI');
check(learn.view().slot === 't_loop', 'wizard: nine under-slider buttons captured');
const captured = learn.finish();
check(captured.s1.n === 40 && captured.s9.n === 48 && captured.k8.n === 77, 'wizard: slider/knob CCs stored');
check(!captured.p1 && captured.p2.t === 'note' && captured.p2.ch === 9 && captured.p2.n === 37 && captured.b9.n === 88, 'wizard: pad 2 and button under slider 9 saved');
perf.setLayout({ name: 'test', controls: captured });

/* ---- 2. relative macros around the preset ---- */
loadPreset(1);
const base = snapshot();
let r = cc(41, 64); // slider 2 (LPF) first touch: picks up here, no jump
check(r.d === 0 && near(engineValue('I.lpf_hz'), base['I.lpf_hz']), 'LPF: first touch at the pickup position = preset cutoff');
cc(41, 127);
check(near(engineValue('I.lpf_hz'), Math.min(20000, base['I.lpf_hz'] * 16)) && near(engineValue('II.lpf_hz'), Math.min(20000, base['II.lpf_hz'] * 16)), `LPF: full up = +4 octaves on both channels (${engineValue('I.lpf_hz').toFixed(0)} Hz)`);
cc(41, 0);
check(near(engineValue('I.lpf_hz'), Math.max(37.1, base['I.lpf_hz'] / 16)), 'LPF: full down = -4 octaves');
cc(41, 64);
check(near(engineValue('I.lpf_hz'), base['I.lpf_hz']), 'LPF: back at the pickup position = preset value again');

cc(40, 64); cc(40, 127);
check(near(engineValue('brilliance'), 3), 'Brilliance: full up = +3 oct');
cc(43, 64); cc(43, 96);
check(engineValue('I.hpf_hz') > base['I.hpf_hz'] && engineValue('II.hpf_hz') > base['II.hpf_hz'], 'HPF: moves up on both channels');
cc(45, 64); cc(45, 127);
check(engineValue('I.a') > base['I.a'] && engineValue('I.fa') > base['I.fa'] && engineValue('II.a') > base['II.a'], 'Attack: VCA and filter env slower, both channels');
cc(46, 64); cc(46, 0);
check(engineValue('I.r') < base['I.r'] && engineValue('II.fr') < base['II.fr'], 'Release: shorter on both channels');
cc(47, 64); cc(47, 0);
check(near(engineValue('mix'), 1), 'Balance: full down = channel II only, as on the faceplate');
cc(47, 127);
check(near(engineValue('mix'), -1), 'Balance: full up = channel I only');
perf.setMap({ s9: 'vibrato' }); // assignable; slider 9 defaults to aftertouch
cc(48, 64); cc(48, 127);
check(near(engineValue('sub_vco'), Math.max(1.5, base.sub_vco)), 'Vibrato: full up = 1.5 st sub-osc to pitch');
perf.setMap({});

// knob 1 chorus from zero switches the chorus on; back to zero restores the switch
loadPreset(3);
const b3 = snapshot();
cc(60, 0); cc(60, 127);
check(near(engineValue('chorus.chorus_depth'), 1) && engineValue('chorus.chorus_on') === 1, `Chorus depth: full up = 1, chorus on (preset had on=${b3['chorus.chorus_on']})`);
cc(62, 0); cc(62, 127);
check(near(engineValue('fx.echo_mix'), 1) && engineValue('fx.echo_mode') >= 1, 'Echo mix: full up = 1, echo on');
cc(63, 64); cc(63, 127);
check(engineValue('fx.echo_time') > b3['fx.echo_time'] && engineValue('fx.echo_fb') <= b3['fx.echo_fb'] + 1e-6, 'Echo time: longer, feedback not raised');
cc(76, 0); cc(76, 127);
check(near(engineValue('ring_mod'), 1), 'Ring mod: full up = 1');

/* ---- 3. soft takeover across a preset change ---- */
cc(41, 120); // slider 2 left near the top before the preset change
loadPreset(1);
const b1 = snapshot();
r = cc(41, 121); // the next step after the change
const jump = Math.log2(engineValue('I.lpf_hz') / b1['I.lpf_hz']);
check(jump > 0 && jump < 0.2, `pickup: after a preset change the next step moves the cutoff only ${jump.toFixed(3)} oct (no jump)`);
cc(41, 127);
check(engineValue('I.lpf_hz') > b1['I.lpf_hz'], 'pickup: the short way up still opens the filter');
cc(41, 0);
check(near(engineValue('I.lpf_hz'), Math.max(37.1, b1['I.lpf_hz'] / 16)), 'pickup: and the full range down is still there');

/* ---- 4. raw field assignment with pickup ---- */
perf.setMap({ s3: 'field:I.pw' });
const pw0 = engineValue('I.pw'), target = Math.round(inv(['lin', 0.4], pw0) * 127);
cc(42, target > 64 ? 0 : 127);
check(near(engineValue('I.pw'), pw0), 'raw field: away from the current value it waits (pickup)');
cc(42, target);
cc(42, target > 64 ? target - 10 : target + 10);
check(!near(engineValue('I.pw'), pw0), 'raw field: once picked up it follows the control');
perf.setMap({});

/* ---- 5. actions from pads ---- */
actions.length = 0;
midi([0x99, 37, 100]); midi([0x89, 37, 0]); // pad 2
midi([0x99, 40, 90]);                          // pad 5
check(actions.join() === 'preset_next,fav1', `pad 2 and pad 5 fire next preset and favourite 1 [${actions}]`);
check(cc(20, 64) === null, 'unlearned CCs are not consumed');

/* ---- 6. master volume (absolute, post-FX) ---- */
loadPreset(0); // preset 0 has echo, plate and chorus
[48, 52, 55, 60].forEach((n) => toWorklet({ type: 'on', note: n, vel: 110 }));
const loud = render(0.5);
check(loud.rms > 1e-3, `master: preset 0 chord audible (rms ${loud.rms.toExponential(2)})`);
cc(77, 127);
check(near(perf.gain, 1), 'master: knob 8 full = gain 1 (absolute, no pickup)');
cc(77, 0);
render(0.01); // one ramped block
const quiet = render(0.5);
check(quiet.peak === 0, `master: knob 8 at 0 is silent, including the echo and reverb tails (peak ${quiet.peak})`);
cc(77, 90);
const back = render(0.3);
check(back.rms > 1e-4, 'master: turning it back up brings the sound back');
toWorklet({ type: 'panic' });

/* ---- 7. Oxygen MKV in DAW mode (M|h profile): everything on the Mackie/HUI port ----
   faders = pitch bend ch1-9, knobs = V-pots CC16-23 relative, pads = Mackie button notes */
const MK = 'Oxygen 49 MKV Mackie/HUI', USB = 'Oxygen 49 MKV USB MIDI';
const pb = (ch, x) => { const v = Math.round(x * 16383); return [0xe0 | ch, v & 127, v >> 7]; };
const learn2 = P.learner();
learn2.start({}, { keybed: { ch: 0, port: 'Oxygen 49 USB MIDI' } });
for (let i = 0; i < 9; i++) {
  learn2.feed([0x90, 104 + i, 127], MK);            // touch first
  learn2.feed(pb(i, 0.5), MK); learn2.feed(pb(i, 0.52), MK);
  learn2.feed([0x90, 104 + i, 0], MK);
}
check(/N2/.test(learn2.view().tip) && !learn2.view().hint, 'Mackie: soft tip about N2, no blocking hint');
for (let i = 0; i < 8; i++) { learn2.feed([0xb0, 16 + i, 1], MK); learn2.feed([0xb0, 16 + i, 1], MK); }
for (let i = 0; i < 8; i++) { learn2.feed([0x90, 24 + i, 127], MK); learn2.feed([0x90, 24 + i, 0], MK); }
learn2.feed([0xe0, 0, 80], USB); // the pitch wheel on the music port is not a fader
check(learn2.view().slot === 'b1', 'Mackie: faders, V-pots and pads learned; now on under-slider buttons');
for (let i = 0; i < 9; i++) learn2.feed([0x90, 40 + i, 127], MK);
check(learn2.view().slot === 't_loop', 'Mackie: all nine under-slider buttons learned');
const cap2 = learn2.finish();
check(cap2.s1.t === 'pb' && cap2.s1.ch === 0 && cap2.s9.ch === 8 && cap2.s2.port === MK, 'Mackie: faders = pitch bend ch1..9 on the DAW port');
check(cap2.k1.t === 'cc' && cap2.k1.n === 16 && cap2.k1.rel === 'sm' && cap2.k8.n === 23, 'Mackie: knobs = V-pots CC16..23, sign-magnitude relative');
check(cap2.p1.t === 'note' && cap2.p1.n === 24 && cap2.p8.n === 31, 'Mackie: pads = button notes');
check(cap2.b1.t === 'note' && cap2.b1.n === 40 && cap2.b9.n === 48 && !P.DEFAULT_MAP.b1, 'Mackie: under-slider buttons are saved but unassigned');
perf.setLayout({ name: MK, controls: cap2 });
loadPreset(1);
const m1 = snapshot();
midi(pb(1, 0.5), MK);
r = midi(pb(1, 1), MK);
check(r && r.slot === 's2' && near(engineValue('I.lpf_hz'), Math.min(20000, m1['I.lpf_hz'] * 16)), `Mackie fader 2 (pitch bend ch2) drives LPF: ${engineValue('I.lpf_hz').toFixed(0)} Hz`);
midi(pb(1, 0), MK);
check(near(engineValue('I.lpf_hz'), Math.max(37.1, m1['I.lpf_hz'] / 16)), `Mackie fader 2 down: -4 octaves (${engineValue('I.lpf_hz').toFixed(1)} vs ${m1['I.lpf_hz'].toFixed(1)}, d ${perf.state('s2').d})`);
check(midi([0xe0, 0, 80], USB) === null, 'pitch wheel on the music port is not taken by fader 1 (ch1 bend on the DAW port)');
check(midi([0x90, 60, 100], MK) === null, 'an unlearned note from the DAW port is not consumed (app.js never plays DAW notes)');
loadPreset(3);
const m3 = snapshot();
for (let k = 0; k < 25; k++) midi([0xb0, 16, 1], MK);  // V-pot 1 clockwise, 25 ticks
const ch25 = engineValue('chorus.chorus_depth');
check(perf.state('k1').d > 0.45 && ch25 > m3['chorus.chorus_depth'], `V-pot 1 clockwise: chorus depth ${m3['chorus.chorus_depth'].toFixed(2)} -> ${ch25.toFixed(2)} (d ${perf.state('k1').d.toFixed(2)})`);
for (let k = 0; k < 10; k++) midi([0xb0, 16, 65 + 4], MK); // counterclockwise, 4 ticks each
check(perf.state('k1').d < 0 && engineValue('chorus.chorus_depth') < ch25, 'V-pot 1 counterclockwise (65..127) brings it back down past the preset');
for (let k = 0; k < 80; k++) midi([0xb0, 16, 1], MK);
check(near(perf.state('k1').d, 1) && near(engineValue('chorus.chorus_depth'), 1), 'V-pot accumulates and clamps at full');
loadPreset(3);
check(perf.state('k1').h === 0.5 && near(engineValue('chorus.chorus_depth'), m3['chorus.chorus_depth']), 'V-pot: a preset load re-centres it (pickup at the preset value)');
midi([0xb0, 16, 1], MK);
check(perf.state('k1').d > 0 && perf.state('k1').d < 0.05, 'V-pot: the next tick after a load is a small step');
const g0 = perf.gain;
for (let k = 0; k < 20; k++) midi([0xb0, 23, 65], MK); // V-pot 8: master down
check(perf.gain < g0 && perf.gain > 0, `V-pot 8 (master) turns down relative to where it was: ${g0.toFixed(2)} -> ${perf.gain.toFixed(2)}`);
for (let k = 0; k < 200; k++) midi([0xb0, 23, 65 + 15], MK);
check(perf.gain === 0, 'V-pot 8 all the way down = silent');
for (let k = 0; k < 200; k++) midi([0xb0, 23, 15], MK);
check(near(perf.gain, 1), 'and all the way up = 1');
actions.length = 0;
midi([0x90, 25, 127], MK); midi([0x90, 25, 0], MK);
check(actions.join() === 'preset_next', 'Mackie button note (pad 2) fires next preset on press only');

/* ---- 8. HUI faders: CC n MSB + CC 32+n LSB on the DAW port ---- */
const learn3 = P.learner();
learn3.start({}, { keybed: { ch: 0, port: 'Oxygen 49 USB MIDI' } });
learn3.feed([0xb0, 0, 64], MK); learn3.feed([0xb0, 32, 5], MK);
learn3.feed([0xb0, 1, 64], MK); learn3.feed([0xb0, 33, 5], MK);
const cap3 = learn3.finish();
check(cap3.s1.n === 0 && cap3.s2.n === 1 && !cap3.s3, 'HUI: faders learn as CC 0 and 1; the LSB CCs are not captured as other controls');
perf.setLayout({ name: 'hui', controls: cap3 });
loadPreset(1);
midi([0xb0, 1, 64], MK); midi([0xb0, 33, 0], MK);
midi([0xb0, 1, 127], MK); r = midi([0xb0, 33, 127], MK);
check(r && r.slot === 's2' && r.d === 1, 'HUI: MSB + LSB pair drives slider 2 to full');

/* ---- 9. generic relative CC auto-detect (two's complement / offset) ---- */
const learn4 = P.learner();
learn4.start({}, { keybed: { ch: 0, port: 'Oxygen 49 USB MIDI' } });
for (const v of [127, 127, 127, 127]) learn4.feed([0xb0, 70, v], USB);   // knob as slider 1: two's complement down
for (const v of [65, 65, 63, 65]) learn4.feed([0xb0, 71, v], USB);       // slider 2: offset binary
for (const v of [64, 70, 80, 90]) learn4.feed([0xb0, 72, v], USB);       // slider 3: absolute
const cap4 = learn4.finish();
check(cap4.s1.rel === 'tc' && cap4.s2.rel === 'bo' && cap4.s3.rel === false, `relative auto-detect in Learn: ${cap4.s1.rel}, ${cap4.s2.rel}, ${cap4.s3.rel}`);
let saved = 0;
const perf2 = P.create({ emit() {}, raw: () => null, fwd, inv, onLayout: () => saved++ });
perf2.setLayout({ name: 'x', controls: { k1: { t: 'cc', ch: 0, n: 80, port: USB }, k2: { t: 'cc', ch: 0, n: 81, port: USB } } });
perf2.rebase(snapshot());
const rs = [1, 1, 1].map((v) => perf2.midi([0xb0, 80, v], USB));
check(rs[0].detecting && rs[1].detecting && !rs[2].detecting && perf2.layout.controls.k1.rel === 'tc' && saved === 1, 'runtime: an undecided CC sending 1,1,1 becomes relative (held while guessing, layout saved)');
perf2.midi([0xb0, 81, 40], USB);
check(perf2.layout.controls.k2.rel === false && perf2.state('k2').h === 40 / 127, 'runtime: a mid-range value decides absolute at once');

/* ---- 10. A pad note on the keybed channel must never steal a key ---- */
const learn5 = P.learner();
learn5.start();
check(learn5.feed([0x90, 64, 90], USB) === false, 'keybed step: the key still sounds');
learn5.feed([0x80, 64, 0], USB);
check(learn5.view().slot === 's1' && learn5.keybed.ch === 0, 'keybed step: channel 1 recorded');
check(learn5.feed([0x90, 60, 90], USB) === false && learn5.feed([0x80, 60, 0], USB) === false, 'N2: a key during a slider step passes through (plays, note-off too)');
check(learn5.view().slot === 's1' && !learn5.view().hint, 'N2: a key during a slider step is not captured and needs no hint');
for (let i = 0; i < 17; i++) learn5.skip();
check(learn5.view().slot === 'p1', 'N2: at pad 1');
check(learn5.feed([0x90, 36, 100], USB) === false, 'N2: a pad note on the keybed channel plays instead of binding');
check(learn5.feed([0x80, 36, 0], USB) === false, 'N2: its note-off reaches the player (no hanging note)');
const v5 = learn5.view();
check(v5.slot === 'p1' && v5.conflict && v5.conflict.ch === 0 && v5.conflict.group === 'pads', 'N2: the wizard stops with a conflict instead of binding');
learn5.feed([0x90, 37, 100], USB); learn5.feed([0x80, 37, 0], USB);
check(learn5.view().slot === 'p1' && !learn5.view().captured.p1, 'N2: more shared notes are still not bound');
learn5.skipGroup();
check(learn5.view().slot === 'b1' && !learn5.view().conflict, '"Skip pads" jumps past all eight pads');
const cap5 = learn5.finish();
check(!Object.keys(cap5).some((k) => k[0] === 'p'), 'N2: no pad note saved');
// retry: pads moved to channel 10 are detected by themselves
const learn6 = P.learner(); learn6.start({}, { keybed: { ch: 0, port: USB } }); for (let i = 0; i < 17; i++) learn6.skip();
learn6.feed([0x90, 36, 100], USB);
check(!!learn6.view().conflict, 'conflict raised for a ch1 pad');
learn6.feed([0x99, 36, 100], USB);
check(learn6.view().slot === 'p2' && !learn6.view().conflict && learn6.view().captured.p1.ch === 9, 'after SHIFT + CHANNEL UP to 10, the next pad hit is learned (re-detect)');
// explicit confirmation binds a shared note, flagged
const learn7 = P.learner(); learn7.start({}, { keybed: { ch: 0, port: USB } }); for (let i = 0; i < 17; i++) learn7.skip();
learn7.feed([0x90, 36, 100], USB); learn7.allowShared();
check(learn7.view().captured.p1.shared === true && learn7.view().slot === 'p2', '"Use anyway" binds the note with shared: true');
// pads skipped up front (from the setup guide)
const learn8 = P.learner(); learn8.start({}, { keybed: { ch: 0, port: USB }, skipPads: true });
for (let i = 0; i < 17; i++) learn8.skip();
check(learn8.view().slot === 'b1', 'skipPads: the wizard never asks for pads');

// runtime guard
perf.setLayout({ name: 'legacy n2', controls: { p2: { t: 'note', ch: 0, n: 37, port: USB } } });
loadPreset(1);
actions.length = 0;
const on = midi([0x90, 37, 100], USB), off = midi([0x80, 37, 0], USB);
check(on === null && off === null && !actions.length, 'legacy layout: a key matching an old ch1 pad binding still plays and changes no preset');
check(midi([0x90, 60, 100], USB) === null && midi([0x91, 37, 100], USB) === null, 'N2: other notes still play');
perf.setLayout({ name: 'pads ch10', controls: { p2: { t: 'note', ch: 9, n: 37, port: USB } } });
check(midi([0x99, 37, 100], USB)?.fired && actions.join() === 'preset_next', 'channel 10 pad still changes preset');
perf.setMap({ p2: 'none' });
check(midi([0x99, 37, 100], USB) !== null, 'a channel 10 pad set to "nothing" still swallows its note');
perf.setMap({});
actions.length = 0;
perf.setLayout({ name: 'keys on 10', keybed: { ch: 9, port: USB }, controls: { p2: { t: 'note', ch: 9, n: 37, port: USB }, p3: { t: 'note', ch: 0, n: 38, port: USB } } });
check(midi([0x99, 37, 100], USB) === null && !actions.length, 'keybed on ch10: a ch10 binding never takes a key');
check(midi([0x90, 38, 100], USB)?.fired, 'keybed on ch10: a pad on ch1 is distinguishable and fires');
perf.setLayout({ name: 'other input', keybed: { ch: 0, port: USB }, controls: { p2: { t: 'note', ch: 0, n: 37, port: 'Pad box' } } });
actions.length = 0;
check(midi([0x90, 37, 100], 'Pad box')?.fired && actions.join() === 'preset_next', 'a pad on another input, same channel, still fires');
check(midi([0x90, 37, 100], USB) === null, '...but the same note from the keybed input plays');
perf.setLayout({ name: 'confirmed', keybed: { ch: 0, port: USB }, controls: { p2: { t: 'note', ch: 0, n: 37, port: USB, shared: true } } });
actions.length = 0;
check(midi([0x90, 37, 100], USB)?.fired, 'a binding the user confirmed as shared fires');
check(P.controlOf([0x90, 40, 100], USB, { ch: 0, port: USB }) === null && P.controlOf([0x99, 40, 100], USB, { ch: 0, port: USB }), 'Assign: refuses a keybed-channel note, accepts ch10');

/* ---- 11. aftertouch macro for keyboards without aftertouch (slider 9 by default) ---- */
const sent = [];
const perf3 = P.create({ emit: (m) => sent.push(m), raw: () => null, fwd: (m, x) => x, inv: (m, v) => v });
perf3.setLayout({ name: 'x', controls: { s9: { t: 'cc', ch: 0, n: 48, port: USB, rel: false } } });
perf3.midi([0xb0, 48, 127], USB);
check(P.DEFAULT_MAP.s9 === 'pressure' && sent.some((m) => m.type === 'pressure' && m.value === 127), 'slider 9 sends aftertouch (channel pressure) by default');

/* ---- 12. Oxygen MKV: Learn leaves out the button under slider 9 (hard-wired to DAW BUTTON MODE) ---- */
const learn9 = P.learner();
learn9.start({}, { keybed: { ch: 0, port: USB }, hardwired: 'oxygen', skipPads: true });
for (let i = 0; i < 17; i++) learn9.skip();
check(learn9.view().slot === 'b1' && /slider 9/.test(learn9.view().note), 'Oxygen Learn: under-slider buttons come with a note that B9 is skipped');
for (let i = 0; i < 8; i++) learn9.feed([0xb0, 80 + i, 127], USB);
check(learn9.view().slot === 't_loop' && !learn9.view().captured.b9, 'Oxygen Learn: eight under-slider buttons, then Loop; slider 9 button never asked');
check(!P.DEFAULT_MAP.b9 && !learn9.view().note, 'B9 has no default job; the note is gone after the buttons');
const generic = P.learner(); generic.start({}, { keybed: { ch: 0, port: USB } });
check(generic.view().total === learn9.view().total + 1, 'other controllers still get a B9 step');

/* ---- 13. Reset preset: tweak fields, fire the action, fields equal the preset ---- */
check(P.DEFAULT_MAP.t_loop === 'preset_reset' && P.ACTION.preset_reset, 'Reset preset is an action, on Loop by default');
perf.setLayout({ name: 'Oxygen 49 USB MIDI', keybed: { ch: 0, port: USB }, controls: {
  s2: { t: 'cc', ch: 0, n: 41, port: USB, rel: false }, k1: { t: 'cc', ch: 0, n: 60, port: USB, rel: false },
  s3: { t: 'cc', ch: 0, n: 42, port: USB, rel: false }, t_loop: { t: 'cc', ch: 0, n: 113, port: USB, rel: false } } });
perf.setMap({ s3: 'field:I.pw' });
loadPreset(2);
const pr = snapshot();
toWorklet({ type: 'on', note: 60, vel: 100 }); render(0.05);
cc(41, 64); cc(41, 127);            // cutoff macro up
cc(60, 0); cc(60, 127);             // chorus depth up (switches chorus on)
const pwT = Math.round(inv(['lin', 0.4], pr['I.pw']) * 127); cc(42, pwT); cc(42, pwT > 64 ? 5 : 120); // raw PW field
toWorklet({ type: 'fields', pairs: [[fieldIx['I.noise'], 0.8]] }); perf.fieldEdited('I.noise', 0.8); // a panel edit
const tweaked = fields.filter((f) => !near(engineValue(f), pr[f], 1e-6));
check(tweaked.length >= 5, `reset: ${tweaked.length} fields tweaked before the reset (${tweaked.slice(0, 6).join(', ')})`);
actions.length = 0;
cc(113, 127); cc(113, 0);           // Loop pressed and released
const still = fields.filter((f) => !near(engineValue(f), pr[f], 1e-6));
check(actions.join() === 'preset_reset' && still.length === 0, `reset: Loop fires Reset preset and every field equals the preset${still.length ? ' (off: ' + still.join(', ') + ')' : ''}`);
check(render(0.1).rms > 1e-4, 'reset: the held note keeps sounding');
r = cc(41, 126);                    // slider 2 still parked high: one step after the reset is a small move
const jumpR = Math.log2(engineValue('I.lpf_hz') / pr['I.lpf_hz']);
check(Math.abs(jumpR) < 0.2, `reset: cutoff picks up where slider 2 sits (moved ${jumpR.toFixed(3)} oct, no jump)`);
cc(42, pwT > 64 ? 6 : 119);
check(near(engineValue('I.pw'), pr['I.pw'], 1e-6), 'reset: a raw-field slider waits for pickup again');
toWorklet({ type: 'off', note: 60 }); toWorklet({ type: 'panic' });
perf.setMap({});

console.log(bad ? `${bad} FAILED` : 'all performance-layer checks passed');
process.exit(bad ? 1 : 0);
