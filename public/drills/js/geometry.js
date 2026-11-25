// גאומטריה בסיסית. כל הקואורדינטות ביחידות מגרש: 1 יחידה = 1 ס"מ.
// חצי מגרש FIBA: רוחב 1500, אורך 1400. קו הבסיס למעלה (y=0), הסל ב-(750, 157.5).

export const COURT = { W: 1500, H: 1400, BX: 750, BY: 157.5 };

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pathLength(p) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += dist(p[i - 1], p[i]);
  return L;
}

export function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function centroid(p) {
  let sx = 0, sy = 0;
  for (const [x, y] of p) { sx += x; sy += y; }
  return [sx / p.length, sy / p.length];
}

// דגימה מחדש במרווחים שווים לאורך המסלול
export function resample(p, step) {
  if (p.length < 2) return p.map((q) => [q[0], q[1]]);
  const out = [[p[0][0], p[0][1]]];
  let acc = 0;
  let prev = p[0];
  for (let i = 1; i < p.length; i++) {
    let cur = p[i];
    let d = dist(prev, cur);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  const last = p[p.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.3) out.push([last[0], last[1]]);
  return out;
}

// החלקה בממוצע נע, הקצוות נשמרים
export function smooth(p, win = 2, passes = 2) {
  let cur = p;
  for (let k = 0; k < passes; k++) {
    const n = cur.length;
    const out = cur.map((q) => [q[0], q[1]]);
    for (let i = 1; i < n - 1; i++) {
      const w = Math.min(win, i, n - 1 - i);
      let sx = 0, sy = 0;
      for (let j = i - w; j <= i + w; j++) { sx += cur[j][0]; sy += cur[j][1]; }
      out[i] = [sx / (2 * w + 1), sy / (2 * w + 1)];
    }
    cur = out;
  }
  return cur;
}

export function distToSegment(q, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}

export function distToPath(q, p) {
  if (p.length === 1) return dist(q, p[0]);
  let m = Infinity;
  for (let i = 1; i < p.length; i++) m = Math.min(m, distToSegment(q, p[i - 1], p[i]));
  return m;
}

// חיתוך שני קטעים: מחזיר נקודה או null
export function segIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

// חיתוך עצמי של מסלול (מתעלם מקטעים סמוכים)
export function selfIntersection(p) {
  for (let i = 1; i < p.length; i++) {
    for (let j = i + 2; j < p.length; j++) {
      const q = segIntersect(p[i - 1], p[i], p[j - 1], p[j]);
      if (q) return q;
    }
  }
  return null;
}

// נקודה לאורך המסלול לפי שבר מהאורך (0..1)
export function pointAt(p, f) {
  if (p.length === 1) return [p[0][0], p[0][1]];
  const L = pathLength(p);
  let target = Math.max(0, Math.min(1, f)) * L;
  for (let i = 1; i < p.length; i++) {
    const d = dist(p[i - 1], p[i]);
    if (target <= d || i === p.length - 1) {
      const t = d ? Math.min(1, target / d) : 0;
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
    }
    target -= d;
  }
  return [...p[p.length - 1]];
}

// כיוון בסוף המסלול (וקטור יחידה), מחושב על פני מרחק נתון
export function endDirection(p, back = 60) {
  const e = p[p.length - 1];
  for (let i = p.length - 2; i >= 0; i--) {
    if (dist(p[i], e) >= back || i === 0) {
      const d = dist(p[i], e) || 1;
      return [(e[0] - p[i][0]) / d, (e[1] - p[i][1]) / d];
    }
  }
  return [1, 0];
}

// עיוות מסלול כך שיתחיל ב-newStart ויסתיים ב-newEnd (משקל ליניארי לאורך המסלול)
export function warp(p, newStart, newEnd) {
  if (!p.length) return p;
  const s = p[0], e = p[p.length - 1];
  const ds = newStart ? [newStart[0] - s[0], newStart[1] - s[1]] : [0, 0];
  const de = newEnd ? [newEnd[0] - e[0], newEnd[1] - e[1]] : [0, 0];
  if (!ds[0] && !ds[1] && !de[0] && !de[1]) return p;
  const L = pathLength(p) || 1;
  let acc = 0;
  return p.map((q, i) => {
    if (i > 0) acc += dist(p[i - 1], q);
    const t = acc / L;
    return [q[0] + ds[0] * (1 - t) + de[0] * t, q[1] + ds[1] * (1 - t) + de[1] * t];
  });
}

// קיצוץ המסלול בתחילתו ובסופו (ביחידות אורך)
export function trimPath(p, a, b) {
  const L = pathLength(p);
  if (L <= a + b + 5) return p;
  const out = [];
  let acc = 0;
  out.push(pointAt(p, a / L));
  for (let i = 1; i < p.length; i++) {
    acc += dist(p[i - 1], p[i]);
    if (acc > a && acc < L - b) out.push(p[i]);
  }
  out.push(pointAt(p, (L - b) / L));
  return out;
}

// פישוט Ramer–Douglas–Peucker
export function simplify(p, eps) {
  if (p.length < 3) return p;
  let idx = 0, max = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = distToSegment(p[i], p[0], p[p.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [p[0], p[p.length - 1]];
  const a = simplify(p.slice(0, idx + 1), eps);
  const b = simplify(p.slice(idx), eps);
  return a.slice(0, -1).concat(b);
}

// מסלול נקי: ישר אם כמעט ישר, אחרת מוחלק
export function cleanPath(p) {
  if (p.length < 2) return p;
  const L = pathLength(p);
  const s = p[0], e = p[p.length - 1];
  let maxDev = 0;
  for (const q of p) maxDev = Math.max(maxDev, distToSegment(q, s, e));
  if (maxDev < Math.max(12, L * 0.07)) return [s, e];
  const r = smooth(resample(p, 12), 3, 3);
  return simplify(r, 2.5);
}

export const round = (p) => p.map(([x, y]) => [Math.round(x), Math.round(y)]);
