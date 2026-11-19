// Print the engine's built-in presets as field sets (a batch for engine.mjs measure).
//   node core_fields.mjs WASM > batch.json
import { readFileSync } from 'node:fs';

const wasm = process.argv[2];
const w = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasm)), {}).exports;
if (w._initialize) w._initialize();
w.cs80_init(48000);
const str = (p) => { const b = new Uint8Array(w.memory.buffer); let s = ''; while (b[p]) s += String.fromCharCode(b[p++]); return s; };
const presets = [];
for (let i = 0; i < w.cs80_preset_count(); i++) {
  w.cs80_load_preset(i);
  const fields = {};
  for (let f = 0; f < w.cs80_field_count(); f++) fields[str(w.cs80_field_name(f))] = w.cs80_field_get(f);
  presets.push({ id: `${i} ${str(w.cs80_preset_name(i))}`, fields });
}
process.stdout.write(JSON.stringify({ wasm, presets }));
