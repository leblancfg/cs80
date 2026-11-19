// Render helper for presets/arturia: loads a snapshot of web/cs80v2.wasm
// (read-only) and either measures chord tests for a batch of presets or
// renders one preset over a MIDI file.
//
//   node engine.mjs measure < batch.json > metrics.json
//   node engine.mjs render fields.json in.mid out.f32
//
// batch.json: {"wasm": path, "presets": [{"id": ..., "fields": {...}}]}
// out.f32: interleaved stereo float32 at 48 kHz.
import { readFileSync, writeFileSync } from 'node:fs';

const SR = 48000;

function load(path) {
  const w = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(path)), {}).exports;
  if (w._initialize) w._initialize();
  if (!w.cs80_init(SR)) throw new Error('cs80_init failed');
  const str = (p) => { const b = new Uint8Array(w.memory.buffer); let s = ''; while (b[p]) s += String.fromCharCode(b[p++]); return s; };
  const fieldIndex = {};
  for (let i = 0; i < w.cs80_field_count(); i++) fieldIndex[str(w.cs80_field_name(i))] = i;
  return { w, fieldIndex };
}

function apply({ w, fieldIndex }, fields) {
  w.cs80_init(SR);
  const pairs = Object.entries(fields).filter(([k]) => k in fieldIndex).map(([k, v]) => [fieldIndex[k], v]);
  const blob = new Float32Array(w.memory.buffer, w.cs80_blob(), 2048);
  pairs.forEach(([i, v], k) => { blob[2 * k] = i; blob[2 * k + 1] = v; });
  w.cs80_load_blob(pairs.length, 1);
  return Object.keys(fields).filter((k) => !(k in fieldIndex));
}

function render({ w }, seconds, events) {
  const blocks = Math.ceil((seconds * SR) / 128);
  const L = new Float32Array(blocks * 128), R = new Float32Array(blocks * 128);
  for (let b = 0; b < blocks; b++) {
    events(b * 128 / SR);
    w.cs80_render_block();
    L.set(new Float32Array(w.memory.buffer, w.cs80_out_l(), 128), b * 128);
    R.set(new Float32Array(w.memory.buffer, w.cs80_out_r(), 128), b * 128);
  }
  return { L, R };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// integrated loudness, ITU-R BS.1770-4 (K-weighting at 48 kHz, 400 ms blocks, -70 / -10 LU gates)
function lufs(L, R) {
  const kw = (x) => {
    const st = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
      [1, -2, 1, -1.99004745483398, 0.99007225036621]];
    let y = Float64Array.from(x);
    for (const [b0, b1, b2, a1, a2] of st) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) { const v = y[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
    }
    return y;
  };
  const zl = kw(L), zr = kw(R), blk = 0.4 * SR, hop = 0.1 * SR, ms = [];
  for (let s = 0; s + blk <= L.length; s += hop) { let a = 0; for (let i = s; i < s + blk; i++) a += zl[i] * zl[i] + zr[i] * zr[i]; ms.push(a / blk); }
  const ld = (m) => -0.691 + 10 * Math.log10(m + 1e-20);
  const g = ms.filter((m) => ld(m) > -70);
  if (!g.length) return -99;
  const rel = ld(g.reduce((a, b) => a + b, 0) / g.length) - 10, g2 = g.filter((m) => ld(m) > rel);
  return ld(g2.reduce((a, b) => a + b, 0) / g2.length);
}

// chord C3 E3 G3 C4 at velocity 100, held 3 s, 2 s tail
function measure(eng, fields) {
  apply(eng, fields);
  const notes = [48, 52, 55, 60];
  let on = false, off = false;
  const { L, R } = render(eng, 5, (t) => {
    if (!on) { notes.forEach((n) => eng.w.cs80_note_on(n, 100)); on = true; }
    if (!off && t >= 3) { notes.forEach((n) => eng.w.cs80_note_off(n)); off = true; }
  });
  let finite = true, peak = 0;
  const env = [];
  const hop = SR / 20;
  for (let f = 0; f + hop <= L.length; f += hop) {
    let ss = 0;
    for (let i = f; i < f + hop; i++) {
      const l = L[i], r = R[i];
      if (!Number.isFinite(l) || !Number.isFinite(r)) { finite = false; continue; }
      ss += 0.5 * (l * l + r * r);
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
    }
    env.push(Math.sqrt(ss / hop));
  }
  const held = env.slice(0, 60);
  const top = Math.max(...held, 1e-12);
  // loudness over the frames that sound (within 20 dB of the loudest), so decaying sounds are not penalised
  const act = held.filter((x) => x >= 0.1 * top);
  const rms = Math.sqrt(act.reduce((s, x) => s + x * x, 0) / Math.max(1, act.length));
  // the limiter on this chord: deepest gain reduction and the peak before it (builds that have one)
  const gr4 = eng.w.cs80_lim_gain ? -20 * Math.log10(eng.w.cs80_lim_gain()) : 0, pre4 = eng.w.cs80_lim_peak_in ? eng.w.cs80_lim_peak_in() : peak;
  const t90 = held.findIndex((x) => x >= 0.9 * top) / 20;
  const sustainRatio = env[55] / top; // level just before release, relative to peak
  const tailRatio = env[90] / top;    // 1.5 s after release
  // release: seconds from note-off until the level is 20 dB below where it was at note-off (2 s at most)
  const atOff = Math.max(env[59], 1e-12), r20 = env.slice(60).findIndex((x) => x < 0.1 * atOff);
  const rel20 = r20 < 0 ? 2 : r20 / 20;
  // spectral centroid over the held part
  const N = 4096;
  let num = 0, den = 0;
  for (let s = 0.2; s < 2.9; s += 0.3) {
    const re = new Float64Array(N), im = new Float64Array(N);
    const o = Math.floor(s * SR);
    for (let i = 0; i < N; i++) re[i] = 0.5 * (L[o + i] + R[o + i]) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * SR / N; den += m; }
  }
  // worst-case peak: a six-note chord with a low root (D2 F3 A3 C4 E4 G4), struck together at velocity 127
  apply(eng, fields);
  let on6 = false;
  const big = render(eng, 2, () => { if (!on6) { [38, 53, 57, 60, 64, 67].forEach((n) => eng.w.cs80_note_on(n, 127)); on6 = true; } });
  let peak6 = 0;
  for (let i = 0; i < big.L.length; i++) peak6 = Math.max(peak6, Math.abs(big.L[i]), Math.abs(big.R[i]));
  // the same chord before the output limiter, and the limiter's deepest gain reduction (builds that have one)
  const pre6 = eng.w.cs80_lim_peak_in ? eng.w.cs80_lim_peak_in() : peak6, gr6 = eng.w.cs80_lim_gain ? -20 * Math.log10(eng.w.cs80_lim_gain()) : 0;
  return { finite, rms, peak6, pre6, gr6, gr4, pre4, lufs: lufs(L, R), dbfs: 20 * Math.log10(rms + 1e-12), peak, t90, sustainRatio, tailRatio, rel20, centroid: den ? num / den : 0 };
}

// minimal SMF reader: note on/off, CC, pitch bend, tempo; returns [{t, bytes}]
function readMidi(path) {
  const b = readFileSync(path);
  let p = 0;
  const u32 = () => { const v = b.readUInt32BE(p); p += 4; return v; };
  const u16 = () => { const v = b.readUInt16BE(p); p += 2; return v; };
  const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
  if (b.toString('ascii', 0, 4) !== 'MThd') throw new Error('not a MIDI file');
  p = 4; const hl = u32(); u16(); const ntrk = u16(); const div = u16(); p = 8 + hl;
  const raw = [];
  for (let tr = 0; tr < ntrk; tr++) {
    if (b.toString('ascii', p, p + 4) !== 'MTrk') break;
    p += 4; const len = u32(); const end = p + len;
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      let s = b[p];
      if (s & 0x80) { p++; status = s; } else s = status;
      if (s === 0xff) {
        const type = b[p++]; const l = vlq();
        if (type === 0x51) raw.push({ tick, tempo: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
        p += l;
      } else if (s === 0xf0 || s === 0xf7) { p += vlq(); }
      else {
        const hi = s & 0xf0, n = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
        raw.push({ tick, bytes: [s, ...b.subarray(p, p + n)] });
        p += n;
      }
    }
    p = end;
  }
  raw.sort((a, c) => a.tick - c.tick);
  let tempo = 500000, lastTick = 0, t = 0;
  const out = [];
  for (const e of raw) {
    t += ((e.tick - lastTick) * tempo) / div / 1e6; lastTick = e.tick;
    if (e.tempo) tempo = e.tempo; else out.push({ t, bytes: e.bytes });
  }
  return out;
}

// motion: amplitude spread of the held chord (std / mean of 10 ms RMS frames, 0.5 to 2.9 s)
// and pitch wobble of one held A3 (cents, std of an autocorrelation period estimate per 40 ms)
function motion(eng, fields) {
  apply(eng, fields);
  let on = false;
  const c = render(eng, 3, () => { if (!on) { [48, 52, 55, 60].forEach((n) => eng.w.cs80_note_on(n, 100)); on = true; } });
  const fr = [];
  for (let f = 0.5 * SR; f + 480 <= 2.9 * SR; f += 480) { let s = 0; for (let i = f; i < f + 480; i++) s += c.L[i] * c.L[i] + c.R[i] * c.R[i]; fr.push(Math.sqrt(s / 960)); }
  const mean = fr.reduce((a, x) => a + x, 0) / fr.length;
  const am = mean > 0 ? Math.sqrt(fr.reduce((a, x) => a + (x - mean) ** 2, 0) / fr.length) / mean : 0;
  apply(eng, fields);
  on = false;
  const n = render(eng, 3, () => { if (!on) { eng.w.cs80_note_on(57, 100); on = true; } });
  const x = Float64Array.from(n.L, (v, i) => v + n.R[i]);
  const W = 1920, best = (o, lo, hi) => { let bl = lo, bv = -Infinity; for (let l = lo; l <= hi; l++) { let s = 0; for (let i = 0; i < W; i++) s += x[o + i] * x[o + i + l]; if (s > bv) { bv = s; bl = l; } } return bl; };
  const p0 = best(Math.floor(0.6 * SR), 48, 960);
  const cents = [];
  for (let o = 0.6 * SR; o + W + 2 * p0 < 2.9 * SR; o += W) cents.push(1200 * Math.log2(best(o, Math.floor(p0 * 0.84), Math.ceil(p0 * 1.19)) / p0));
  const cm = cents.reduce((a, v) => a + v, 0) / Math.max(1, cents.length);
  const pitch = Math.sqrt(cents.reduce((a, v) => a + (v - cm) ** 2, 0) / Math.max(1, cents.length));
  return { am, pitch };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'motion') {
  const batch = JSON.parse(readFileSync(0, 'utf8'));
  const eng = load(batch.wasm);
  const out = {};
  for (const p of batch.presets) out[p.id] = motion(eng, p.fields);
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
if (mode === 'measure') {
  const batch = JSON.parse(readFileSync(0, 'utf8'));
  const eng = load(batch.wasm);
  const out = {};
  for (const p of batch.presets) out[p.id] = measure(eng, p.fields);
  process.stdout.write(JSON.stringify(out));
} else if (mode === 'render') {
  const [fieldsPath, midPath, outPath, wasm] = args;
  const eng = load(wasm);
  const spec = JSON.parse(readFileSync(fieldsPath, 'utf8'));
  // {"core": i} plays built-in preset i; anything else is a field set
  const missing = spec.core !== undefined ? (eng.w.cs80_init(SR), eng.w.cs80_load_preset(spec.core), []) : apply(eng, spec);
  if (missing.length) console.error('fields not in this engine build:', missing.join(' '));
  const evs = readMidi(midPath);
  const end = (evs.length ? evs[evs.length - 1].t : 0) + 4;
  let k = 0;
  const { L, R } = render(eng, end, (t) => {
    for (; k < evs.length && evs[k].t <= t; k++) {
      const [s, d1, d2] = evs[k].bytes, hi = s & 0xf0;
      if (hi === 0x90 && d2 > 0) eng.w.cs80_note_on(d1, d2);
      else if (hi === 0x80 || hi === 0x90) eng.w.cs80_note_off(d1);
      else if (hi === 0xb0 && [1, 7, 11, 64].includes(d1)) eng.w.cs80_cc(d1, d2); // no panel CCs from the file
      else if (hi === 0xe0) eng.w.cs80_pitch_bend((d2 << 7) | d1);
      else if (hi === 0xd0) eng.w.cs80_channel_pressure(d1);
    }
  });
  if (outPath === '-') {
    // stats only: loudness, active-frame RMS, sample peak, deepest limiter gain reduction
    let peak = 0; const env = [], hop = SR / 20;
    for (let f = 0; f + hop <= L.length; f += hop) { let ss = 0; for (let i = f; i < f + hop; i++) { ss += 0.25 * (L[i] + R[i]) ** 2; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); } env.push(Math.sqrt(ss / hop)); }
    const top = Math.max(...env), act = env.filter((x) => x > 0.1 * top);
    const rms = Math.sqrt(act.reduce((a, x) => a + x * x, 0) / act.length);
    const gr = eng.w.cs80_lim_gain ? -20 * Math.log10(eng.w.cs80_lim_gain()) : 0;
    const pre = eng.w.cs80_lim_peak_in ? eng.w.cs80_lim_peak_in() : peak;
    process.stdout.write(JSON.stringify({ lufs: lufs(L, R), rms_dbfs: 20 * Math.log10(rms + 1e-12), peak_dbfs: 20 * Math.log10(peak + 1e-12), pre_peak_dbfs: 20 * Math.log10(pre + 1e-12), max_gr_db: gr }));
    process.exit(0);
  }
  const inter = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; }
  writeFileSync(outPath, Buffer.from(inter.buffer));
} else {
  console.error('usage: engine.mjs measure < batch.json | render fields.json in.mid out.f32 wasm');
  process.exit(2);
}
