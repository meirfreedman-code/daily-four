// הממשק: ציור, שלבים, ביטול, עריכה, אנימציה, שמירה וייצוא.
import { dist, distToPath } from './geometry.js';
import { isTap } from './recognize.js';
import {
  newDrill, clone, ingestStroke, convertItem, removeItem, movePlayer, relinkAll, positionsAt,
  findPlayer, findAction, nextFreeNumber,
} from './model.js';
import { drawCourt, drawDrill, fitTransform, VIEW, actionPath } from './render.js';
import { explain, explainText } from './explain.js';
import { frameAt, totalDuration } from './animate.js';
import { listDrills, loadDrill, saveDrill, deleteDrill, lastDrillId, getFlag, setFlag, validateDrill } from './storage.js';
import { exportImage, exportJson, exportVideo, videoSupport, shareOrDownload } from './export.js';

const $ = (id) => document.getElementById(id);
const canvas = $('court');
const ctx = canvas.getContext('2d');

const TYPE_NAMES = { move: 'תנועה', pass: 'מסירה', dribble: 'כדרור', screen: 'חסימה', O: 'שחקן התקפה', D: 'מגן' };

const S = {
  drill: null, phase: 0, view: 'sketch', tool: 'draw', sel: null,
  hist: [], fut: [], last: null, stroke: null, drag: null, play: null, sheetOnClose: null,
};

// ---------- היסטוריה ושמירה ----------
function snapshot() {
  S.hist.push(JSON.stringify({ d: S.drill, p: S.phase }));
  if (S.hist.length > 150) S.hist.shift();
  S.fut = [];
}
function hasContent(d) {
  return d.players.length > 0 || d.phases.some((p) => p.actions.length) || d.name !== 'תרגיל חדש';
}
function commit() {
  if (hasContent(S.drill)) saveDrill(S.drill);
  refresh();
}
function restore(json) {
  const o = JSON.parse(json);
  S.drill = o.d;
  S.phase = Math.min(o.p, S.drill.phases.length - 1);
  S.last = null;
  S.sel = null;
  closeSheet(false);
  commit();
}
function undo() {
  if (!S.hist.length) return;
  S.fut.push(JSON.stringify({ d: S.drill, p: S.phase }));
  restore(S.hist.pop());
}
function redo() {
  if (!S.fut.length) return;
  S.hist.push(JSON.stringify({ d: S.drill, p: S.phase }));
  restore(S.fut.pop());
}

function openDrill(d) {
  stopPlay();
  S.drill = d;
  S.phase = 0;
  S.hist = []; S.fut = []; S.last = null; S.sel = null;
  S.view = d.players.length ? 'clean' : 'sketch';
  closeSheet(false);
  $('name').value = d.name;
  refresh();
}

// ---------- קנבס ----------
let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = canvas.clientWidth;
  const h = Math.round((w * VIEW.h) / VIEW.w);
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  redraw();
}

let frameQueued = false;
function redraw() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => { frameQueued = false; paint(); });
}

function paint() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  fitTransform(ctx, 0, 0, canvas.width, canvas.height);
  drawCourt(ctx);
  if (S.play) {
    const f = S.play.frame;
    drawDrill(ctx, S.drill, { mode: 'clean', phase: f.phase, anim: { pos: f.pos, ball: f.ball, lineAlpha: 0.3 } });
    return;
  }
  drawDrill(ctx, S.drill, { mode: S.view, phase: S.phase, selected: S.sel, live: S.stroke ? S.stroke.pts : null });
}

function toCourt(e) {
  const r = canvas.getBoundingClientRect();
  const m = ctx.getTransform().inverse();
  const p = m.transformPoint(new DOMPoint((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr));
  return [p.x, p.y];
}

function hitTest(pt) {
  const pos = positionsAt(S.drill, S.phase);
  let best = null, bd = 80;
  for (const p of S.drill.players) {
    const d = dist(pos[p.id], pt);
    if (d < bd) { bd = d; best = { kind: 'player', id: p.id }; }
  }
  if (best) return best;
  const after = positionsAt(S.drill, S.phase + 1);
  bd = 55;
  for (const a of S.drill.phases[S.phase].actions) {
    const d = S.view === 'sketch'
      ? Math.min(...a.raw.map((s) => distToPath(pt, s)))
      : distToPath(pt, actionPath(S.drill, S.phase, a, pos, after));
    if (d < bd) { bd = d; best = { kind: 'action', id: a.id }; }
  }
  return best;
}

canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || S.play) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const pt = toCourt(e);
  if (S.tool === 'edit') {
    const hit = hitTest(pt);
    if (hit && hit.kind === 'player') {
      S.drag = { id: hit.id, start: pt, t: performance.now(), moved: false };
      return;
    }
  }
  S.stroke = { pts: [pt], t: performance.now() };
});

canvas.addEventListener('pointermove', (e) => {
  if (!e.isPrimary) return;
  if (S.drag) {
    const pt = toCourt(e);
    if (!S.drag.moved && dist(pt, S.drag.start) < 14) return;
    if (!S.drag.moved) { snapshot(); S.drag.moved = true; closeSheet(false); }
    movePlayer(S.drill, S.phase, S.drag.id, pt);
    S.sel = { kind: 'player', id: S.drag.id };
    redraw();
    return;
  }
  if (!S.stroke) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs.length ? evs : [e]) {
    const pt = toCourt(ev);
    if (dist(pt, S.stroke.pts[S.stroke.pts.length - 1]) > 2) S.stroke.pts.push(pt);
  }
  redraw();
});

function endPointer(e, cancelled) {
  if (!e.isPrimary) return;
  if (S.drag) {
    const d = S.drag;
    S.drag = null;
    if (!d.moved) { if (!cancelled) openPlayerSheet(d.id); return; }
    relinkAll(S.drill);
    S.sel = null;
    commit();
    return;
  }
  if (!S.stroke) return;
  const st = S.stroke;
  S.stroke = null;
  if (cancelled) { redraw(); return; }
  const ms = performance.now() - st.t;
  if (isTap(st.pts, ms)) { handleTap(st.pts[0]); return; }
  closeSheet(true);
  snapshot();
  const r = ingestStroke(S.drill, S.phase, st.pts, Date.now(), S.last);
  S.last = r.last;
  afterIngest(r);
}
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));

function afterIngest(r) {
  commit();
  if (r.uncertain) {
    openKindSheet(r.ref, 'לא בטוח מה ציירת. מה זה?');
    return;
  }
  if (r.created === 'player') {
    openPlayerSheet(r.ref.id, true);
    return;
  }
  const f = r.ref.kind === 'action' ? findAction(S.drill, r.ref.id) : null;
  if (f) toast(TYPE_NAMES[f.action.type] + (f.action.from ? '' : ' (לא מחובר לשחקן)'));
}

function handleTap(pt) {
  const hit = hitTest(pt);
  if (!hit) { closeSheet(true); return; }
  if (hit.kind === 'player') openPlayerSheet(hit.id);
  else openKindSheet(hit, 'סוג הקו');
}

// ---------- גיליונות בחירה ----------
const sheet = $('sheet');
function closeSheet(applyDefault) {
  if (sheet.hidden) return;
  sheet.hidden = true;
  sheet.innerHTML = '';
  $('toolbar').hidden = !!S.play;
  const cb = S.sheetOnClose;
  S.sheetOnClose = null;
  if (cb && applyDefault) cb();
  S.sel = null;
  redraw();
}

function showSheet(title, rows, sel) {
  sheet.innerHTML = '';
  S.sheetOnClose = null;
  if (title) {
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = title;
    sheet.appendChild(t);
  }
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'row';
    for (const b of row) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.cls) el.className = b.cls;
      if (b.aria) el.setAttribute('aria-label', b.aria);
      el.addEventListener('click', b.onClick);
      r.appendChild(el);
    }
    sheet.appendChild(r);
  }
  sheet.hidden = false;
  $('toolbar').hidden = true;
  S.sel = sel || null;
  redraw();
}

function setNumber(p, n) {
  const other = S.drill.players.find((q) => q !== p && q.team === p.team && q.num === n);
  if (other) other.num = p.num;
  p.num = n;
}

function openPlayerSheet(id, fresh = false) {
  const p = findPlayer(S.drill, id);
  if (!p) return;
  const nums = [1, 2, 3, 4, 5].map((n) => ({
    label: String(n), cls: 'num' + (p.num === n ? ' on' : ''),
    onClick: () => { snapshot(); setNumber(p, n); S.sheetOnClose = null; closeSheet(false); commit(); },
  }));
  const other = p.team === 'O' ? 'D' : 'O';
  showSheet(fresh ? `${TYPE_NAMES[p.team]} — בחר מספר` : TYPE_NAMES[p.team], [nums, [
    { label: other === 'D' ? '✕ זה מגן' : '◯ זה שחקן התקפה', onClick: () => { snapshot(); convertItem(S.drill, S.phase, { kind: 'player', id }, other); closeSheet(false); commit(); openPlayerSheet(id); } },
    { label: '〰 זה קו', onClick: () => openKindSheet({ kind: 'player', id }, 'איזה קו?') },
    { label: '🗑 מחק', cls: 'danger', onClick: () => { snapshot(); removeItem(S.drill, { kind: 'player', id }); closeSheet(false); commit(); } },
    { label: '✓', aria: 'סיום', onClick: () => closeSheet(false) },
  ]], { kind: 'player', id });
}

function openKindSheet(ref, title) {
  let cur = null;
  if (ref.kind === 'player') cur = findPlayer(S.drill, ref.id)?.team;
  else cur = findAction(S.drill, ref.id)?.action.type;
  const choose = (k) => () => {
    if (k === cur) { closeSheet(false); return; }
    snapshot();
    const nr = convertItem(S.drill, S.phase, ref, k);
    S.last = null;
    closeSheet(false);
    commit();
    if (nr.kind === 'player') openPlayerSheet(nr.id, true);
    else toast(TYPE_NAMES[k]);
  };
  const b = (k, icon) => ({ label: `${icon} ${TYPE_NAMES[k]}`, cls: cur === k ? 'on' : '', onClick: choose(k) });
  showSheet(title, [
    [b('move', '—'), b('pass', '┅'), b('dribble', '〰'), b('screen', '⊥')],
    [b('O', '◯'), b('D', '✕'),
      { label: '🗑 מחק', cls: 'danger', onClick: () => { snapshot(); removeItem(S.drill, ref); S.last = null; closeSheet(false); commit(); } },
      { label: '✓', aria: 'סיום', onClick: () => closeSheet(false) }],
  ], ref);
}

function openPhaseSheet() {
  const n = S.drill.phases.length;
  const rows = [[
    { label: `🗑 מחק את שלב ${S.phase + 1}`, cls: 'danger', onClick: () => {
      snapshot();
      if (n === 1) S.drill.phases[0].actions = [];
      else { S.drill.phases.splice(S.phase, 1); S.phase = Math.max(0, S.phase - 1); }
      relinkAll(S.drill);
      closeSheet(false); commit();
    } },
    { label: 'ביטול', onClick: () => closeSheet(false) },
  ]];
  showSheet(`שלב ${S.phase + 1}`, rows);
}

function openExportSheet() {
  const vs = videoSupport();
  showSheet('ייצוא ושיתוף', [
    [
      { label: '🖼 תמונה', onClick: async () => { closeSheet(false); toast('מכין תמונה…'); await exportImage(S.drill); } },
      { label: vs ? '🎬 וידאו' : '🎬 וידאו (לא נתמך)', onClick: vs ? recordVideo : () => toast('הדפדפן הזה לא תומך בהקלטת וידאו') },
      { label: '📝 טקסט', onClick: shareText },
    ],
    [
      { label: '💾 קובץ תרגיל', onClick: async () => { closeSheet(false); await exportJson(S.drill); } },
      { label: 'סגור', onClick: () => closeSheet(false) },
    ],
  ]);
}

async function shareText() {
  closeSheet(false);
  const text = `${S.drill.name}\n${explainText(S.drill)}`;
  try {
    if (navigator.share) { await navigator.share({ title: S.drill.name, text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('ההסבר הועתק'); } catch { toast('לא הצלחתי להעתיק'); }
}

async function recordVideo() {
  closeSheet(false);
  stopPlay();
  try {
    toast('מקליט… 0%', 60000);
    const { blob, filename } = await exportVideo(S.drill, (f) => toast(`מקליט… ${Math.round(f * 100)}%`, 60000));
    toast('הווידאו מוכן');
    await shareOrDownload(blob, filename, S.drill.name);
  } catch {
    toast('הקלטת הווידאו נכשלה');
  }
}

// ---------- אנימציה ----------
function startPlay() {
  closeSheet(true);
  const total = totalDuration(S.drill);
  S.play = { t0: performance.now(), paused: false, at: 0, total, frame: frameAt(S.drill, 0) };
  $('toolbar').hidden = true;
  $('playbar').hidden = false;
  $('btnPause').textContent = '⏸ עצור';
  tick();
}
function tick() {
  const P = S.play;
  if (!P || P.paused) return;
  P.at = Math.min(P.total, performance.now() - P.t0);
  P.frame = frameAt(S.drill, P.at);
  $('playInfo').textContent = `שלב ${P.frame.phase + 1} מתוך ${S.drill.phases.length}`;
  highlightExplain(P.frame.phase);
  paint();
  if (P.at >= P.total) {
    P.paused = true;
    $('btnPause').textContent = '▶ שוב';
    return;
  }
  P.raf = requestAnimationFrame(tick);
}
function togglePause() {
  const P = S.play;
  if (!P) return;
  if (!P.paused) { P.paused = true; cancelAnimationFrame(P.raf); $('btnPause').textContent = '▶ המשך'; return; }
  if (P.at >= P.total) P.at = 0;
  P.paused = false;
  P.t0 = performance.now() - P.at;
  $('btnPause').textContent = '⏸ עצור';
  tick();
}
function restartPlay() {
  if (!S.play) return;
  cancelAnimationFrame(S.play.raf);
  S.play.at = 0; S.play.paused = false; S.play.t0 = performance.now();
  $('btnPause').textContent = '⏸ עצור';
  tick();
}
function stopPlay() {
  if (!S.play) return;
  cancelAnimationFrame(S.play.raf);
  S.play = null;
  $('playbar').hidden = true;
  $('toolbar').hidden = false;
  refresh();
}

// ---------- ממשק ----------
let toastTimer = null;
function toast(msg, ms = 1400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function renderPhases() {
  const nav = $('phases');
  nav.innerHTML = '';
  S.drill.phases.forEach((ph, i) => {
    const b = document.createElement('button');
    b.textContent = `שלב ${i + 1}`;
    if (i === S.phase) b.className = 'on';
    b.addEventListener('click', () => {
      if (S.play) return;
      if (i === S.phase) { openPhaseSheet(); return; }
      S.phase = i; S.last = null; closeSheet(false); refresh();
    });
    nav.appendChild(b);
  });
  const add = document.createElement('button');
  add.className = 'add';
  add.textContent = '＋ שלב הבא';
  add.addEventListener('click', () => {
    if (S.play) return;
    closeSheet(true);
    const lastPh = S.drill.phases[S.drill.phases.length - 1];
    if (lastPh.actions.length) {
      snapshot();
      S.drill.phases.push({ actions: [] });
    }
    S.phase = S.drill.phases.length - 1;
    S.last = null;
    commit();
    toast(`שלב ${S.phase + 1}: השחקנים במקום שבו סיימו`);
    add.scrollIntoView({ inline: 'end', block: 'nearest' });
  });
  nav.appendChild(add);
  nav.querySelector('.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function renderExplain() {
  const el = $('explain');
  const e = explain(S.drill);
  el.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = 'הסבר';
  el.appendChild(h);
  if (!e.setup && !e.phases.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'ציירו עיגול לשחקן התקפה, X למגן, וקווים לפעולות. ההסבר ייבנה כאן מעצמו.';
    el.appendChild(p);
    return;
  }
  if (e.setup) {
    const p = document.createElement('p');
    p.textContent = e.setup;
    el.appendChild(p);
  }
  const ol = document.createElement('ol');
  e.phases.forEach((ph, i) => {
    const li = document.createElement('li');
    li.dataset.phase = String(i);
    const b = document.createElement('b');
    b.textContent = ph.title + ':';
    li.appendChild(b);
    li.appendChild(document.createTextNode(' ' + (ph.sentences.join(' ') || '—')));
    ol.appendChild(li);
  });
  el.appendChild(ol);
  highlightExplain(S.phase);
}

function highlightExplain(phase) {
  for (const li of $('explain').querySelectorAll('li')) li.classList.toggle('on', li.dataset.phase === String(phase));
}

function refresh() {
  $('btnUndo').disabled = !S.hist.length;
  $('btnRedo').disabled = !S.fut.length;
  $('btnView').textContent = S.view === 'sketch' ? '✨ נקה' : '✏️ קשקוש';
  $('toolDraw').classList.toggle('on', S.tool === 'draw');
  $('toolEdit').classList.toggle('on', S.tool === 'edit');
  renderPhases();
  renderExplain();
  redraw();
}

// ---------- רשימת תרגילים ----------
function renderList() {
  const ul = $('listItems');
  ul.innerHTML = '';
  const all = listDrills();
  if (!all.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'עוד אין תרגילים שמורים.';
    ul.appendChild(li);
  }
  for (const d of all) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open';
    open.textContent = d.name || 'ללא שם';
    const small = document.createElement('small');
    const date = new Date(d.updated).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
    small.textContent = `${d.phases.length} שלבים · עודכן ${date}`;
    open.appendChild(small);
    open.addEventListener('click', () => { openDrill(loadDrill(d.id) || d); $('list').hidden = true; });
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.setAttribute('aria-label', `מחק את ${d.name}`);
    del.addEventListener('click', () => {
      if (!confirm(`למחוק את "${d.name}"?`)) return;
      deleteDrill(d.id);
      if (S.drill.id === d.id) openDrill(newDrill());
      renderList();
    });
    li.append(open, del);
    ul.appendChild(li);
  }
}

$('btnList').addEventListener('click', () => { stopPlay(); closeSheet(true); renderList(); $('list').hidden = false; });
$('btnListClose').addEventListener('click', () => { $('list').hidden = true; });
$('btnNew').addEventListener('click', () => { openDrill(newDrill()); $('list').hidden = true; });
$('btnImport').addEventListener('click', () => $('fileImport').click());
$('fileImport').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!validateDrill(d)) throw new Error('bad');
    if (loadDrill(d.id) && !confirm('תרגיל עם אותו מזהה כבר קיים. להחליף אותו?')) d.id = newDrill().id;
    saveDrill(d);
    openDrill(d);
    $('list').hidden = true;
    toast('התרגיל יובא');
  } catch {
    toast('הקובץ אינו קובץ תרגיל תקין');
  }
});

// ---------- כפתורים ----------
$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
$('toolDraw').addEventListener('click', () => { S.tool = 'draw'; refresh(); });
$('toolEdit').addEventListener('click', () => { S.tool = 'edit'; refresh(); toast('גוררים שחקן כדי להזיז אותו'); });
$('btnView').addEventListener('click', () => {
  closeSheet(true);
  S.view = S.view === 'sketch' ? 'clean' : 'sketch';
  refresh();
});
$('btnPlay').addEventListener('click', () => {
  const any = S.drill.phases.some((p) => p.actions.length);
  if (!any) { toast('אין עדיין תנועות להציג'); return; }
  startPlay();
});
$('btnPause').addEventListener('click', togglePause);
$('btnRestart').addEventListener('click', restartPlay);
$('btnStop').addEventListener('click', stopPlay);
$('btnExport').addEventListener('click', () => {
  if (!sheet.hidden) { closeSheet(true); return; }
  openExportSheet();
});
$('btnHelp').addEventListener('click', () => $('help').showModal());
$('name').addEventListener('change', (e) => {
  snapshot();
  S.drill.name = e.target.value.trim() || 'תרגיל ללא שם';
  e.target.value = S.drill.name;
  commit();
});
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

window.addEventListener('resize', resize);
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
});

// ---------- הפעלה ----------
const lastId = lastDrillId();
openDrill((lastId && loadDrill(lastId)) || newDrill());
resize();
if (!getFlag('helpSeen')) { setFlag('helpSeen', '1'); $('help').showModal(); }

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// לבדיקות ידניות מהקונסול
window.__drills = { S, nextFreeNumber, clone };
