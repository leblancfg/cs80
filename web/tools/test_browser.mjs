// Headless browser load: start chrome-headless-shell, open the page, start
// audio, then fake a Web MIDI controller (navigator.requestMIDIAccess is
// replaced before the page loads) and drive the Learn wizard and a slider.
// Usage: node tools/test_browser.mjs [URL]; without a URL it serves web/ itself.
// SHOT=dir saves screenshots of the main view, both tabs, the setup guide and Learn.
// Needs a Playwright chrome-headless-shell in ~/.cache/ms-playwright, or CHROME=path.
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createServer } from 'node:http';

let url = process.argv[2], server = null;
if (!url) {
  const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm' };
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const f = new URL('../' + (path.slice(1) || 'index.html'), import.meta.url);
    try { const b = readFileSync(f); res.writeHead(200, { 'content-type': types[f.pathname.split('.').pop()] || 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`; // localhost counts as a secure context
}
let chrome = process.env.CHROME;
if (!chrome) {
  const root = `${homedir()}/.cache/ms-playwright`;
  const d = existsSync(root) && readdirSync(root).find((n) => n.startsWith('chromium_headless_shell'));
  if (d) chrome = `${root}/${d}/chrome-linux/headless_shell`;
  if (d && !existsSync(chrome)) chrome = `${root}/${d}/chrome-headless-shell-linux64/chrome-headless-shell`;
}
if (!chrome || !existsSync(chrome)) { console.log('no headless chrome found; set CHROME'); process.exit(2); }

const proc = spawn(chrome, ['--headless', '--no-sandbox', '--remote-debugging-port=0', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=/tmp/cs80-chrome', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); });
  setTimeout(() => rej(new Error('chrome did not start')), 15000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiters = new Map(), logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.result ? r.result.result.value : r; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fake Web MIDI: one music port, one Mackie port; window.__midi(portIndex, bytes) sends a message
const FAKE_MIDI = `(() => {
  const mk = (id, name) => ({ id, name, onmidimessage: null });
  const ins = new Map([['a', mk('a', 'Oxygen 49 USB MIDI')], ['b', mk('b', 'Oxygen 49 MKV Mackie/HUI')]]);
  window.__midi = (k, bytes) => { const i = ins.get(k); if (i.onmidimessage) i.onmidimessage({ data: new Uint8Array(bytes) }); };
  navigator.requestMIDIAccess = async () => ({ inputs: ins, onstatechange: null });
  if (!sessionStorage.getItem('kept')) localStorage.clear();
  window.confirm = () => true;
})()`;

let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
const visible = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }) && !e.closest("details:not([open]) > :not(summary)"); })()`;
const shotDir = process.env.SHOT;
const shot = async (name) => {
  if (!shotDir) return;
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};
const key = (n, ch = 0) => `__midi('a', [0x90 | ${ch}, ${n}, 100]); __midi('a', [0x80 | ${ch}, ${n}, 0]);`;
try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_MIDI });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });
  for (let i = 0; i < 50 && !(await evaluate(`document.querySelector('#midi-in')?.options.length > 1`)); i++) await sleep(200);
  const served = await evaluate(`[...document.scripts].map(s => s.getAttribute('src')).join(' ')`);
  check(/app\.js\?v=17/.test(served), 'served page uses the new app.js version: ' + served);
  check(await evaluate(`(() => { const a = $('about'); return !!a && a.href === 'https://github.com/leblancfg/cs80#readme' && a.checkVisibility(); })()`), 'header links to the README on GitHub');
  check(await evaluate(`['og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt'].every(p => document.querySelector('meta[property="' + p + '"]')?.content) && document.querySelector('meta[name="twitter:card"]')?.content === 'summary_large_image' && /^https:\\/\\/.+\\/og\\.png$/.test(document.querySelector('meta[property="og:image"]').content)`), 'Open Graph and Twitter card tags, absolute og:image');
  check(await evaluate(`$('midi-in').selectedOptions[0].textContent === 'Oxygen 49 USB MIDI'`), 'MIDI: the USB MIDI port is selected, not the Mackie port');
  check(await evaluate(`!$('learn-nudge').hidden && /Set up my controller/.test($('learn-nudge').textContent)`), 'first connect offers the guided setup');

  // B: the main view keeps technical readouts behind Advanced
  check(await evaluate(`!$('advanced').open`), 'Advanced is collapsed');
  for (const sel of ['#cpu', '#cc-map', '#monitor', '#preset-info', '#panic', '#assign-open']) check(!(await evaluate(visible(sel))), `${sel} is hidden in Advanced`);
  const mainText = await evaluate(`document.body.innerText`);
  check(!/PM-80|CPU|Approximation|dBFS|DAW port: controls only/.test(mainText), 'no jargon in the main view');

  // C: two tabs, one shown at a time
  check(await evaluate(`!$('keyboard-view').hidden && $('legend').hidden`), 'Keyboard tab shown by default');
  await evaluate(`$('tab-legend').click()`);
  check(await evaluate(`$('keyboard-view').hidden && !$('legend').hidden && $('tab-legend').textContent === 'Controls'`), 'Controls tab replaces the keyboard');
  await evaluate(`$('tab-keyboard').click()`);

  await evaluate(`$('start').click()`);
  for (let i = 0; i < 40 && !(await evaluate(`!!info && !!values`)); i++) await sleep(250);
  check(await evaluate(`!!info && !!values`), 'engine started in the AudioWorklet: ' + await evaluate(`$('status').textContent`));
  // The public library: ten banks, each with the chart presets first, then the Core and
  // scouted sounds, then the Arturia translations; 128 to 160 in all.
  const libKind = await evaluate(`library && library.kind`), bankNames = await evaluate(`Object.keys(banks()).join('|')`);
  check(libKind === 'public' && /^Brass\|Strings\|Pads/.test(bankNames) && /Sub Osc and Motion\|User$/.test(bankNames) && await evaluate(`(() => { const lib = Object.entries(banks()).filter(([b]) => b !== 'User').map(([, l]) => l), all = lib.flat(), rank = { chart: 0, core: 1, scouted: 2, arturia: 3 };
    return all.length >= 128 && all.length <= 160 && all.filter(p => p.origin === 'core').length === 8 && banks().Brass[0].name === 'Porcaro Brass (chart)'
      && lib.every(b => b.every((p, i) => !i || rank[b[i - 1].origin] <= rank[p.origin])); })()`), `public combined library, then the User bank (${bankNames})`);
  // output meter in the header: a note through the limiter shows a level and never passes -1 dBFS
  await evaluate(`window.__mx = 0; const o = showMeter; showMeter = (m) => { __mx = Math.max(__mx, m.peak); o(m); };`);
  await evaluate(`__midi('a', [0x90, 48, 127]); __midi('a', [0x90, 55, 127]); __midi('a', [0x90, 64, 127]); __midi('a', [0x90, 38, 127]); __midi('a', [0x90, 67, 127])`); await sleep(1200);
  check(await evaluate(`/RMS/.test($('meter-text').textContent) && parseFloat($('meter-rms').style.width) > 20 && __mx > 0.05 && __mx <= 0.8913 + 1e-4`), 'header meter: level shown, peak at most -1 dBFS: ' + await evaluate(`$('meter-text').textContent + ' ' + $('meter-gr').textContent + ' max ' + (20 * Math.log10(__mx)).toFixed(2)`));
  await evaluate(`[48, 55, 64, 38, 67].forEach(n => __midi('a', [0x80, n, 0])); $('panic').onclick()`); await sleep(200);
  await sleep(300);
  // F: the whole CS-80 panel is shown, as a faceplate of levers
  const titles = await evaluate(`[...document.querySelectorAll('#panel .ftitle')].map(t => t.textContent).join('|')`);
  for (const t of ['Sub oscillator', 'Ring modulator', 'Chorus / tremolo', 'Brilliance', 'Volume', 'VCO', 'VCF', 'VCA', 'Touch response', 'Feet', 'Keyboard control', 'Sustain / portamento', 'Echo', 'Reverb', 'Master']) check(titles.includes(t), `panel section ${t}`);
  check(await evaluate(`(() => { const want = new Set(info.fields); const have = new Set(controls.map(c => c.f)); return ['I.lpf_hz', 'II.after_level', 'sub_wave', 'ring_d', 'chorus.trem_depth', 'kbd_level_high', 'porta_time', 'fx.echo_fb', 'plate.decay', 'master', 'feet_II', 'detune_cents', 'gain'].every(f => have.has(f)) && controls.length >= 80; })()`), 'every panel control is on screen: ' + await evaluate(`controls.length`));
  check(await evaluate(`[...document.querySelectorAll('.fextras .ftitle')].map(t => t.textContent).join(',') === 'Echo,Reverb,Master'`), 'Echo, Reverb and Master sit at the end of the strip');
  check(!(await evaluate(`/not on the CS-80|CS-80 has none/i.test(document.body.innerText + document.body.innerHTML)`)), 'no "not on the CS-80" markings');
  // Brilliance Mix: lever up = channel I (mix -1), down = channel II, as on the faceplate
  await evaluate(`(() => { const f = document.querySelector('[data-field="mix"] .fader'); f.focus(); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); })()`); await sleep(250);
  const mixTop = await evaluate(`values[fieldIx.mix]`);
  await evaluate(`(() => { const f = document.querySelector('[data-field="mix"] .fader'); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); f.blur(); })()`); await sleep(250);
  check(Math.abs(mixTop + 1) < 1e-6 && Math.abs(await evaluate(`values[fieldIx.mix]`) - 1) < 1e-6 && await evaluate(`[...document.querySelectorAll('[data-field="mix"] .fsc')].map(e => e.textContent).join('/') === 'I/II'`), 'Mix lever: up = channel I, down = channel II, scale I over II');
  await evaluate(`$('reset-preset').click()`); await sleep(200);
  check(await evaluate(`(() => { const r = $('favicon-test') || document.querySelector('link[rel=icon][type="image/svg+xml"]'); return !!r && /favicon\.svg/.test(r.getAttribute('href')); })()`) && (await (await fetch(new URL('favicon.svg', url))).text()).includes('#815ba4'), 'favicon: a purple (#815ba4) SVG circle');
  check(await evaluate(`document.querySelectorAll('#panel .fader[role=slider][tabindex="0"]').length > 70 && document.querySelectorAll('#panel .rocker[role=switch]').length === 5`), 'levers are focusable sliders, on/off controls are rocker switches');
  check(await evaluate(`getComputedStyle(document.querySelector('[data-field="I.lpf_res"] .fcap')).backgroundImage.includes('232, 64, 58') && getComputedStyle(document.querySelector('[data-field="I.fr"] .fcap')).backgroundImage.includes('255, 226, 74')`), 'cap colours: resonance red, release yellow');
  // G: layout: presets left, panel fills the middle, keyboard pinned to the bottom, no sideways scrolling
  const lay0 = await evaluate(`(() => { const p = $('perform').getBoundingClientRect(), b = $('browser').getBoundingClientRect(), s = $('sound'); return { pb: p.bottom, pw: p.width, bl: b.left, ih: innerHeight, iw: innerWidth, sw: document.documentElement.scrollWidth, sx: s.scrollWidth - s.clientWidth, sy: s.scrollHeight - s.clientHeight, zoom: +document.querySelector('.face').style.zoom }; })()`);
  check(Math.abs(lay0.pb - lay0.ih) < 1.5 && Math.abs(lay0.pw - lay0.iw) < 1.5, `keyboard area spans the width at the bottom (${JSON.stringify(lay0)})`);
  check(lay0.bl === 0 && lay0.sw <= lay0.iw && lay0.sx <= 1 && lay0.sy <= 1, 'presets on the left; the panel fits 1440x900 without scrolling');

  // E: saw and square are continuous levels; levers answer to keys, drag, wheel and double-click
  const fsel = (f) => `document.querySelector('[data-field="${f}"] .fader')`;
  await evaluate(`(() => { const f = ${fsel('I.square')}; f.focus(); const k = (key) => f.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); k('End'); for (let i = 0; i < 65; i++) k('ArrowDown'); })()`);
  await sleep(250);
  check(Math.abs(await evaluate(`values[fieldIx['I.square']]`) - 0.35) < 0.01, 'Square I lever (keyboard) sets a level of 0.35 (not a switch)');
  check(await evaluate(`!document.querySelector('.ftip').hidden && /Square: 0\.35/.test(document.querySelector('.ftip').textContent)`), 'value tooltip: ' + await evaluate(`document.querySelector('.ftip').textContent`));
  const rect = async (f) => evaluate(`(() => { const r = ${fsel(f)}.querySelector('.fcap').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const mouse = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  let r0 = await rect('fx.echo_mix');
  await mouse('mousePressed', r0.x, r0.y); await mouse('mouseMoved', r0.x, r0.y - 30); await mouse('mouseMoved', r0.x, r0.y - 60); await mouse('mouseReleased', r0.x, r0.y - 60);
  await sleep(300);
  check(await evaluate(`values[fieldIx['fx.echo_mode']] > 0 && values[fieldIx['fx.echo_mix']] > 0.3`), 'dragging the Echo mix lever up switches echo on: mix ' + (await evaluate(`values[fieldIx['fx.echo_mix']]`)).toFixed(2));
  const lpfA = await evaluate(`values[fieldIx['I.lpf_hz']]`);
  r0 = await rect('I.lpf_hz');
  for (let i = 0; i < 5; i++) await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r0.x, y: r0.y, deltaX: 0, deltaY: -100 });
  await sleep(300);
  const lpfB = await evaluate(`values[fieldIx['I.lpf_hz']]`);
  check(lpfB > lpfA * 1.1, `scroll wheel opens LPF I (${lpfA.toFixed(0)} -> ${lpfB.toFixed(0)} Hz)`);
  await mouse('mousePressed', r0.x, r0.y, { clickCount: 1 }); await mouse('mouseReleased', r0.x, r0.y, { clickCount: 1 });
  await mouse('mousePressed', r0.x, r0.y, { clickCount: 2 }); await mouse('mouseReleased', r0.x, r0.y, { clickCount: 2 });
  await sleep(300);
  check(Math.abs(await evaluate(`values[fieldIx['I.lpf_hz']] - presetVals[fieldIx['I.lpf_hz']]`)) < 1, 'double-click resets the lever to the preset');
  await evaluate(`document.querySelector('[data-field="chorus.trem_on"] .rocker').click()`); await sleep(200);
  check(await evaluate(`values[fieldIx['chorus.trem_on']] === 1 && document.querySelector('[data-field="chorus.trem_on"] .rocker').getAttribute('aria-checked') === 'true'`), 'tremolo rocker switches on');
  await evaluate(`document.querySelector('[data-field="chorus.trem_on"] .rocker').click(); document.activeElement.blur()`);
  await evaluate(`$('next').click()`); await sleep(200); await evaluate(`$('prev').click()`); await sleep(300);

  // D: guided setup, Oxygen path; pads share the keybed channel and get skipped
  await evaluate(`$('learn-nudge-setup').click()`);
  const body1 = await evaluate(`$('setup-body').textContent`);
  check(/SHIFT/.test(body1) && /DAW\/PRESET/.test(body1) && /N2/.test(body1) && /preset 9/.test(body1), 'setup step 1: DAW mode N2 (SHIFT + DAW/PRESET) or Preset 9');
  check(!/factory reset|erases/i.test(await evaluate(`document.body.innerHTML`)), 'no factory-reset claim anywhere');
  check(await evaluate(`$('setup-next').disabled`), 'step 1: Next waits for a live check');
  await evaluate(`__midi('b', [0xb0, 16, 1])`);
  check(await evaluate(`$('setup-checks').querySelector('.no') && /Mackie/.test($('setup-checks').textContent)`), 'step 1: a Mackie V-pot gets a red cross');
  await evaluate(`__midi('a', [0xb0, 70, 64])`);
  check(await evaluate(`!!$('setup-checks').querySelector('.yes') && !$('setup-next').disabled`), 'step 1: a plain CC on USB MIDI gets a green check');
  await evaluate(`$('setup-next').click()`);
  check(await evaluate(`/USB MIDI/.test($('setup-body').textContent) && !!$('setup-input')`), 'step 2: pick the USB MIDI input (picker in the step)');
  await evaluate(key(60));
  check(await evaluate(`/Keys play on channel 1/.test($('setup-checks').textContent) && !$('setup-next').disabled`), 'step 2: key verified on channel 1');
  await evaluate(`$('setup-next').click()`);
  check(await evaluate(`/CHANNEL UP/.test($('setup-body').textContent) && /10/.test($('setup-body').textContent)`), 'step 3: SHIFT + CHANNEL UP to 10');
  await evaluate(key(36) + key(60));
  check(await evaluate(`/share channel 1/.test($('setup-checks').textContent) && $('setup-next').disabled`), 'step 3: pads sharing channel 1 are caught');
  await shot('setup-pads');
  await evaluate(`$('setup-skip-pads').click()`);
  check(await evaluate(`/Pads skipped/.test($('setup-checks').textContent)`), 'step 4: pads skipped');
  await evaluate(`$('setup-next').click()`);
  check(await evaluate(`$('setup').hidden && !$('learn').hidden && $('learn-prompt').textContent === 'Move slider 1'`), 'setup opens Learn at slider 1 (keybed already known)');
  await evaluate(`(() => { for (let i = 0; i < 9; i++) __midi('a', [0xb0, 40 + i, 64]); for (let i = 0; i < 8; i++) __midi('a', [0xb0, 60 + i, 64]); })()`);
  check(await evaluate(`$('learn-prompt').textContent`) === 'Press the button under slider 1', 'Learn never asks for the skipped pads');
  await evaluate(`$('learn-done').click()`);
  check(await evaluate(`$('learn').hidden && !$('setup').hidden && /All set/.test($('setup-title').textContent) && /Cutoff/.test($('setup-body').textContent)`), 'setup ends on the map');
  await shot('setup-done');
  await evaluate(`$('setup-next').click()`);
  const lay = await evaluate(`JSON.parse(localStorage.getItem('cs80.layout'))`);
  check(lay && lay.keybed && lay.keybed.ch === 0 && !Object.keys(lay.controls).some(k => k[0] === 'p'), 'saved layout: keybed channel 1, no pads');
  // A: keybed notes never trigger actions once pads were skipped
  const ix0 = await evaluate(`current.index`);
  await evaluate(`for (let n = 36; n < 52; n++) __midi('a', [0x90, n, 100])`);
  await sleep(300);
  check(await evaluate(`current.index`) === ix0 && await evaluate(`document.querySelectorAll('.key.on').length`) === 16, 'pads skipped: 16 shared notes all play, no preset change');
  await evaluate(`for (let n = 36; n < 52; n++) __midi('a', [0x80, n, 0])`);
  await sleep(100);
  check(await evaluate(`document.querySelectorAll('.key.on').length`) === 0, 'and all of them release');
  // an old saved layout with ch1 pad notes must not take keys either
  await evaluate(`perf.setLayout({ name: 'old', controls: { p1: { t: 'note', ch: 0, n: 36, port: 'Oxygen 49 USB MIDI' }, p2: { t: 'note', ch: 0, n: 37 } } })`);
  await evaluate(`__midi('a', [0x90, 37, 100]); __midi('a', [0x90, 36, 100])`);
  await sleep(300);
  check(await evaluate(`current.index`) === ix0 && await evaluate(`!!document.querySelector('.key.on[data-note="37"]')`), 'legacy layout: keybed note 37 plays, no preset change');
  await evaluate(`__midi('a', [0x80, 37, 0]); __midi('a', [0x80, 36, 0])`);

  // Learn from the Controls tab: key first, a shared pad stops the wizard, ch10 pads are re-detected
  await evaluate(`$('tab-legend').click(); $('learn-open').click()`);
  check(await evaluate(`$('learn-prompt').textContent`) === 'Press any key on the keyboard', 'Learn starts with one key press');
  await evaluate(key(64));
  await evaluate(`(() => { for (let i = 0; i < 9; i++) __midi('a', [0xb0, 40 + i, 64]); for (let i = 0; i < 8; i++) __midi('a', [0xb0, 60 + i, 64]); })()`);
  check(await evaluate(`$('learn-prompt').textContent`) === 'Hit pad 1', 'at pad 1');
  await evaluate(key(36));
  check(await evaluate(`!$('learn-conflict').hidden && /channel 1/.test($('learn-conflict-text').textContent) && /CHANNEL UP/.test($('learn-conflict-how').textContent)`), 'shared pad: the wizard stops and explains: ' + await evaluate(`$('learn-conflict-text').textContent`));
  check(await evaluate(`$('learn-prompt').textContent`) === 'Hit pad 1', 'shared pad: nothing bound');
  await shot('learn-conflict');
  await evaluate(`__midi('a', [0x99, 36, 100]); __midi('a', [0x89, 36, 0])`);
  check(await evaluate(`$('learn-prompt').textContent === 'Hit pad 2' && $('learn-conflict').hidden`), 'pad moved to channel 10: re-detected and learned');
  await evaluate(`(() => { for (let i = 1; i < 8; i++) { __midi('a', [0x99, 36 + i, 100]); __midi('a', [0x89, 36 + i, 0]); } for (let i = 0; i < 7; i++) __midi('b', [0xb0, 80 + i, 127]); })()`);
  check(await evaluate(`$('learn-prompt').textContent === 'Press the button under slider 8' && /slider 9 is skipped/.test($('learn-hint').textContent)`), 'Oxygen Learn: one-line note that the slider 9 button is skipped');
  await evaluate(`__midi('b', [0xb0, 87, 127])`);
  check(await evaluate(`$('learn-prompt').textContent`) === 'Press Loop', 'Learn goes from the slider 8 button straight to Loop');
  await evaluate(`__midi('a', [0xb0, 113, 127]); __midi('a', [0xb0, 113, 0])`);
  await evaluate(`$('learn-done').click()`);
  const lpf0 = await evaluate(`values[fieldIx['I.lpf_hz']]`);
  await evaluate(`__midi('a', [0xb0, 41, 64]); __midi('a', [0xb0, 41, 127])`);
  await sleep(300);
  const lpf1 = await evaluate(`values[fieldIx['I.lpf_hz']]`);
  check(lpf1 > lpf0 * 4, `slider 2 opens the LPF (${lpf0.toFixed(0)} -> ${lpf1.toFixed(0)} Hz)`);
  check(await evaluate(`['I.lpf_hz', 'II.lpf_hz'].every(f => { const n = +document.querySelector('[data-field="' + f + '"] .fader').getAttribute('aria-valuenow'); return n > 600 && Math.abs(n - Math.round(inv(rawDefs[f].m, values[fieldIx[f]]) * 1000)) <= 2; })`), 'the LPF levers follow the hardware slider');
  check(await evaluate(`(() => { __midi('a', [0xb0, 41, 90]); return document.querySelector('[data-field="I.lpf_hz"]').classList.contains('hit'); })()`), 'a hardware-moved lever lights up');
  // Reset preset: from the button, a double-click on the name, and the Loop button (default map)
  check(await evaluate(`[...document.querySelectorAll('#legend-map .lrow')].some(r => r.children[0].textContent === 'Loop' && r.children[1].textContent === 'Reset preset') && ![...document.querySelectorAll('#legend-map .lrow .k')].some(k => k.textContent === 'B9')`), 'legend: Loop resets the preset, no B9 row');
  check(await evaluate(`(() => { const s = document.createElement('select'); targetOptions(s, 'none'); return [...s.options].some(o => o.value === 'preset_reset'); })()`), 'Reset preset is in the target dropdown');
  check(await evaluate(visible('#reset-preset')) && await evaluate(`$('preset-name').textContent === banks()[current.bank][current.index].name`), 'Reset preset button next to the preset name');
  const diffs = `info.fields.filter((f, i) => Math.abs(values[i] - presetVals[i]) > 1e-6).length`;
  const tweak = `(() => { __midi('a', [0x90, 62, 100]); __midi('a', [0xb0, 41, 30]); const f = ${fsel('I.noise')}; f.focus(); for (let i = 0; i < 20; i++) f.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); f.blur(); })()`;
  await evaluate(tweak); await sleep(300);
  const nd = await evaluate(diffs);
  await evaluate(`$('reset-preset').click()`); await sleep(300);
  check(nd >= 3 && await evaluate(diffs) === 0 && await evaluate(`!!document.querySelector('.key.on[data-note="62"]')`), `Reset preset button: ${nd} tweaked fields back to the preset, held note still down`);
  await evaluate(tweak); await sleep(300);
  await evaluate(`$('preset-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await sleep(300);
  check(await evaluate(diffs) === 0, 'double-click on the preset name resets it');
  await evaluate(tweak); await sleep(300);
  await evaluate(`__midi('a', [0xb0, 113, 127]); __midi('a', [0xb0, 113, 0])`); await sleep(300);
  check(await evaluate(diffs) === 0, 'the Loop button resets the preset');
  await evaluate(`__midi('a', [0x80, 62, 0])`);
  const ix1 = await evaluate(`current.index`);
  await evaluate(`__midi('a', [0x99, 37, 100])`); await sleep(300);
  check(await evaluate(`current.index`) === ix1 + 1, 'pad 2 (ch10) loads the next preset');
  await evaluate(`__midi('a', [0x90, 37, 100])`); await sleep(300);
  check(await evaluate(`current.index`) === ix1 + 1 && await evaluate(`!!document.querySelector('.key.on[data-note="37"]')`), 'key 37 on ch1 plays and changes nothing');
  await evaluate(`__midi('a', [0x80, 37, 0]); __midi('a', [0xb0, 48, 127])`); await sleep(100);
  check(await evaluate(`atLevel`) === 127, 'slider 9 drives aftertouch');
  await evaluate(`__midi('a', [0xb0, 48, 0])`);
  await evaluate(`__midi('a', [0xb0, 67, 0])`); await sleep(100);
  check(await evaluate(`perf.gain`) === 0 && await evaluate(`${fsel('gain')}.getAttribute('aria-valuetext') === '-inf dB'`), 'knob 8 at 0: volume 0, shown on the Volume lever');
  await evaluate(`__midi('a', [0xb0, 67, 127])`);

  // User bank: Save, Save as, overwrite confirm, rename, delete, undo, export/import, program change
  check(await evaluate(visible('#save')) && await evaluate(visible('#save-as')) && /Saves to User 1 \(empty\)/.test(await evaluate(`$('save-target').textContent`)), 'Save and Save as sit under the preset name: ' + await evaluate(`$('save-target').textContent`));
  check(await evaluate(`banks().User.length === 16 && banks().User.every(p => p.empty) && Object.keys(banks()).at(-1) === 'User'`), 'an empty 16-slot User bank, last in the list');
  const base0 = await evaluate(`loaded.name`);
  await evaluate(`(() => { const f = ${fsel('I.noise')}; f.focus(); for (let i = 0; i < 30; i++) f.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); f.blur(); })()`); await sleep(250);
  const noise1 = await evaluate(`values[fieldIx['I.noise']]`);
  await evaluate(`$('save').click()`); await sleep(700);
  check(await evaluate(`userBank[0] && userBank[0].name === ${JSON.stringify(base0)} && current.bank === 'User' && current.index === 0 && Math.abs(userBank[0].fields['I.noise'] - ${noise1}) < 1e-5`), `Save: the edited sound (noise ${noise1.toFixed(2)}) is in User 1 as "${base0}", now the current preset`);
  check(await evaluate(`JSON.parse(localStorage.getItem('cs80.userbank')).slots[0].name === ${JSON.stringify(base0)}`), 'Save: kept in localStorage');
  check(await evaluate(`$('save-ask').hidden && ${diffs} === 0`), 'Save: no question for an empty slot; Reset preset now returns to the saved sound');
  // load something else, then reach User 1 by bank select + program change
  await evaluate(`selectBank('Brass')`); await sleep(400);
  check(Math.abs(await evaluate(`values[fieldIx['I.noise']]`) - noise1) > 0.05, 'another preset loaded');
  const ub = await evaluate(`Object.keys(banks()).indexOf('User')`);
  await evaluate(`__midi('a', [0xb0, 0, ${ub}]); __midi('a', [0xc0, 0])`); await sleep(400);
  check(await evaluate(`current.bank === 'User' && current.index === 0 && loaded.origin === 'user'`) && Math.abs(await evaluate(`values[fieldIx['I.noise']]`) - noise1) < 1e-5, `bank select ${ub} + program change 1 loads User 1`);
  await evaluate(`__midi('a', [0xc0, 4])`); await sleep(200);
  check(await evaluate(`userSlot === 4 && current.index === 0 && /User 5 is empty/.test($('status').textContent) && /Saves to User 5/.test($('save-target').textContent)`), 'program change to an empty User slot selects it as the save target');
  // Save as: name and slot
  await evaluate(`$('save-as').click()`);
  check(await evaluate(`!$('save-form').hidden && $('save-slot').value === '4' && document.activeElement === $('save-name')`), 'Save as: form opens on the target slot with the name selected');
  await evaluate(`$('save-name').value = 'My Brass'; $('save-slot').value = '1'; $('save-form').requestSubmit()`); await sleep(700);
  check(await evaluate(`userBank[1] && userBank[1].name === 'My Brass' && current.index === 1 && $('preset-name').textContent === 'My Brass' && $('save-form').hidden`), 'Save as: "My Brass" in User 2');
  // overwrite asks first; Cancel keeps it, Replace replaces, Undo restores
  await evaluate(`selectBank('Pads')`); await sleep(400);
  await evaluate(`setUserSlot(1); $('save').click()`); await sleep(200);
  check(await evaluate(`!$('save-ask').hidden && /User 2 holds "My Brass"/.test($('save-ask-text').textContent)`), 'Save over a different sound asks first: ' + await evaluate(`$('save-ask-text').textContent`));
  await evaluate(`$('save-ask-no').click()`); await sleep(200);
  check(await evaluate(`userBank[1].name === 'My Brass' && $('save-ask').hidden && current.bank === 'Pads'`), 'Cancel keeps User 2');
  const padName = await evaluate(`loaded.name`);
  await evaluate(`$('save').click()`); await sleep(200); await evaluate(`$('save-ask-ok').click()`); await sleep(700);
  check(await evaluate(`userBank[1].name === ${JSON.stringify(padName)} && !$('user-undo').hidden`), 'Replace overwrites User 2 and offers Undo');
  await evaluate(`$('user-undo').click()`); await sleep(200);
  check(await evaluate(`userBank[1].name === 'My Brass' && $('user-undo').hidden`), 'Undo brings "My Brass" back');
  // rename and delete the selected slot
  await evaluate(`pickSlot(1); $('user-rename').click()`); await sleep(400);
  await evaluate(`$('save-name').value = 'Brass Two'; $('save-form').requestSubmit()`); await sleep(200);
  check(await evaluate(`userBank[1].name === 'Brass Two' && [...$('presets').children][1].textContent.includes('Brass Two')`), 'Rename');
  await evaluate(`$('user-delete').click()`); await sleep(100); await evaluate(`$('save-ask-ok').click()`); await sleep(200);
  check(await evaluate(`userBank[1] === null && [...$('presets').children][1].classList.contains('empty')`), 'Delete empties the slot');
  await evaluate(`$('user-undo').click()`); await sleep(200);
  check(await evaluate(`userBank[1] && userBank[1].name === 'Brass Two'`), 'Undo after Delete');
  // a hardware button mapped to "Save to current user slot" saves without a dialog
  await evaluate(`setTarget('t_loop', 'user_save'); pickSlot(0)`); await sleep(400);
  await evaluate(`(() => { const f = ${fsel('I.noise')}; f.focus(); for (let i = 0; i < 10; i++) f.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); f.blur(); })()`); await sleep(250);
  const noise2 = await evaluate(`values[fieldIx['I.noise']]`);
  await evaluate(`__midi('a', [0xb0, 113, 127]); __midi('a', [0xb0, 113, 0])`); await sleep(700);
  check(await evaluate(`$('save-ask').hidden && Math.abs(userBank[0].fields['I.noise'] - ${noise2}) < 1e-5 && /Saved/.test($('status').textContent)`), 'Loop mapped to "Save to current user slot" saves the edit to User 1');
  check(await evaluate(`(() => { const s = document.createElement('select'); targetOptions(s, 'none'); return [...s.options].some(o => o.value === 'user_save' && o.textContent === 'Save to current user slot'); })() && P.DEFAULT_MAP.t_rec === 'user_save'`), '"Save to current user slot" is a learnable action (Record by default)');
  await evaluate(`setTarget('t_loop', 'preset_reset')`);
  // export, then import into an emptied bank
  await evaluate(`window.__dl = null; HTMLAnchorElement.prototype.__click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl = { name: this.download, href: this.href }; else this.__click(); }`);
  await evaluate(`$('user-export').click()`);
  const exported = await evaluate(`window.__dl ? fetch(__dl.href).then(r => r.text()) : ''`);
  let ex = null; try { ex = JSON.parse(exported); } catch {}
  check(await evaluate(`window.__dl && __dl.name === 'cs80-user-bank.json'`) && ex && ex.format === 'cs80v2-user-bank' && ex.slots.length === 2 && ex.slots[1].slot === 2 && ex.slots[1].name === 'Brass Two' && Object.keys(ex.slots[0].fields).length > 100, `Export: cs80-user-bank.json with ${ex ? ex.slots.length : 0} presets and every field`);
  await evaluate(`userBank = userBank.map(() => null); refreshUser()`);
  check(await evaluate(`importUser(${JSON.stringify(exported)})`) && await evaluate(`userBank[0] && userBank[1].name === 'Brass Two' && !userBank[2]`), 'Import restores the exported bank');
  const imp2 = evaluate(`importUser(${JSON.stringify(exported)})`); await sleep(100);
  check(await evaluate(`!$('save-ask').hidden && /replaces 2 User presets/.test($('save-ask-text').textContent)`), 'Import over saved presets asks first');
  await evaluate(`$('save-ask-ok').click()`); await imp2;
  const copied = await evaluate(`settingsJSON()`);
  await evaluate(`setUserSlot(7)`);
  check(await evaluate(`importUser(${JSON.stringify(copied)})`) && await evaluate(`!!userBank[7]`), 'Import takes Copy settings text into the selected slot');
  check(!(await evaluate(`importUser('{"nope": 1}')`)) && /Could not import/.test(await evaluate(`$('status').textContent`)), 'Import rejects other JSON');
  await evaluate(`$('user-undo').click()`);
  await evaluate(`$('panic').onclick()`);

  // screenshots: the faceplate with each tab, Advanced open, then other screen sizes
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await evaluate(`$('learn-nudge').hidden = true; $('tab-keyboard').click(); document.activeElement.blur(); fitPanel()`); await sleep(500);
  await shot('panel-1440x900');
  await evaluate(`$('tab-legend').click(); fitPanel()`); await sleep(300);
  await shot('panel-1440x900-controls');
  await evaluate(`$('advanced').open = true`); await sleep(300);
  check(await evaluate(`(() => { const p = $('perform').getBoundingClientRect(); return Math.abs(p.bottom - innerHeight) < 1.5; })()`), 'opening Advanced leaves the keyboard area at the bottom');
  await shot('panel-1440x900-advanced');
  await evaluate(`$('advanced').open = false; $('tab-keyboard').click()`);
  for (const [w, h] of [[1920, 1080], [1024, 768]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    const l = await evaluate(`(() => { const s = $('sound'); return { sw: document.documentElement.scrollWidth, iw: innerWidth, sx: s.scrollWidth - s.clientWidth, pb: Math.round($('perform').getBoundingClientRect().bottom), ih: innerHeight, zoom: document.querySelector('.face').style.zoom, wrap: $('panel').classList.contains('wrap') }; })()`);
    check(l.sw <= l.iw && l.sx <= 1 && Math.abs(l.pb - l.ih) <= 1, `${w}x${h}: no sideways scrolling, keyboard at the bottom (${JSON.stringify(l)})`);
    await shot(`panel-${w}x${h}`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);

  // Mackie/HUI profile still learns from the DAW port
  await evaluate(`$('learn-open').click()`);
  await evaluate(key(60));
  await evaluate(`(() => {
    const pb = (ch, x) => { const v = Math.round(x * 16383); return [0xe0 | ch, v & 127, v >> 7]; };
    for (let i = 0; i < 9; i++) { __midi('b', [0x90, 104 + i, 127]); __midi('b', [0xf0, 0, 0, 0x66, 0x14, 0xf7]); __midi('b', pb(i, 0.5)); __midi('b', pb(i, 0.51)); __midi('b', [0x90, 104 + i, 0]); }
    for (let i = 0; i < 8; i++) { __midi('b', [0xb0, 16 + i, 1]); __midi('b', [0xb0, 16 + i, 1]); }
    for (let i = 0; i < 8; i++) { __midi('b', [0x90, 24 + i, 127]); __midi('b', [0x90, 24 + i, 0]); }
  })()`);
  check(await evaluate(`$('learn-prompt').textContent`) === 'Press the button under slider 1', 'Mackie Learn: faders, V-pots and pads captured');
  await evaluate(`$('learn-done').click()`);
  const ix2 = await evaluate(`current.index`);
  await evaluate(`__midi('b', [0x90, 25, 127]); __midi('b', [0x90, 25, 0])`); await sleep(300);
  check(await evaluate(`current.index`) === ix2 + 1, 'Mackie button (pad 2) loads the next preset');
  await evaluate(`__midi('b', [0x90, 60, 100])`); await sleep(100);
  check(await evaluate(`!document.querySelector('.key.on[data-note="60"]')`), 'a note from the DAW port does not play');
  await evaluate(`__midi('b', [0x80, 60, 0])`);

  // Reset controller setup
  await evaluate(`favs[0] = { bank: 'Core', name: 'Chariots' }; save(LS.favs, favs); setTarget('k1', 'reverb')`);
  await evaluate(`$('reset-setup').click()`);
  const left = await evaluate(`['cs80.layout', 'cs80.perfmap', 'cs80.favs', 'cs80.ccmode'].filter(k => localStorage.getItem(k) !== null)`);
  check(left.length === 0, 'Reset clears the saved layout, map, favourites and mode' + (left.length ? ': ' + left : ''));
  check(await evaluate(`JSON.parse(localStorage.getItem('cs80.userbank')).slots.filter(Boolean).length === 2`), 'Reset controller setup leaves the User bank alone');
  check(await evaluate(`!Object.keys(perf.layout.controls).length && perf.map.k1 === 'chorus' && favs.every(f => !f) && /not set up/.test($('legend-title').textContent)`), 'Reset puts the running page back to defaults');
  await evaluate(`__midi('a', [0x90, 36, 100])`); await sleep(100);
  check(await evaluate(`!!document.querySelector('.key.on[data-note="36"]')`), 'after Reset, keys play');
  await evaluate(`__midi('a', [0x80, 36, 0])`);

  // the User bank survives a reload
  await evaluate(`sessionStorage.setItem('kept', '1')`);
  await cdp('Page.reload');
  for (let i = 0; i < 50 && !(await evaluate(`typeof $ === 'function' && !!$('start')`)); i++) await sleep(200);
  await sleep(500);
  await evaluate(`$('start').click()`);
  for (let i = 0; i < 40 && !(await evaluate(`!!info && !!values`)); i++) await sleep(250);
  await evaluate(`selectBank('User')`); await sleep(400);
  check(await evaluate(`banks().User.filter(p => !p.empty).length === 2 && loaded.origin === 'user' && loaded.slot === 1 && Math.abs(values[fieldIx['I.noise']] - userBank[0].fields['I.noise']) < 1e-5`), 'after a reload the User bank is back and User 1 loads its sound');
  await evaluate(`sessionStorage.removeItem('kept')`);
} catch (e) { console.log('FAIL', e.message); bad++; }
const errs = logs.filter((l) => /^(error|EXCEPTION)/.test(l));
check(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
ws.close(); proc.kill(); if (server) server.close();
console.log(bad ? `${bad} FAILED` : 'browser checks passed');
process.exit(bad ? 1 : 0);
