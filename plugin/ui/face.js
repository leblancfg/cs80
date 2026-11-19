'use strict';
/* The plugin faceplate: web/app.js's panel (buildPanel, buildControl,
   fitPanel), bound to the plugin's parameters through the JUCE WebView
   backend instead of the audio worklet. face-defs.js (FACE, fwd, inv, fmt)
   comes verbatim from app.js, so levers sit and scale as on the web page.

   Plugin -> page:  cs80values  {field: engine value, ...} (changed ones only)
                    cs80program {name, values}  (the program, for double-click reset)
   Page -> plugin:  cs80 {t: 'ready'} | {t: 'begin'|'end', id} | {t: 'set', id, v}
   A 'set' outside begin/end is one gesture of its own (wheel, keys, clicks). */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const dbText = (g) => (g <= 1e-5 ? '-inf dB' : (g >= 0.9999 ? '0' : (20 * Math.log10(g)).toFixed(1)) + ' dB');

const backend = window.__JUCE__ && window.__JUCE__.backend;
const emit = (o) => { if (backend) backend.emitEvent('cs80', o); };

const values = {};          // field -> engine value, as the plugin last reported it
let presetVals = null;      // field -> value of the current program
const controls = [];
const byField = new Map();
const rawLabel = (f) => { const c = byField.get(f); return c ? (f.startsWith('II.') ? 'II ' : f.startsWith('I.') ? 'I ' : '') + c.l : f; };

const send = (f, v) => { values[f] = v; emit({ t: 'set', id: f, v }); };

function buildPanel() {
  const panel = $('panel');
  const section = (title, list) => {
    list = list.filter((c) => c.k !== 'gain'); // the web page's own volume; the host's fader does that here
    if (!list.length) return null;
    const s = el('div', 'fsec');
    s.appendChild(el('div', 'ftitle', title));
    const row = el('div', 'frow');
    for (const c of list) row.appendChild(buildControl(c));
    s.appendChild(row);
    return s;
  };
  const add = (parent, s) => { if (s) parent.appendChild(s); };
  const face = el('div', 'face');
  const left = el('div', 'fleft');
  for (const r of FACE.left) { const line = el('div', 'fline'); for (const [t, l] of r) add(line, section(t, l)); left.appendChild(line); }
  const chans = el('div', 'fchans');
  for (const [num, subs] of FACE.ch) {
    const line = el('div', 'fline fch');
    line.appendChild(el('div', 'fnum', num));
    for (const [t, l] of subs) add(line, section(t, l));
    chans.appendChild(line);
  }
  const top = el('div', 'ftop');
  top.append(left, chans);
  const strip = el('div', 'fline fstrip');
  for (const [t, l] of FACE.strip) add(strip, section(t, l));
  const ex = el('div', 'fextras');
  const exl = el('div', 'fline');
  for (const [t, l] of FACE.extras) add(exl, section(t, l));
  ex.appendChild(exl);
  strip.appendChild(ex);
  face.append(top, strip);
  panel.appendChild(face);
  fitPanel();
}

/* a CS-80 lever: drag, wheel, arrow keys, double-click resets to the program */
const tip = el('div', 'ftip');
tip.hidden = true;
document.body.appendChild(tip);
function showTip(c, anchor) {
  tip.textContent = `${rawLabel(c.f)}: ${c.text()}`;
  tip.hidden = false;
  const r = anchor.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2)) + 'px';
  tip.style.top = Math.max(4, r.top - tip.offsetHeight - 6) + 'px';
}
const hideTip = () => { tip.hidden = true; };

function buildControl(c) {
  const col = el('div', 'fctl');
  col.dataset.field = c.f;
  const lab = el('label', 'flab', c.pl || c.l);
  lab.title = rawLabel(c.f);
  const kind = c.m[0];

  if (kind === 'bool') {
    // a rocker tab, like the square and saw switches on the original
    col.classList.add('rock');
    const b = el('button', 'rocker');
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.innerHTML = '<span></span>';
    let on = false;
    c.text = () => (on ? 'on' : 'off');
    const setOn = (v) => { on = v; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); };
    b.onclick = () => { setOn(!on); send(c.f, on ? 1 : 0); showTip(c, b); };
    b.onpointerenter = b.onfocus = () => showTip(c, b);
    b.onpointerleave = b.onblur = hideTip;
    col.append(el('span', 'fsc', 'ON'), b, el('span', 'fsc', 'OFF'), lab);
    c.set = (v) => setOn(v >= 0.5);
  } else {
    const n = kind === 'enum' ? c.m[1].length : 0;
    let x = 0; // 0..1 lever position
    const f = el('div', 'fader' + (c.lvl ? ' lvl' : '') + (n ? ' steps' : ''));
    f.tabIndex = 0;
    f.setAttribute('role', 'slider');
    const track = el('div', 'ftrack');
    const ticks = el('div', 'fticks');
    const nt = n || (c.lvl ? 2 : 11);
    for (let i = 0; i < nt; i++) { const t = el('i', i === 0 || i === nt - 1 || (!n && !c.lvl && i === 5) ? 'big' : ''); t.style.bottom = (100 * i / (nt - 1)) + '%'; ticks.appendChild(t); }
    const cap = el('div', 'fcap cap-' + (c.cap || 'w'));
    f.append(ticks, track, cap);
    const sc = c.sc || (n ? [c.m[1][n - 1], c.m[1][0]] : c.lvl ? ['1', '0'] : ['10', '0']);
    const value = () => (n ? Math.round(x * (n - 1)) : fwd(c.m, x));
    c.text = () => (n ? c.m[1][Math.round(x * (n - 1))] : fmt(c, value()));
    const draw = () => {
      cap.style.bottom = `calc(${x * 100}% - var(--caph) / 2)`;
      if (!tip.hidden && tip.dataset.f === c.f) showTip(c, cap);
    };
    const commit = (nx) => {
      nx = Math.min(1, Math.max(0, nx));
      if (n) nx = Math.round(nx * (n - 1)) / (n - 1);
      if (nx === x && c.touched) return;
      x = nx; c.touched = true;
      c.dragging = performance.now();
      send(c.f, value());
      // raising the echo level switches echo on, as on the web page
      if (c.f === 'fx.echo_mix' && x > 0 && values['fx.echo_mode'] < 0.5) send('fx.echo_mode', 1);
      draw();
    };
    // drag: grabbing the cap moves it relative to where it was; a click on the slot jumps there first
    let drag = null;
    f.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); f.focus();
      f.setPointerCapture(e.pointerId);
      emit({ t: 'begin', id: c.f });
      const r = track.getBoundingClientRect();
      if (e.target !== cap) commit(1 - (e.clientY - r.top) / r.height);
      drag = { y: e.clientY, x0: x, h: r.height };
      tip.dataset.f = c.f; showTip(c, cap);
      col.classList.add('drag');
    });
    f.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const fine = e.shiftKey ? 0.2 : 1;
      commit(drag.x0 + fine * (drag.y - e.clientY) / drag.h);
    });
    const end = () => { if (drag) emit({ t: 'end', id: c.f }); drag = null; col.classList.remove('drag'); };
    f.addEventListener('pointerup', end);
    f.addEventListener('pointercancel', end);
    f.addEventListener('lostpointercapture', end);
    f.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = (e.deltaY || -e.deltaX) < 0 ? 1 : -1;
      commit(x + dir * (n ? 1 / (n - 1) : e.shiftKey ? 0.002 : 0.01));
      tip.dataset.f = c.f; showTip(c, cap);
    }, { passive: false });
    f.addEventListener('keydown', (e) => {
      const s = n ? 1 / (n - 1) : e.shiftKey ? 0.002 : 0.01;
      const d = { ArrowUp: s, ArrowRight: s, ArrowDown: -s, ArrowLeft: -s, PageUp: n ? s : 0.1, PageDown: n ? -s : -0.1 }[e.key];
      if (d !== undefined) commit(x + d);
      else if (e.key === 'Home') commit(0);
      else if (e.key === 'End') commit(1);
      else return;
      e.preventDefault(); e.stopPropagation();
      tip.dataset.f = c.f; showTip(c, cap);
    });
    f.addEventListener('dblclick', () => {
      const v = presetVals && presetVals[c.f];
      if (v !== undefined) commit(n ? v / (n - 1) : inv(c.m, v));
    });
    f.title = 'Drag, scroll or use the arrow keys. Double-click resets it to the program.';
    f.onpointerenter = f.onfocus = () => { tip.dataset.f = c.f; showTip(c, cap); };
    f.onpointerleave = f.onblur = () => { if (!drag && document.activeElement !== f) hideTip(); };
    f.addEventListener('focusout', hideTip);
    col.append(el('span', 'fsc', sc[0]), f, el('span', 'fsc', sc[1]), lab);
    c.set = (v) => {
      if (c.dragging && performance.now() - c.dragging < 300) return; // do not fight the user's drag
      x = n ? Math.min(n - 1, Math.max(0, Math.round(v))) / (n - 1) : inv(c.m, v);
      draw();
    };
  }
  c.el = col;
  controls.push(c);
  byField.set(c.f, c);
  return col;
}

// fit the faceplate to the window: zoom it, and use spare height for longer levers
function fitPanel() {
  const panel = $('panel'), face = panel.firstChild, box = $('sound');
  if (!face) return;
  face.style.zoom = 1;
  face.style.setProperty('--fh', '96px');
  const w = face.scrollWidth, h = face.scrollHeight;
  const aw = box.clientWidth - 8, ah = box.clientHeight - 8;
  let s = Math.min(1.6, aw / w, ah / h);
  const spare = ah / s - h;
  if (spare > 6) { face.style.setProperty('--fh', Math.min(190, 96 + Math.floor((spare - 6) / 3)) + 'px'); s = Math.min(1.6, aw / w, ah / face.scrollHeight); }
  face.style.zoom = s.toFixed(3);
}
window.addEventListener('resize', () => requestAnimationFrame(fitPanel));
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* CS80_UI_SELFTEST (cs80_editor_check): report what the page receives, and
   move I LPF up one wheel step through the normal event path */
const init = window.__JUCE__ && window.__JUCE__.initialisationData;
const selftest = !!(init && init.selftest && init.selftest[0]);
const log = (msg) => { if (selftest) emit({ t: 'log', msg }); };
let firstValues = true;

if (backend) {
  backend.addEventListener('cs80values', (o) => {
    for (const f in o) { values[f] = o[f]; const c = byField.get(f); if (c) c.set(o[f]); }
    if (!selftest) return;
    const c = byField.get('I.lpf_hz');
    if ('I.lpf_hz' in o) log(`received ${Object.keys(o).length} values; I LPF lever shows ${c.text()}`);
    if (firstValues) {
      firstValues = false;
      setTimeout(() => {
        c.el.querySelector('.fader').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
        log(`wheel on I LPF: lever now ${c.text()}`);
      }, 500);
    }
  });
  backend.addEventListener('cs80program', (o) => {
    $('prog').textContent = o.name || '';
    presetVals = o.values || null;
  });
}

buildPanel();
emit({ t: 'ready' });
