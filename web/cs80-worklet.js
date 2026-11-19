// AudioWorkletProcessor hosting cs80v2.wasm. The main thread posts the wasm
// bytes in processorOptions; the module is instantiated here, in the audio
// thread, and renders 128-frame blocks straight into the output buffers.

const now = (globalThis.performance && performance.now) ? () => performance.now() : () => Date.now();

function stubImports(module) {
  const imports = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    imports[imp.module] = imports[imp.module] || {};
    if (imp.kind === 'function') imports[imp.module][imp.name] = () => 0;
  }
  return imports;
}

class CS80Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.w = null;
    this.queue = [];
    this.dirty = false;
    this.lastPatchPost = 0;
    this.gain = 1; this.gainTarget = 1; // post-FX master volume (performance knob)
    this.stat = { n: 0, sum: 0, peak: 0, t0: now() };
    this.meter = { peak: 0, ss: 0, n: 0, t0: now() }; // output level, as heard (after the volume)
    this.port.onmessage = (e) => (this.w ? this.handle(e.data) : this.queue.push(e.data));
    this.boot(options.processorOptions.wasm).catch((err) => this.port.postMessage({ type: 'error', message: String(err) }));
  }

  async boot(bytes) {
    const module = await WebAssembly.compile(bytes);
    const inst = await WebAssembly.instantiate(module, stubImports(module));
    const w = inst.exports;
    if (w._initialize) w._initialize();
    if (!w.cs80_init(sampleRate)) throw new Error(`cs80v2 supports 8 to 48 kHz; this context runs at ${sampleRate} Hz`);
    this.w = w;
    this.mem = w.memory;
    this.pl = w.cs80_out_l();
    this.pr = w.cs80_out_r();
    // TextDecoder is missing from some AudioWorklet scopes; names are ASCII
    const str = (p) => { const b = new Uint8Array(this.mem.buffer); let s = ''; while (b[p]) s += String.fromCharCode(b[p++]); return s; };
    this.str = str;
    const fields = [], kinds = [], params = {}, presets = [];
    for (let i = 0; i < w.cs80_field_count(); i++) { fields.push(str(w.cs80_field_name(i))); kinds.push(w.cs80_field_kind(i)); }
    for (let i = 0; i < w.cs80_param_count(); i++) params[str(w.cs80_param_name(i))] = w.cs80_param_id(i);
    for (let i = 0; i < w.cs80_preset_count(); i++) presets.push(str(w.cs80_preset_name(i)));
    this.nfields = fields.length;
    // patch_init() values: the base for "Copy settings" diffs and blob loads
    w.cs80_reset_patch();
    const defaults = fields.map((_, i) => w.cs80_field_get(i));
    w.cs80_load_preset(0);
    this.port.postMessage({ type: 'ready', sampleRate, fields, kinds, params, presets, defaults });
    this.postPatch('load');
    for (const m of this.queue) this.handle(m);
    this.queue = [];
  }

  // reason 'load' marks a new preset: the page re-bases its performance macros on it
  postPatch(reason = '') {
    const v = new Float32Array(this.nfields);
    for (let i = 0; i < this.nfields; i++) v[i] = this.w.cs80_field_get(i);
    this.port.postMessage({ type: 'patch', values: v, name: this.str(this.w.cs80_patch_name()), reason });
  }

  handle(m) {
    const w = this.w;
    switch (m.type) {
      case 'on': w.cs80_note_on(m.note, m.vel); break;
      case 'off': w.cs80_note_off(m.note); break;
      case 'bend': w.cs80_pitch_bend(m.value); break;
      case 'cp': w.cs80_channel_pressure(m.value); break;
      case 'pp': w.cs80_poly_pressure(m.note, m.value); break;
      case 'cc': w.cs80_cc(m.num, m.value); if (m.num !== 64 && m.num !== 1) this.dirty = true; break;
      case 'panic': w.cs80_all_notes_off(); break;
      case 'map': w.cs80_set_map(m.which); break;
      case 'param': w.cs80_set_param(m.id, m.x); this.dirty = true; break;
      case 'field': w.cs80_field_set(m.index, m.value); this.dirty = true; break;
      case 'fields': for (const [i, v] of m.pairs) w.cs80_field_set(i, v); this.dirty = true; break;
      case 'gain': this.gainTarget = Math.max(0, Math.min(1, +m.value || 0)); break;
      case 'preset': w.cs80_load_preset(m.index); this.postPatch('load'); break;
      case 'blob': {
        const b = new Float32Array(this.mem.buffer, w.cs80_blob(), 2048);
        const n = Math.min(m.pairs.length, 1024);
        for (let k = 0; k < n; k++) { b[2 * k] = m.pairs[k][0]; b[2 * k + 1] = m.pairs[k][1]; }
        w.cs80_load_blob(n, m.reset ? 1 : 0);
        this.postPatch(m.reset ? 'load' : '');
        break;
      }
      case 'getpatch': this.postPatch(); break;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!this.w || !out || out.length === 0) return true;
    const n = out[0].length;
    const t0 = now();
    for (let off = 0; off < n; off += 128) {
      this.w.cs80_render_block();
      const len = Math.min(128, n - off);
      const buf = this.mem.buffer;
      out[0].set(new Float32Array(buf, this.pl, len), off);
      if (out[1]) out[1].set(new Float32Array(buf, this.pr, len), off);
      // master volume after the effects, ramped over the block so moves do not click
      const g0 = this.gain, g1 = this.gainTarget;
      if (g0 !== 1 || g1 !== 1) {
        for (let c = 0; c < out.length && c < 2; c++) {
          const o = out[c];
          for (let i = 0; i < len; i++) o[off + i] *= g0 + (g1 - g0) * (i + 1) / len;
        }
        this.gain = g1;
      }
      const m = this.meter;
      for (let c = 0; c < out.length && c < 2; c++) {
        const o = out[c];
        for (let i = off; i < off + len; i++) { const v = o[i]; m.ss += v * v; const a = v < 0 ? -v : v; if (a > m.peak) m.peak = a; }
      }
      m.n += len * Math.min(2, out.length);
    }
    const tm = now(), m = this.meter;
    if (tm - m.t0 > 50 && this.w.cs80_lim_gain) {
      // ~20 per second: sample peak, RMS, and the limiter's deepest gain reduction since the last one
      this.port.postMessage({ type: 'meter', peak: m.peak, rms: Math.sqrt(m.ss / Math.max(1, m.n)), gr: this.w.cs80_lim_gain() });
      m.peak = 0; m.ss = 0; m.n = 0; m.t0 = tm;
    }
    const dt = now() - t0;
    const s = this.stat;
    s.n++; s.sum += dt; if (dt > s.peak) s.peak = dt;
    const t = now();
    if (t - s.t0 > 250) {
      const budget = (n / sampleRate) * 1000;
      this.port.postMessage({ type: 'cpu', avg: s.sum / s.n / budget, peak: s.peak / budget,
        voices: this.w.cs80_active_voices(), echo: this.w.cs80_active_echo_voices() });
      s.n = 0; s.sum = 0; s.peak = 0; s.t0 = t;
    }
    if (this.dirty && t - this.lastPatchPost > 40) { this.dirty = false; this.lastPatchPost = t; this.postPatch(); }
    return true;
  }
}

registerProcessor('cs80v2', CS80Processor);
