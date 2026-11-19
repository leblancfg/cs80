// Node loader for cs80v2.wasm, shared by the translator and the render test.
import { readFileSync } from 'node:fs';

export function loadEngine(path = new URL('../cs80v2.wasm', import.meta.url), sr = 48000) {
  const module = new WebAssembly.Module(readFileSync(path));
  const w = new WebAssembly.Instance(module, {}).exports;
  if (w._initialize) w._initialize();
  if (!w.cs80_init(sr)) throw new Error('cs80_init failed');
  const str = (p) => { const b = new Uint8Array(w.memory.buffer); let s = ''; while (b[p]) s += String.fromCharCode(b[p++]); return s; };
  const fields = [], params = {}, presets = [];
  for (let i = 0; i < w.cs80_field_count(); i++) fields.push(str(w.cs80_field_name(i)));
  for (let i = 0; i < w.cs80_param_count(); i++) params[str(w.cs80_param_name(i))] = w.cs80_param_id(i);
  for (let i = 0; i < w.cs80_preset_count(); i++) presets.push(str(w.cs80_preset_name(i)));
  const fieldIndex = Object.fromEntries(fields.map((f, i) => [f, i]));
  const getAll = () => fields.map((_, i) => w.cs80_field_get(i));
  // render seconds of audio, calling events(t) before each 128-frame block
  function render(seconds, events = () => {}) {
    const blocks = Math.ceil((seconds * sr) / 128);
    const L = new Float32Array(blocks * 128), R = new Float32Array(blocks * 128);
    for (let b = 0; b < blocks; b++) {
      events(b * 128 / sr);
      w.cs80_render_block();
      L.set(new Float32Array(w.memory.buffer, w.cs80_out_l(), 128), b * 128);
      R.set(new Float32Array(w.memory.buffer, w.cs80_out_r(), 128), b * 128);
    }
    return { L, R };
  }
  return { w, str, fields, fieldIndex, params, presets, getAll, render, sr };
}

export function stats({ L, R }, from = 0, to = L.length) {
  let ss = 0, peak = 0, finite = true;
  for (let i = from; i < to; i++) {
    const l = L[i], r = R[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) { finite = false; continue; }
    ss += 0.5 * (l * l + r * r);
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const rms = Math.sqrt(ss / Math.max(1, to - from));
  return { rms, dbfs: 20 * Math.log10(rms + 1e-12), peak, finite };
}

// a three-note chord (C3 E3 G3 + C4), held 1.5 s, then released
export function chordTest(eng, seconds = 2.5) {
  const notes = [48, 52, 55, 60];
  let on = false, off = false;
  return eng.render(seconds, (t) => {
    if (!on) { notes.forEach((n) => eng.w.cs80_note_on(n, 100)); on = true; }
    if (!off && t >= 1.5) { notes.forEach((n) => eng.w.cs80_note_off(n)); off = true; }
  });
}
