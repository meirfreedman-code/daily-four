// אנימציה: השחקנים זזים לפי השלבים, הכדור עובר במסירות.
import { pointAt } from './geometry.js';
import { positionsAt, ballHolders, MOVERS } from './model.js';
import { actionPath } from './render.js';

export const TIMING = { lead: 600, phase: 1900, gap: 450, tail: 900 };
const MOVE_END = 0.62, PASS_START = 0.58;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function playablePhases(drill) {
  let n = drill.phases.length;
  while (n > 1 && !drill.phases[n - 1].actions.length) n--;
  return n;
}

export function totalDuration(drill) {
  const n = playablePhases(drill);
  return TIMING.lead + n * TIMING.phase + (n - 1) * TIMING.gap + TIMING.tail;
}

// מצב האנימציה בזמן t (אלפיות שנייה)
export function frameAt(drill, t) {
  const n = playablePhases(drill);
  const holders = ballHolders(drill);
  let rest = t - TIMING.lead;
  let phase = 0, u = 0;
  if (rest > 0) {
    const slot = TIMING.phase + TIMING.gap;
    phase = Math.min(n - 1, Math.floor(rest / slot));
    u = clamp((rest - phase * slot) / TIMING.phase);
  }
  const pos = positionsAt(drill, phase);
  const after = positionsAt(drill, phase + 1);
  const m = ease(clamp(u / MOVE_END));
  const cur = { ...pos };
  for (const a of drill.phases[phase].actions) {
    if (!MOVERS.has(a.type) || !a.from || !pos[a.from]) continue;
    cur[a.from] = pointAt(actionPath(drill, phase, a, pos, after), m);
  }
  let holder = holders[phase];
  let ball = holder && cur[holder] ? cur[holder] : null;
  const k = ease(clamp((u - PASS_START) / (1 - PASS_START)));
  for (const a of drill.phases[phase].actions) {
    if (a.type !== 'pass' || k <= 0) continue;
    const from = a.from && cur[a.from] ? cur[a.from] : a.pts[0];
    const to = a.to && cur[a.to] ? cur[a.to] : a.pts[a.pts.length - 1];
    ball = k >= 1 && a.to ? cur[a.to] : lerp(from, to, k);
  }
  const done = t >= totalDuration(drill);
  return { phase, u, pos: cur, ball, done };
}
