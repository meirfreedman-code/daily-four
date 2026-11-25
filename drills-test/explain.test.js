import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain, explainText, zone } from '../public/drills/js/explain.js';
import { positionsAt, ballHolders } from '../public/drills/js/model.js';

const drill = {
  v: 1, id: 'd1', name: 'בדיקה', created: 0, updated: 0,
  players: [
    { id: 'p1', team: 'O', num: 1, x: 750, y: 950, raw: [] },
    { id: 'p2', team: 'O', num: 2, x: 1300, y: 600, raw: [] },
    { id: 'p5', team: 'O', num: 5, x: 1000, y: 350, raw: [] },
    { id: 'x2', team: 'D', num: 2, x: 1200, y: 560, raw: [] },
  ],
  phases: [
    { actions: [
      { id: 'a1', type: 'pass', from: 'p1', to: 'p2', pts: [[750, 950], [1300, 600]], raw: [] },
      { id: 'a2', type: 'screen', from: 'p5', to: 'p2', pts: [[1000, 350], [1180, 520]], raw: [] },
    ] },
    { actions: [
      { id: 'a3', type: 'dribble', from: 'p2', to: null, pts: [[1300, 600], [800, 220]], raw: [] },
      { id: 'a4', type: 'move', from: 'p1', to: null, pts: [[750, 950], [120, 150]], raw: [] },
    ] },
    { actions: [] },
  ],
};

test('אזורים במגרש', () => {
  assert.equal(zone([750, 900]).key, 'top');
  assert.equal(zone([1400, 150]).at, 'בפינה הימנית');
  assert.equal(zone([100, 150]).at, 'בפינה השמאלית');
  assert.equal(zone([1300, 600]).at, 'בכנף הימנית');
  assert.equal(zone([760, 200]).key, 'basket');
  assert.equal(zone([995, 580]).key, 'elbow');
});

test('הסבר לפי שלבים', () => {
  const e = explain(drill);
  assert.equal(e.phases.length, 2); // השלב הריק האחרון לא מופיע
  assert.deepEqual(e.phases[0].sentences, ['5 חוסם ל-2.', '1 מוסר ל-2.']);
  assert.deepEqual(e.phases[1].sentences, ['2 חודר בכדרור לסל.', '1 עובר לפינה השמאלית.']);
  assert.match(e.setup, /^עמדות פתיחה: 1 בראש הקשת, 2 בכנף הימנית, 5 /);
  assert.match(e.setup, /מגן אחד\.$/);
});

test('טקסט מלא', () => {
  const t = explainText(drill);
  assert.match(t, /שלב 1: 5 חוסם ל-2\. 1 מוסר ל-2\./);
});

test('מיקומים וכדור לפי שלבים', () => {
  assert.deepEqual(positionsAt(drill, 1).p5, [1180, 520]);
  assert.deepEqual(positionsAt(drill, 2).p2, [800, 220]);
  assert.deepEqual(ballHolders(drill), ['p1', 'p2', 'p2', 'p2']);
});

test('מסירה בלי מקבל ומגן', () => {
  const d = structuredClone(drill);
  d.phases = [{ actions: [
    { id: 'b', type: 'pass', from: 'p1', to: null, pts: [[750, 950], [100, 150]], raw: [] },
    { id: 'c', type: 'move', from: 'x2', to: null, pts: [[1200, 560], [1300, 650]], raw: [] },
  ] }];
  assert.deepEqual(explain(d).phases[0].sentences, ['מגן 2 עובר לכנף הימנית.', '1 מוסר לפינה השמאלית.']);
});
