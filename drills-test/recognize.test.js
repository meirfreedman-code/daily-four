import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStroke, isCrossPair, isScreenBar, isDashContinuation, isTap } from '../public/drills/js/recognize.js';
import { newDrill, ingestStroke } from '../public/drills/js/model.js';
import { jitter, line, circle, zigzag, concat } from './shapes.js';

test('עיגול מזוהה כשחקן התקפה', () => {
  const r = classifyStroke(jitter(circle([700, 700], 60)));
  assert.equal(r.kind, 'circle');
  assert.ok(r.confidence >= 0.7);
});

test('עיגול שלא נסגר עד הסוף עדיין עיגול', () => {
  const r = classifyStroke(jitter(circle([400, 500], 55, 0.92)));
  assert.equal(r.kind, 'circle');
});

test('קו ישר = תנועה', () => {
  const r = classifyStroke(jitter(line([300, 900], [300, 400])));
  assert.equal(r.kind, 'line');
  assert.equal(r.lineType, 'move');
  assert.ok(r.confidence >= 0.8);
});

test('קו מעוקל = תנועה', () => {
  const arc = [];
  for (let i = 0; i <= 40; i++) { const t = (i / 40) * Math.PI * 0.6; arc.push([750 + 500 * Math.cos(t), 200 + 500 * Math.sin(t)]); }
  assert.equal(classifyStroke(jitter(arc)).lineType, 'move');
});

test('זיגזג = כדרור', () => {
  const r = classifyStroke(jitter(zigzag([750, 1000], [750, 500])));
  assert.equal(r.kind, 'line');
  assert.equal(r.lineType, 'dribble');
});

test('קו עם פס ניצב בסוף (באותה תנועה) = חסימה', () => {
  const end = [700, 500];
  const stroke = concat(line([700, 900], end), line(end, [750, 500], 6), line([750, 500], [650, 500], 10));
  const r = classifyStroke(jitter(stroke, 2));
  assert.equal(r.lineType, 'screen');
});

test('פס ניצב כקו נפרד = חסימה', () => {
  const l = line([700, 900], [700, 500]);
  assert.equal(isScreenBar(l, line([650, 505], [750, 495], 8)), true);
  assert.equal(isScreenBar(l, line([700, 480], [700, 380], 8)), false);
});

test('שני קווים קצרים מצטלבים = X', () => {
  const a = line([600, 600], [700, 700], 10);
  const b = line([700, 600], [600, 700], 10);
  const x = isCrossPair(a, b);
  assert.ok(x);
  assert.ok(Math.abs(x[0] - 650) < 2 && Math.abs(x[1] - 650) < 2);
});

test('קווים מקבילים אינם X', () => {
  assert.equal(isCrossPair(line([0, 0], [100, 100], 10), line([10, 0], [110, 100], 10)), null);
});

test('מקטע שממשיך אחרי רווח = מקווקו', () => {
  const a = line([300, 900], [300, 820], 8);
  assert.equal(isDashContinuation(a, line([300, 790], [300, 710], 8)), true);
  assert.equal(isDashContinuation(a, line([300, 790], [380, 790], 8)), false); // פנייה חדה
  assert.equal(isDashContinuation(a, line([300, 500], [300, 420], 8)), false); // רחוק מדי
});

test('הקשה מזוהה', () => {
  assert.equal(isTap([[100, 100], [104, 102]], 120), true);
  assert.equal(isTap(line([0, 0], [200, 0]), 120), false);
});

test('X בתנועה אחת', () => {
  const s = concat(line([600, 600], [700, 700], 10), line([700, 700], [700, 600], 10), line([700, 600], [600, 700], 10));
  assert.equal(classifyStroke(jitter(s, 2)).kind, 'x');
});

test('צורה לא ברורה מסומנת כלא בטוחה', () => {
  // ריבוע סגור — לא עיגול טוב
  const sq = concat(line([500, 500], [700, 500], 10), line([700, 500], [700, 520], 3), line([700, 520], [500, 520], 10), line([500, 520], [500, 500], 3));
  assert.ok(classifyStroke(sq).confidence < 0.6);
});

test('רצף ציור: שחקנים, מסירה מקווקוות, X משני קווים', () => {
  const d = newDrill();
  let last = null;
  let t = 0;
  const feed = (s) => { const r = ingestStroke(d, 0, s, (t += 500), last); last = r.last; return r; };
  feed(circle([750, 900], 50));
  feed(circle([1250, 500], 50));
  assert.equal(d.players.length, 2);
  assert.deepEqual(d.players.map((p) => p.num), [1, 2]);
  // מסירה בשלושה מקטעים מ-1 ל-2
  feed(line([790, 870], [880, 800], 8));
  feed(line([920, 770], [1010, 700], 8));
  feed(line([1050, 670], [1200, 550], 8));
  const acts = d.phases[0].actions;
  assert.equal(acts.length, 1);
  assert.equal(acts[0].type, 'pass');
  assert.equal(acts[0].from, d.players[0].id);
  assert.equal(acts[0].to, d.players[1].id);
  // X משני קווים
  t += 4000;
  feed(line([1150, 400], [1230, 480], 8));
  const r = feed(line([1230, 400], [1150, 480], 8));
  assert.equal(r.created, 'player');
  assert.equal(d.players.length, 3);
  assert.equal(d.players[2].team, 'D');
  assert.equal(d.players[2].num, 2); // מספר השחקן הקרוב
  assert.equal(d.phases[0].actions.length, 1);
});
