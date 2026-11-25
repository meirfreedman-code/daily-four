// זיהוי צורות מקווים שצוירו באצבע. פונקציות טהורות, נבדקות ב-drills-test/.
import {
  dist, pathLength, bbox, centroid, resample, smooth, segIntersect, selfIntersection, endDirection,
} from './geometry.js';

const straightness = (p) => (pathLength(p) ? dist(p[0], p[p.length - 1]) / pathLength(p) : 1);

export function isTap(raw, ms) {
  return pathLength(raw) < 30 && ms < 450;
}

// מספר "פינות" מתחלפות (שמאלה-ימינה) לאורך המסלול
export function zigzagScore(pts) {
  const p = smooth(resample(pts, 8), 1, 1);
  if (p.length < 5) return 0;
  const head = [];
  for (let i = 1; i < p.length; i++) head.push(Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]));
  let runSign = 0, run = 0, lastCorner = 0, alternations = 0, corners = 0;
  const flush = () => {
    if (Math.abs(run) >= (50 * Math.PI) / 180) {
      const s = Math.sign(run);
      if (lastCorner && s !== lastCorner) alternations++;
      lastCorner = s;
      corners++;
    }
  };
  for (let i = 1; i < head.length; i++) {
    let t = head[i] - head[i - 1];
    while (t > Math.PI) t -= 2 * Math.PI;
    while (t < -Math.PI) t += 2 * Math.PI;
    if (Math.abs(t) < (4 * Math.PI) / 180) continue;
    const s = Math.sign(t);
    if (s !== runSign) { flush(); run = 0; runSign = s; }
    run += t;
  }
  flush();
  return corners >= 3 ? alternations : Math.min(alternations, 1);
}

// פס ניצב בסוף קו שצויר באותה תנועה. מחזיר אינדקס תחילת הפס או null
export function detectScreenTail(pts) {
  const p = resample(pts, 6);
  const n = p.length;
  if (n < 10) return null;
  let best = null;
  for (let c = n - 3; c >= Math.floor(n * 0.3); c--) {
    let j = c - 1;
    while (j > 0 && dist(p[j], p[c]) < 140) j--;
    const dl = dist(p[j], p[c]);
    if (dl < 20) continue;
    const d = [(p[c][0] - p[j][0]) / dl, (p[c][1] - p[j][1]) / dl];
    const perp = [-d[1], d[0]];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = c; i < n; i++) {
      const v = [p[i][0] - p[c][0], p[i][1] - p[c][1]];
      const a = v[0] * d[0] + v[1] * d[1];
      const b = v[0] * perp[0] + v[1] * perp[1];
      a0 = Math.min(a0, a); a1 = Math.max(a1, a);
      b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const along = a1 - a0, across = b1 - b0;
    if (along > 200) break;
    if (across >= 35 && across <= 220 && along <= 0.4 * across + 12) best = { index: c, across, d };
  }
  if (!best) return null;
  // הפינה = הנקודה הרחוקה ביותר קדימה בכיוון הקו; שם נגמר גוף הקו
  const proj = [];
  for (let i = best.index; i < n; i++) {
    proj.push((p[i][0] - p[best.index][0]) * best.d[0] + (p[i][1] - p[best.index][1]) * best.d[1]);
  }
  const maxA = Math.max(...proj);
  best.index += proj.findIndex((a) => a >= maxA - 10);
  const bodyLen = pathLength(p.slice(0, best.index + 1));
  if (bodyLen < 80 || bodyLen < 1.2 * best.across) return null;
  return { body: p.slice(0, best.index + 1), barStart: best.index, barWidth: best.across };
}

// סיווג קו בודד
// מחזיר { kind: 'circle'|'x'|'line', lineType?, confidence, center?, body? }
export function classifyStroke(raw) {
  const pts = resample(raw, 6);
  if (pts.length < 3) return { kind: 'line', lineType: 'move', confidence: 0.3, body: pts };
  const L = pathLength(pts);
  const bb = bbox(pts);
  const diag = Math.hypot(bb.w, bb.h);
  const E = dist(pts[0], pts[pts.length - 1]);

  // צורה סגורה וקטנה: עיגול
  if (L > 90 && E < Math.max(45, 0.22 * L) && diag < 480) {
    const c = centroid(pts);
    const r = pts.map((q) => dist(q, c));
    const mean = r.reduce((s, v) => s + v, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length);
    const cv = sd / mean;
    const aspect = bb.w / (bb.h || 1);
    const round = aspect > 0.45 && aspect < 2.2;
    if (cv < 0.2 && round) return { kind: 'circle', confidence: 0.95, center: c };
    if (cv < 0.3 && round) return { kind: 'circle', confidence: 0.7, center: c };
    const xi = selfIntersection(pts);
    if (xi && cv >= 0.3) return { kind: 'x', confidence: 0.45, center: xi };
    return { kind: 'circle', confidence: 0.45, center: c };
  }

  // X בתנועה אחת: קטן ומצטלב בעצמו
  if (diag < 320 && L > 1.8 * diag) {
    const xi = selfIntersection(pts);
    if (xi) return { kind: 'x', confidence: 0.6, center: xi };
  }

  const scr = detectScreenTail(pts);
  const body = scr ? scr.body : pts;
  const zz = zigzagScore(body);
  let lineType = 'move';
  let confidence = 0.9;
  if (scr) {
    lineType = 'screen';
    confidence = zz >= 3 ? 0.5 : 0.85;
  } else if (zz >= 3) {
    lineType = 'dribble';
  } else if (zz === 2) {
    confidence = 0.5;
  }
  const short = L < 300 && straightness(pts) > 0.85;
  return { kind: 'line', lineType, confidence, body, short };
}

// שני קווים קצרים שחוצים זה את זה = X
export function isCrossPair(a, b) {
  const la = pathLength(a), lb = pathLength(b);
  if (la > 320 || lb > 320 || la < 25 || lb < 25) return null;
  if (straightness(a) < 0.75 || straightness(b) < 0.75) return null;
  const r = la / lb;
  if (r < 0.35 || r > 2.8) return null;
  const a0 = a[0], a1 = a[a.length - 1], b0 = b[0], b1 = b[b.length - 1];
  const ua = [(a1[0] - a0[0]) / la, (a1[1] - a0[1]) / la];
  const ub = [(b1[0] - b0[0]) / lb, (b1[1] - b0[1]) / lb];
  const cos = Math.abs(ua[0] * ub[0] + ua[1] * ub[1]) / (straightness(a) * straightness(b));
  if (cos > 0.82) return null; // כמעט מקבילים
  return segIntersect(a0, a1, b0, b1);
}

// קו קצר ניצב בקצה הקו הקודם = חסימה
export function isScreenBar(linePts, bar) {
  const lb = pathLength(bar);
  if (lb < 30 || lb > 240 || straightness(bar) < 0.75) return false;
  if (pathLength(linePts) < 80) return false;
  const end = linePts[linePts.length - 1];
  const mid = [(bar[0][0] + bar[bar.length - 1][0]) / 2, (bar[0][1] + bar[bar.length - 1][1]) / 2];
  if (dist(mid, end) > 75) return false;
  const d = endDirection(linePts, 60);
  const E = dist(bar[0], bar[bar.length - 1]) || 1;
  const u = [(bar[bar.length - 1][0] - bar[0][0]) / E, (bar[bar.length - 1][1] - bar[0][1]) / E];
  return Math.abs(d[0] * u[0] + d[1] * u[1]) < 0.5;
}

// קו קצר שממשיך את הקו הקודם אחרי רווח = עוד מקטע של קו מקווקו (מסירה)
export function isDashContinuation(prevStroke, next) {
  const lp = pathLength(prevStroke), ln = pathLength(next);
  if (lp > 420 || ln > 420 || ln < 12) return false;
  if (straightness(next) < 0.7) return false;
  const pe = prevStroke[prevStroke.length - 1];
  const gap = dist(pe, next[0]);
  if (gap < 8 || gap > 170) return false;
  const d = endDirection(prevStroke, Math.min(60, lp * 0.8));
  const ne = next[next.length - 1];
  const v = [ne[0] - pe[0], ne[1] - pe[1]];
  const vl = Math.hypot(v[0], v[1]) || 1;
  if ((v[0] * d[0] + v[1] * d[1]) / vl < 0.7) return false;
  const w = [next[0][0] - pe[0], next[0][1] - pe[1]];
  return w[0] * d[0] + w[1] * d[1] > -20;
}
