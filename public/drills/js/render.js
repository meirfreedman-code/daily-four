// ציור המגרש והתרגיל על canvas. משמש גם את העורך, גם את האנימציה וגם את הייצוא.
import { COURT, cleanPath, warp, trimPath, resample, pathLength, endDirection } from './geometry.js';
import { positionsAt, ballHolders } from './model.js';

// גבולות התצוגה ביחידות מגרש (כולל שוליים מחוץ לקווים)
export const VIEW = { x: -60, y: -60, w: 1620, h: 1520 };

export const COLORS = {
  outside: '#b98a52', floor: '#e4bb80', paint: '#d79e5f', line: '#ffffff',
  ink: '#16213e', off: '#16213e', def: '#c1121f', ball: '#f77f00', sel: '#06d6a0', rim: '#e85d04',
};

export function drawCourt(ctx) {
  const { W, H, BX, BY } = COURT;
  ctx.fillStyle = COLORS.outside;
  ctx.fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COLORS.paint;
  ctx.fillRect(505, 0, 490, 580);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 5;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  ctx.strokeRect(0, 0, W, H);
  ctx.strokeRect(505, 0, 490, 580);
  // עיגול עונשין: חצי מלא כלפי חוץ, מקווקו בתוך הצבע
  ctx.beginPath(); ctx.arc(BX, 580, 180, 0, Math.PI); ctx.stroke();
  ctx.setLineDash([18, 14]);
  ctx.beginPath(); ctx.arc(BX, 580, 180, Math.PI, 2 * Math.PI); ctx.stroke();
  ctx.setLineDash([]);
  // קשת שלוש
  const a0 = Math.acos(660 / 675);
  const yJoin = BY + 675 * Math.sin(a0);
  ctx.beginPath();
  ctx.moveTo(90, 0); ctx.lineTo(90, yJoin);
  ctx.arc(BX, BY, 675, Math.PI - a0, a0, true);
  ctx.lineTo(1410, 0);
  ctx.stroke();
  // חצי עיגול "ללא הסתערות"
  ctx.beginPath(); ctx.arc(BX, BY, 125, 0, Math.PI); ctx.stroke();
  // עיגול מרכז
  ctx.beginPath(); ctx.arc(BX, H, 180, Math.PI, 2 * Math.PI); ctx.stroke();
  // לוח וטבעת
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(660, 120); ctx.lineTo(840, 120); ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.rim;
  ctx.beginPath(); ctx.arc(BX, BY, 22.5, 0, 2 * Math.PI); ctx.stroke();
}

const PR = 46; // רדיוס סמל שחקן

// המסלול הנקי של פעולה, מחובר למיקום השחקן בתחילת השלב (ולמקבל, במסירה)
export function actionPath(drill, phase, a, pos, posAfter) {
  let p = cleanPath(a.pts);
  if (p.length < 2) p = [a.pts[0], a.pts[0]];
  const start = a.from && pos[a.from] ? pos[a.from] : null;
  const end = a.type === 'pass' && a.to && posAfter[a.to] ? posAfter[a.to] : null;
  return warp(p, start, end);
}

function arrowHead(ctx, tip, dir, size = 34) {
  const [dx, dy] = dir;
  const nx = -dy, ny = dx;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0] - dx * size + nx * size * 0.55, tip[1] - dy * size + ny * size * 0.55);
  ctx.lineTo(tip[0] - dx * size - nx * size * 0.55, tip[1] - dy * size - ny * size * 0.55);
  ctx.closePath();
  ctx.fill();
}

function strokePoly(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.stroke();
}

function wave(p) {
  const r = resample(p, 4);
  const L = pathLength(r);
  const out = [];
  let acc = 0;
  for (let i = 0; i < r.length; i++) {
    if (i) acc += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
    const j = Math.min(r.length - 1, i + 1), k = Math.max(0, i - 1);
    const dx = r[j][0] - r[k][0], dy = r[j][1] - r[k][1];
    const d = Math.hypot(dx, dy) || 1;
    const fade = Math.min(1, acc / 25, Math.max(0, (L - acc - 30) / 25));
    const s = Math.sin((acc / 46) * 2 * Math.PI) * 16 * fade;
    out.push([r[i][0] - (dy / d) * s, r[i][1] + (dx / d) * s]);
  }
  return out;
}

export function drawCleanAction(ctx, path, a, color) {
  const trimA = a.from ? PR + 6 : 0;
  const trimB = a.type === 'pass' && a.to ? PR + 8 : 0;
  const p = trimPath(path, trimA, trimB);
  if (p.length < 2) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const dir = endDirection(p, 30);
  const tip = p[p.length - 1];
  if (a.type === 'screen') {
    ctx.setLineDash([]);
    strokePoly(ctx, p);
    const n = [-dir[1], dir[0]];
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(tip[0] + n[0] * 42, tip[1] + n[1] * 42);
    ctx.lineTo(tip[0] - n[0] * 42, tip[1] - n[1] * 42);
    ctx.stroke();
    return;
  }
  // הקו נעצר לפני החץ
  const body = trimPath(p, 0, 26);
  if (a.type === 'pass') ctx.setLineDash([24, 18]);
  else ctx.setLineDash([]);
  strokePoly(ctx, a.type === 'dribble' ? wave(body) : body);
  ctx.setLineDash([]);
  arrowHead(ctx, tip, dir);
}

export function drawPlayer(ctx, p, at, { selected = false, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const [x, y] = at;
  if (selected) {
    ctx.fillStyle = COLORS.sel;
    ctx.globalAlpha = alpha * 0.45;
    ctx.beginPath(); ctx.arc(x, y, PR + 22, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = alpha;
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  if (p.team === 'O') {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = COLORS.off;
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(x, y, PR, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = COLORS.off;
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.num ? String(p.num) : '?', x, y + 3);
  } else {
    ctx.strokeStyle = COLORS.def;
    ctx.lineWidth = 11;
    const s = 34;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
    ctx.stroke();
    if (p.num) {
      ctx.fillStyle = COLORS.def;
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(p.num), x + 46, y + 40);
    }
  }
  ctx.restore();
}

function drawSketchPlayer(ctx, p, at, selected) {
  ctx.save();
  if (selected) {
    ctx.fillStyle = COLORS.sel; ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.arc(at[0], at[1], PR + 22, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = p.team === 'O' ? COLORS.ink : COLORS.def;
  ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
  for (const s of p.raw) strokePoly(ctx, s.map(([dx, dy]) => [at[0] + dx, at[1] + dy]));
  if (p.num) {
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(p.num), at[0], at[1] + 2);
  }
  ctx.restore();
}

export function drawBall(ctx, at) {
  const x = at[0] + 38, y = at[1] - 38;
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.ball; ctx.strokeStyle = '#7a3300'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(x, y, 20, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x + 20, y); ctx.moveTo(x, y - 20); ctx.lineTo(x, y + 20); ctx.stroke();
  ctx.restore();
}

// opts: { mode: 'clean'|'sketch', phase, selected: ref, ghost: bool, anim: { pos, ball, lineAlpha }, live: [[x,y]] }
export function drawDrill(ctx, drill, opts) {
  const phase = Math.min(opts.phase || 0, drill.phases.length - 1);
  const pos = opts.anim ? opts.anim.pos : positionsAt(drill, phase);
  const sel = opts.selected || null;

  // שלבים קודמים בשקיפות
  if (opts.ghost !== false && !opts.anim) {
    for (let i = 0; i < phase; i++) {
      const pi = positionsAt(drill, i), pa = positionsAt(drill, i + 1);
      ctx.save();
      ctx.globalAlpha = 0.22;
      for (const a of drill.phases[i].actions) drawCleanAction(ctx, actionPath(drill, i, a, pi, pa), a, COLORS.ink);
      ctx.restore();
    }
  }

  const pStart = positionsAt(drill, phase), pAfter = positionsAt(drill, phase + 1);
  ctx.save();
  if (opts.anim) ctx.globalAlpha = opts.anim.lineAlpha ?? 0.3;
  for (const a of drill.phases[phase].actions) {
    const isSel = sel && sel.kind === 'action' && sel.id === a.id;
    if (opts.mode === 'sketch' && !opts.anim) {
      ctx.save();
      ctx.strokeStyle = isSel ? COLORS.sel : COLORS.ink;
      ctx.lineWidth = isSel ? 10 : 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
      for (const s of a.raw) strokePoly(ctx, s);
      ctx.restore();
    } else {
      const path = actionPath(drill, phase, a, pStart, pAfter);
      if (isSel) {
        ctx.save(); ctx.globalAlpha = 0.5;
        ctx.strokeStyle = COLORS.sel; ctx.lineWidth = 26; ctx.lineCap = 'round'; ctx.setLineDash([]);
        strokePoly(ctx, path);
        ctx.restore();
      }
      drawCleanAction(ctx, path, a, COLORS.ink);
    }
  }
  ctx.restore();

  for (const p of drill.players) {
    const at = pos[p.id];
    if (!at) continue;
    const isSel = sel && sel.kind === 'player' && sel.id === p.id;
    if (opts.mode === 'sketch' && !opts.anim) drawSketchPlayer(ctx, p, at, isSel);
    else drawPlayer(ctx, p, at, { selected: isSel });
  }

  if (opts.anim) {
    if (opts.anim.ball) drawBall(ctx, opts.anim.ball);
  } else {
    const holder = ballHolders(drill)[phase];
    if (holder && pos[holder]) drawBall(ctx, pos[holder]);
  }

  if (opts.live && opts.live.length > 1) {
    ctx.save();
    ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
    strokePoly(ctx, opts.live);
    ctx.restore();
  }
}

// מסגרת: מתאימה את ctx כך שהמגרש ימלא מלבן נתון
export function fitTransform(ctx, x, y, w, h) {
  const s = Math.min(w / VIEW.w, h / VIEW.h);
  ctx.setTransform(s, 0, 0, s, x + (w - VIEW.w * s) / 2 - VIEW.x * s, y + (h - VIEW.h * s) / 2 - VIEW.y * s);
  return s;
}

