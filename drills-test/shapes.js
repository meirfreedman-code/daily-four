// יצירת קווים סינתטיים שמדמים ציור באצבע (עם רעש קטן ודטרמיניסטי)
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
export const jitter = (p, a = 3) => p.map(([x, y]) => [x + rnd() * a, y + rnd() * a]);

export function line(a, b, n = 30) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * (i / n), a[1] + (b[1] - a[1]) * (i / n)]);
  return out;
}

export function circle(c, r, turns = 1.05, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * turns * 2 * Math.PI - Math.PI / 2;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return out;
}

export function zigzag(a, b, amp = 35, waves = 5) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = [-d[1], d[0]];
  const pts = [a];
  for (let i = 1; i < waves * 2; i++) {
    const t = i / (waves * 2);
    const s = i % 2 ? amp : -amp;
    pts.push([a[0] + d[0] * L * t + n[0] * s, a[1] + d[1] * L * t + n[1] * s]);
  }
  pts.push(b);
  const out = [];
  for (let i = 1; i < pts.length; i++) out.push(...line(pts[i - 1], pts[i], 6).slice(i > 1 ? 1 : 0));
  return out;
}

export const concat = (...parts) => parts.reduce((acc, p) => acc.concat(acc.length ? p.slice(1) : p), []);
