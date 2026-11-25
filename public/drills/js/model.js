// מבנה התרגיל (JSON) ופעולות עליו. השרטוט, האנימציה וההסבר נוצרים כולם מהמבנה הזה.
//
// drill = {
//   v: 1, id, name, created, updated,
//   players: [{ id, team: 'O'|'D', num: 1..5|null, x, y, raw: [[[dx,dy]...]] }],
//   phases:  [{ actions: [{ id, type: 'move'|'pass'|'dribble'|'screen', from, to, pts: [[x,y]...], raw: [[[x,y]...]] }] }]
// }
// raw של שחקן נשמר יחסית למיקומו, כך שגרירה מזיזה גם את הקשקוש.
import { dist, centroid, round } from './geometry.js';
import { classifyStroke, isCrossPair, isScreenBar, isDashContinuation } from './recognize.js';

export const DRILL_VERSION = 1;
export const MOVERS = new Set(['move', 'dribble', 'screen']);
export const TYPES = ['move', 'pass', 'dribble', 'screen'];

let counter = 0;
export const uid = (p) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newDrill(name = 'תרגיל חדש') {
  const now = Date.now();
  return { v: DRILL_VERSION, id: uid('d'), name, created: now, updated: now, players: [], phases: [{ actions: [] }] };
}

export const clone = (o) => JSON.parse(JSON.stringify(o));

export const findPlayer = (drill, id) => drill.players.find((p) => p.id === id) || null;

export function findAction(drill, id) {
  for (let i = 0; i < drill.phases.length; i++) {
    const a = drill.phases[i].actions.find((x) => x.id === id);
    if (a) return { action: a, phase: i };
  }
  return null;
}

// מיקומי השחקנים בתחילת שלב
export function positionsAt(drill, phase) {
  const pos = {};
  for (const p of drill.players) pos[p.id] = [p.x, p.y];
  for (let i = 0; i < phase && i < drill.phases.length; i++) {
    for (const a of drill.phases[i].actions) {
      if (MOVERS.has(a.type) && a.from && pos[a.from] && a.pts.length) pos[a.from] = [...a.pts[a.pts.length - 1]];
    }
  }
  return pos;
}

// מי מחזיק בכדור בתחילת כל שלב (מערך באורך phases+1)
export function ballHolders(drill) {
  let holder = null;
  outer: for (const ph of drill.phases) {
    for (const a of ph.actions) {
      if ((a.type === 'pass' || a.type === 'dribble') && a.from) { holder = a.from; break outer; }
    }
  }
  if (!holder) {
    const pg = drill.players.find((p) => p.team === 'O' && p.num === 1) || drill.players.find((p) => p.team === 'O');
    holder = pg ? pg.id : null;
  }
  const out = [holder];
  for (const ph of drill.phases) {
    for (const a of ph.actions) if (a.type === 'pass' && a.to) holder = a.to;
    out.push(holder);
  }
  return out;
}

export function nearestPlayer(drill, pos, pt, maxD, filter = () => true) {
  let best = null, bd = maxD;
  for (const p of drill.players) {
    if (!filter(p) || !pos[p.id]) continue;
    const d = dist(pos[p.id], pt);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// מקבל של מסירה / שחקן שנחסם עבורו
export function resolveTarget(drill, phase, action) {
  if (action.type !== 'pass' && action.type !== 'screen') return null;
  const end = action.pts[action.pts.length - 1];
  const start = positionsAt(drill, phase);
  const after = positionsAt(drill, phase + 1);
  const filter = (p) => p.id !== action.from && p.team === 'O';
  const r = action.type === 'pass' ? 200 : 230;
  const a = nearestPlayer(drill, start, end, r, filter);
  const b = action.type === 'pass' ? nearestPlayer(drill, after, end, r, filter) : null;
  if (a && b && a !== b) return dist(after[b.id], end) < dist(start[a.id], end) ? b.id : a.id;
  return (b || a)?.id || null;
}

export function nextFreeNumber(drill, team) {
  const used = new Set(drill.players.filter((p) => p.team === team).map((p) => p.num));
  for (let n = 1; n <= 5; n++) if (!used.has(n)) return n;
  return null;
}

function addPlayer(drill, team, center, strokes) {
  const c = round([center])[0];
  const p = {
    id: uid('p'), team, num: team === 'O' ? nextFreeNumber(drill, 'O') : null, x: c[0], y: c[1],
    raw: strokes.map((s) => round(s.map((q) => [q[0] - c[0], q[1] - c[1]]))),
  };
  if (team === 'D') {
    // מגן מקבל את מספר שחקן ההתקפה הקרוב אליו (אפשר לשנות בהקשה)
    const near = nearestPlayer(drill, positionsAt(drill, 0), c, 400, (q) => q.team === 'O' && q.num);
    const taken = new Set(drill.players.filter((q) => q.team === 'D').map((q) => q.num));
    p.num = near && !taken.has(near.num) ? near.num : nextFreeNumber(drill, 'D');
  }
  drill.players.push(p);
  return p;
}

function addAction(drill, phase, type, strokes, body) {
  const pos = positionsAt(drill, phase);
  const allPts = strokes.flat();
  const pts = round(body || allPts);
  const fromP = nearestPlayer(drill, pos, pts[0], 170);
  const a = { id: uid('a'), type, from: fromP ? fromP.id : null, to: null, pts, raw: strokes.map(round) };
  a.to = resolveTarget(drill, phase, a);
  drill.phases[phase].actions.push(a);
  return a;
}

export function removeItem(drill, ref) {
  if (ref.kind === 'player') {
    drill.players = drill.players.filter((p) => p.id !== ref.id);
    for (const ph of drill.phases) {
      for (const a of ph.actions) {
        if (a.from === ref.id) a.from = null;
        if (a.to === ref.id) a.to = null;
      }
    }
  } else {
    for (const ph of drill.phases) ph.actions = ph.actions.filter((a) => a.id !== ref.id);
  }
}

// מצב "הקו האחרון" נשמר מחוץ ל-drill כדי לחבר מקטעים (מקווקו, X בשני קווים, פס חסימה)
// last = { ref, strokes, time, short }
// מחזיר { ref, uncertain, last } — ref הוא הפריט שנוצר/השתנה
export function ingestStroke(drill, phase, raw, now, last) {
  const recent = last && now - last.time < 3000 ? last : null;
  const prev = recent ? (recent.ref.kind === 'action' ? findAction(drill, recent.ref.id) : null) : null;
  const prevStroke = recent ? recent.strokes[recent.strokes.length - 1] : null;

  if (prev && prev.phase === phase) {
    const a = prev.action;
    // 1. X משני קווים
    if (recent.strokes.length === 1 && recent.short) {
      const xi = isCrossPair(prevStroke, raw);
      if (xi) {
        removeItem(drill, recent.ref);
        const p = addPlayer(drill, 'D', xi, [prevStroke, raw]);
        return { ref: { kind: 'player', id: p.id }, uncertain: false, last: null, created: 'player' };
      }
    }
    // 2. פס חסימה כקו נפרד
    if (a.type !== 'pass' && isScreenBar(a.pts, raw)) {
      a.type = 'screen';
      a.raw.push(round(raw));
      a.to = resolveTarget(drill, phase, a);
      return { ref: recent.ref, uncertain: false, last: null };
    }
    // 3. עוד מקטע של קו מקווקו
    if ((a.type === 'move' || a.type === 'pass') && isDashContinuation(prevStroke, raw)) {
      a.type = 'pass';
      a.raw.push(round(raw));
      a.pts = round(a.raw.flat());
      a.to = resolveTarget(drill, phase, a);
      return { ref: recent.ref, uncertain: false, last: { ...recent, strokes: [...recent.strokes, raw], time: now, short: false } };
    }
  }

  const c = classifyStroke(raw);
  const uncertain = c.confidence < 0.6;
  if (c.kind === 'circle' || c.kind === 'x') {
    const p = addPlayer(drill, c.kind === 'circle' ? 'O' : 'D', c.center, [raw]);
    return { ref: { kind: 'player', id: p.id }, uncertain, last: null, created: 'player' };
  }
  const a = addAction(drill, phase, c.lineType, [raw], c.lineType === 'screen' ? c.body : null);
  return { ref: { kind: 'action', id: a.id }, uncertain, last: { ref: { kind: 'action', id: a.id }, strokes: [raw], time: now, short: !!c.short } };
}

// שינוי סוג של פריט (גם בין שחקן לקו)
export function convertItem(drill, phase, ref, kind) {
  if (ref.kind === 'player') {
    const p = findPlayer(drill, ref.id);
    if (!p) return ref;
    if (kind === 'O' || kind === 'D') {
      if (p.team !== kind) { p.team = kind; p.num = nextFreeNumber(drill, kind); }
      return ref;
    }
    const strokes = p.raw.map((s) => s.map(([dx, dy]) => [p.x + dx, p.y + dy]));
    removeItem(drill, ref);
    const a = addAction(drill, phase, kind, strokes, null);
    return { kind: 'action', id: a.id };
  }
  const f = findAction(drill, ref.id);
  if (!f) return ref;
  if (kind === 'O' || kind === 'D') {
    const strokes = f.action.raw;
    removeItem(drill, ref);
    const p = addPlayer(drill, kind, centroid(strokes.flat()), strokes);
    return { kind: 'player', id: p.id };
  }
  // מסירה מורכבת מכמה מקטעים: במעבר ממנה או אליה בונים את המסלול מכל המקטעים
  const wasPass = f.action.type === 'pass';
  f.action.type = kind;
  if (wasPass) f.action.pts = round(f.action.raw.flat());
  f.action.to = resolveTarget(drill, f.phase, f.action);
  return ref;
}

// גרירת שחקן בשלב מסוים: משנה את נקודת הסיום של התנועה הקודמת שלו, או את מיקום הפתיחה
export function movePlayer(drill, phase, id, pt) {
  const p = findPlayer(drill, id);
  if (!p) return;
  const q = round([pt])[0];
  for (let i = phase - 1; i >= 0; i--) {
    const acts = drill.phases[i].actions.filter((a) => a.from === id && MOVERS.has(a.type));
    if (acts.length) {
      const a = acts[acts.length - 1];
      a.pts[a.pts.length - 1] = q;
      if (a.pts.length === 1) a.pts.unshift(q);
      return;
    }
  }
  p.x = q[0]; p.y = q[1];
}

export function relinkAll(drill) {
  drill.phases.forEach((ph, i) => ph.actions.forEach((a) => { a.to = resolveTarget(drill, i, a); }));
}

export function playerLabel(p) {
  if (!p) return 'שחקן';
  if (p.team === 'D') return p.num ? `מגן ${p.num}` : 'מגן';
  return p.num ? String(p.num) : 'שחקן';
}
