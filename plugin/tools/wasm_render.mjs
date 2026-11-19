// Render through a cs80v2.wasm (the web engine) with the shared score:
// node wasm_render.mjs <cs80v2.wasm> <preset.txt> <score.txt> <seconds> <out.f32>
// Same output format as ref_render.cpp.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEngine } from '../../web/tools/wasm.mjs';

const [wasm, presetPath, scorePath, seconds, outPath] = process.argv.slice(2);
const eng = loadEngine(wasm, 48000);
const { w } = eng;
const lines = readFileSync(presetPath, 'utf8').trim().split('\n');
if (lines[0].startsWith('core')) w.cs80_load_preset(+lines[0].split(' ')[1]);
else {
  const blob = new Float32Array(w.memory.buffer, w.cs80_blob(), 2048);
  const pairs = lines.slice(1).map((l) => l.split(' '));
  pairs.forEach(([k, v], i) => {
    if (eng.fieldIndex[k] === undefined) throw new Error('unknown field ' + k);
    blob[2 * i] = eng.fieldIndex[k]; blob[2 * i + 1] = +v;
  });
  w.cs80_load_blob(pairs.length, 1);
}
const score = readFileSync(scorePath, 'utf8').split('\n').filter((l) => l && l[0] !== '#')
  .map((l) => l.split(/\s+/)).map(([b, k, a, c]) => ({ b: +b, k, a: +a, c: +c }));
const blocks = Math.floor((+seconds * 48000) / 128);
const out = new Float32Array(blocks * 256);
let si = 0;
for (let b = 0; b < blocks; b++) {
  for (; si < score.length && score[si].b <= b; si++) {
    const e = score[si];
    if (e.k === 'on') w.cs80_note_on(e.a, e.c);
    else if (e.k === 'off') w.cs80_note_off(e.a);
    else if (e.k === 'bend') w.cs80_pitch_bend(e.a);
    else if (e.k === 'cc') w.cs80_cc(e.a, e.c);
    else if (e.k === 'cp') w.cs80_channel_pressure(e.a);
    else if (e.k === 'pp') w.cs80_poly_pressure(e.a, e.c);
  }
  w.cs80_render_block();
  const L = new Float32Array(w.memory.buffer, w.cs80_out_l(), 128), R = new Float32Array(w.memory.buffer, w.cs80_out_r(), 128);
  for (let i = 0; i < 128; i++) { out[(b * 128 + i) * 2] = L[i]; out[(b * 128 + i) * 2 + 1] = R[i]; }
}
writeFileSync(outPath, Buffer.from(out.buffer));
