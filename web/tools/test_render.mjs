// Headless check of cs80v2.wasm: instantiate it, render every Core preset and
// a sample of the library, and fail on silence or non-finite output. With
// --parity FILE, compare preset 0's chord test against a native build's raw
// float output (see parity.cpp).
import { readFileSync } from 'node:fs';
import { loadEngine, stats, chordTest } from './wasm.mjs';

const eng = loadEngine();
const { w } = eng;
let bad = 0;
const row = (name, s, ms) => {
  const ok = s.finite && s.rms > 1e-4;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(36)} rms ${s.dbfs.toFixed(1).padStart(6)} dBFS  peak ${s.peak.toFixed(3)}  ${ms.toFixed(0)} ms`);
};

for (let i = 0; i < eng.presets.length; i++) {
  w.cs80_init(48000); w.cs80_load_preset(i);
  const t0 = performance.now();
  const out = chordTest(eng);
  row(eng.presets[i], stats(out), performance.now() - t0);
}

const lib = JSON.parse(readFileSync(new URL('../presets-library.json', import.meta.url)));
for (const p of lib.presets) {
  w.cs80_init(48000);
  if (p.core !== undefined) w.cs80_load_preset(p.core); // a Core sound filed in its bank
  else {
    const pairs = Object.entries(p.fields).map(([k, v]) => [eng.fieldIndex[k], v]);
    const blob = new Float32Array(w.memory.buffer, w.cs80_blob(), 2048);
    pairs.forEach(([i, v], k) => { blob[2 * k] = i; blob[2 * k + 1] = v; });
    w.cs80_load_blob(pairs.length, 1);
  }
  const out = chordTest(eng);
  const s = stats(out);
  if (!s.finite || s.rms < 1e-4) row(`${p.bank}/${p.name}`, s, 0);
}
console.log(`library: ${lib.presets.length} presets rendered`);

// MIDI-path smoke test: Oxygen CC 20 (Brilliance) and CC 64 must reach the engine
w.cs80_init(48000);
const iB = eng.fieldIndex.brilliance;
w.cs80_cc(20, 127);
console.log(`Oxygen CC20=127 -> brilliance ${w.cs80_field_get(iB).toFixed(2)} oct (expect +3.00)`);
if (Math.abs(w.cs80_field_get(iB) - 3) > 0.01) bad++;

// Saw and pulse levels must change the rendered sound continuously, not snap
// at the old on/off threshold. Keep the rest of the patch identical.
function waveform(saw, square) {
  w.cs80_init(48000); w.cs80_reset_patch();
  for (const ch of [0, 1]) {
    w.cs80_field_set(eng.fieldIndex[`${ch ? 'II' : 'I'}.saw`], saw);
    w.cs80_field_set(eng.fieldIndex[`${ch ? 'II' : 'I'}.square`], square);
  }
  w.cs80_note_on(48, 100);
  return eng.render(0.12).L;
}
const fullSaw = waveform(1, 0), quarterPulse = waveform(1, 0.25), fullPulse = waveform(1, 1);
const distance = (a, b) => Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0) / a.length);
const part = distance(fullSaw, quarterPulse), whole = distance(fullSaw, fullPulse);
console.log(`pulse slider: quarter/full difference ${part.toFixed(5)} / ${whole.toFixed(5)}`);
if (!(part > 1e-4 && part < whole * 0.75)) bad++;

// output limiter: master far too high still peaks at -1 dBFS at most; a quiet patch passes untouched
{
  const run = (master, vel) => {
    w.cs80_init(48000); w.cs80_load_preset(0);
    w.cs80_field_set(eng.fieldIndex.master, master);
    [38, 53, 57, 60, 64, 67].forEach((n) => w.cs80_note_on(n, vel));
    let peak = 0; const L = [];
    for (let b = 0; b < 48000 / 128; b++) {
      w.cs80_render_block();
      const l = new Float32Array(w.memory.buffer, w.cs80_out_l(), 128), r = new Float32Array(w.memory.buffer, w.cs80_out_r(), 128);
      for (let i = 0; i < 128; i++) { peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i])); L.push(l[i]); }
    }
    return { peak, pre: w.cs80_lim_peak_in(), gain: w.cs80_lim_gain(), L };
  };
  const hot = run(8, 127);
  const ok1 = hot.pre > 2 && hot.peak <= 0.891252 && hot.gain < 0.5;
  console.log(`${ok1 ? 'ok  ' : 'FAIL'} limiter: ${(20 * Math.log10(hot.pre)).toFixed(1)} dBFS in, ${(20 * Math.log10(hot.peak)).toFixed(2)} dBFS out (ceiling -1)`);
  const quiet = run(0.02, 60), again = run(0.02, 60);
  const ok2 = quiet.pre < 0.7 && quiet.gain === 1 && quiet.pre === quiet.peak;
  console.log(`${ok2 ? 'ok  ' : 'FAIL'} limiter: a quiet chord (${(20 * Math.log10(quiet.pre)).toFixed(1)} dBFS) passes unchanged`);
  if (!ok1 || !ok2 || again.L.length !== quiet.L.length) bad++;
}

// real-time headroom for a full 8-voice chord with every effect on (preset 0 uses echo + plate + chorus)
w.cs80_init(48000); w.cs80_load_preset(0);
const notes = [48, 52, 55, 59, 60, 64, 67, 71];
notes.forEach((n) => w.cs80_note_on(n, 110));
const blocks = 48000 * 5 / 128;
const t0 = performance.now();
for (let b = 0; b < blocks; b++) w.cs80_render_block();
const ms = performance.now() - t0;
console.log(`8 voices, all effects: ${(5000 / ms).toFixed(1)}x real time (${(ms / blocks * 1000).toFixed(1)} us per 128-frame block, budget 2667 us)`);

const pi = process.argv.indexOf('--parity');
if (pi > 0) {
  const nat = new Float32Array(readFileSync(process.argv[pi + 1]).buffer.slice(0));
  w.cs80_init(48000); w.cs80_load_preset(0);
  const { L, R } = chordTest(eng);
  let err = 0, ref = 0;
  const n = Math.min(nat.length / 2, L.length);
  for (let i = 0; i < n; i++) { const a = nat[2 * i] - L[i], b = nat[2 * i + 1] - R[i]; err += a * a + b * b; ref += nat[2 * i] ** 2 + nat[2 * i + 1] ** 2; }
  const snr = 10 * Math.log10(ref / Math.max(err, 1e-30));
  console.log(`parity vs native: ${n} frames, difference ${snr.toFixed(1)} dB below signal`);
  if (snr < 60) bad++;
}

if (bad) { console.log(`${bad} failures`); process.exit(1); }
console.log('all checks passed');
