// ייצוא: תמונה (PNG), וידאו קצר מהדפדפן, וקובץ תרגיל (JSON). שיתוף דרך תפריט השיתוף של הטלפון אם קיים.
import { drawCourt, drawDrill, fitTransform, VIEW } from './render.js';
import { explain } from './explain.js';
import { frameAt, totalDuration, playablePhases } from './animate.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

const safeName = (s) => (s || 'תרגיל').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'drill';

export function renderImage(drill) {
  const W = 1080, pad = 40;
  const n = playablePhases(drill);
  const cols = n > 1 ? 2 : 1;
  const pw = (W - pad * (cols + 1)) / cols;
  const ph = (pw * VIEW.h) / VIEW.w;
  const rows = Math.ceil(n / cols);
  const ex = explain(drill);

  const c = document.createElement('canvas');
  const m = c.getContext('2d');
  m.font = `30px ${FONT}`;
  const textLines = [];
  if (ex.setup) textLines.push(...wrap(m, ex.setup, W - pad * 2).map((t) => ({ t })));
  for (const p of ex.phases) {
    textLines.push(...wrap(m, `${p.title}: ${p.sentences.join(' ')}`, W - pad * 2).map((t, i) => ({ t, bold: i === 0 })));
  }
  const titleH = 90, lineH = 44, labelH = 46;
  c.width = W;
  c.height = Math.round(titleH + rows * (ph + labelH + pad) + textLines.length * lineH + pad);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#16213e';
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillText(drill.name || 'תרגיל', W - pad, titleH / 2 + 8);

  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    // סדר מימין לשמאל
    const x = W - pad - (col + 1) * pw - col * pad;
    const y = titleH + row * (ph + labelH + pad);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (n > 1) {
      ctx.fillStyle = '#16213e';
      ctx.font = `bold 32px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`שלב ${i + 1}`, x + pw, y + labelH / 2);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y + labelH, pw, ph); ctx.clip();
    fitTransform(ctx, x, y + labelH, pw, ph);
    drawCourt(ctx);
    drawDrill(ctx, drill, { mode: 'clean', phase: i, ghost: false });
    ctx.restore();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = 'right';
  let ty = titleH + rows * (ph + labelH + pad) + lineH / 2;
  for (const l of textLines) {
    ctx.font = `${l.bold ? 'bold ' : ''}30px ${FONT}`;
    ctx.fillStyle = '#16213e';
    ctx.fillText(l.t, W - pad, ty);
    ty += lineH;
  }
  return c;
}

const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));

export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

export async function exportImage(drill) {
  const blob = await toBlob(renderImage(drill));
  return shareOrDownload(blob, `${safeName(drill.name)}.png`, drill.name);
}

export function exportJson(drill) {
  const blob = new Blob([JSON.stringify(drill, null, 1)], { type: 'application/json' });
  return shareOrDownload(blob, `${safeName(drill.name)}.drill.json`, drill.name);
}

export function videoSupport() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  for (const t of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

// מקליט את האנימציה בזמן אמת לקנבס נסתר
export function exportVideo(drill, onProgress) {
  const type = videoSupport();
  if (!type) return Promise.reject(new Error('no-video'));
  const W = 720, top = 70;
  const H = Math.round((W * VIEW.h) / VIEW.w + top) & ~1;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const total = totalDuration(drill);

  const draw = (t) => {
    const f = frameAt(drill, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#16213e';
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillText(drill.name || 'תרגיל', W - 20, top / 2);
    ctx.textAlign = 'left';
    ctx.font = `26px ${FONT}`;
    ctx.fillText(`שלב ${f.phase + 1}`, 20, top / 2);
    fitTransform(ctx, 0, top, W, H - top);
    drawCourt(ctx);
    drawDrill(ctx, drill, { mode: 'clean', phase: f.phase, anim: { pos: f.pos, ball: f.ball, lineAlpha: 0.3 } });
  };

  return new Promise((resolve, reject) => {
    draw(0);
    const stream = c.captureStream(30);
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 }); } catch (e) { reject(e); return; }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      resolve({ blob, filename: `${safeName(drill.name)}.${ext}` });
    };
    rec.onerror = (e) => reject(e.error || e);
    rec.start(250);
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      draw(Math.min(t, total));
      if (onProgress) onProgress(Math.min(1, t / total));
      if (t < total) requestAnimationFrame(tick);
      else setTimeout(() => rec.stop(), 150);
    };
    requestAnimationFrame(tick);
  });
}
