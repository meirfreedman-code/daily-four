// שמירה בטלפון עצמו (localStorage). כל תרגיל במפתח משלו, ורשימה מרוכזת לתצוגה.
import { DRILL_VERSION } from './model.js';

const KEY = 'drills:v1:';
const LAST = 'drills:last';

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

export function listDrills() {
  return safe(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(KEY)) continue;
      const d = JSON.parse(localStorage.getItem(k));
      if (d && d.id) out.push(d);
    }
    return out.sort((a, b) => b.updated - a.updated);
  }, []);
}

export function loadDrill(id) {
  return safe(() => JSON.parse(localStorage.getItem(KEY + id)), null);
}

export function saveDrill(d) {
  d.updated = Date.now();
  return safe(() => {
    localStorage.setItem(KEY + d.id, JSON.stringify(d));
    localStorage.setItem(LAST, d.id);
    return true;
  }, false);
}

export function deleteDrill(id) {
  safe(() => localStorage.removeItem(KEY + id));
}

export const lastDrillId = () => safe(() => localStorage.getItem(LAST), null);

export function getFlag(name) { return safe(() => localStorage.getItem('drills:flag:' + name), null); }
export function setFlag(name, v) { safe(() => localStorage.setItem('drills:flag:' + name, v)); }

// בדיקה בסיסית לקובץ תרגיל שמייבאים
export function validateDrill(d) {
  if (!d || typeof d !== 'object') return false;
  if (d.v !== DRILL_VERSION || !Array.isArray(d.players) || !Array.isArray(d.phases) || !d.phases.length) return false;
  const pt = (q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite);
  for (const p of d.players) {
    if (!p.id || (p.team !== 'O' && p.team !== 'D') || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (!Array.isArray(p.raw)) p.raw = [];
  }
  for (const ph of d.phases) {
    if (!Array.isArray(ph.actions)) return false;
    for (const a of ph.actions) {
      if (!['move', 'pass', 'dribble', 'screen'].includes(a.type) || !Array.isArray(a.pts) || !a.pts.length || !a.pts.every(pt)) return false;
      if (!Array.isArray(a.raw)) a.raw = [a.pts];
    }
  }
  return true;
}
