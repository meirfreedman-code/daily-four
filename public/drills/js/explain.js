// הסבר בעברית שנבנה מהשרטוט לפי תבניות קבועות. בלי AI.
import { COURT, dist } from './geometry.js';
import { positionsAt, findPlayer, playerLabel } from './model.js';

// אזור במגרש. ימין/שמאל = כפי שנראה בשרטוט (הסל למעלה), כמו מבט של שחקן התוקף לעבר הסל.
export function zone([x, y]) {
  const { BX, BY } = COURT;
  const side = x >= BX ? 'right' : 'left';
  const R = side === 'right';
  const db = dist([x, y], [BX, BY]);
  const dx = Math.abs(x - BX);
  const z = (to, at, key) => ({ to, at, key });
  if (db < 230) return z('לסל', 'מתחת לסל', 'basket');
  if (y < 320 && dx > 560) return R ? z('לפינה הימנית', 'בפינה הימנית', 'corner') : z('לפינה השמאלית', 'בפינה השמאלית', 'corner');
  if (Math.abs(dx - 245) < 120 && Math.abs(y - 580) < 110)
    return R ? z('למרפק הימני', 'במרפק הימני', 'elbow') : z('למרפק השמאלי', 'במרפק השמאלי', 'elbow');
  if (dx < 260 && y < 470)
    return dx < 90 ? z('לתוך הצבע', 'בתוך הצבע', 'paint')
      : R ? z('לעמדה הנמוכה הימנית', 'בעמדה הנמוכה הימנית', 'low') : z('לעמדה הנמוכה השמאלית', 'בעמדה הנמוכה השמאלית', 'low');
  if (dx < 200 && y < 760) return z('לעמדה הגבוהה', 'בעמדה הגבוהה', 'high');
  if (y > 1050) return z('לכיוון קו החצי', 'ליד קו החצי', 'half');
  const outside = db > 660 || (y < 300 && dx > 640);
  if (outside) {
    if (dx < 260) return z('לראש הקשת', 'בראש הקשת', 'top');
    return R ? z('לכנף הימנית', 'בכנף הימנית', 'wing') : z('לכנף השמאלית', 'בכנף השמאלית', 'wing');
  }
  if (y < 330) return R ? z('לקו הבסיס מימין', 'בקו הבסיס מימין', 'baseline') : z('לקו הבסיס משמאל', 'בקו הבסיס משמאל', 'baseline');
  return R ? z('לחצי מרחק מימין', 'בחצי מרחק מימין', 'mid') : z('לחצי מרחק משמאל', 'בחצי מרחק משמאל', 'mid');
}

const ORDER = { screen: 0, dribble: 1, move: 2, pass: 3 };
const withL = (label) => (/^\d/.test(label) ? `ל-${label}` : `ל${label}`);

export function describeAction(drill, a) {
  const who = playerLabel(findPlayer(drill, a.from));
  const end = a.pts[a.pts.length - 1];
  const zn = zone(end);
  const target = a.to ? playerLabel(findPlayer(drill, a.to)) : null;
  switch (a.type) {
    case 'pass':
      return target ? `${who} מוסר ${withL(target)}.` : `${who} מוסר ${zn.to}.`;
    case 'screen':
      return target ? `${who} חוסם ${withL(target)}.` : `${who} מציב חסימה ${zn.at}.`;
    case 'dribble':
      return zn.key === 'basket' ? `${who} חודר בכדרור לסל.` : `${who} מכדרר ${zn.to}.`;
    default:
      return zn.key === 'basket' ? `${who} חותך לסל.` : `${who} עובר ${zn.to}.`;
  }
}

export function describeSetup(drill) {
  const pos = positionsAt(drill, 0);
  const off = drill.players.filter((p) => p.team === 'O').sort((a, b) => (a.num || 9) - (b.num || 9));
  const def = drill.players.filter((p) => p.team === 'D');
  if (!off.length && !def.length) return '';
  const parts = off.map((p) => `${playerLabel(p)} ${zone(pos[p.id]).at}`);
  let s = parts.length ? `עמדות פתיחה: ${parts.join(', ')}.` : '';
  if (def.length) s += `${s ? ' ' : ''}${def.length === 1 ? 'מגן אחד' : `${def.length} מגנים`}.`;
  return s;
}

// מחזיר { setup, phases: [{ title, sentences }] }
export function explain(drill) {
  const phases = drill.phases.map((ph, i) => {
    const acts = [...ph.actions].sort((a, b) => ORDER[a.type] - ORDER[b.type]);
    return { title: `שלב ${i + 1}`, sentences: acts.map((a) => describeAction(drill, a)) };
  });
  // שלב ריק אחרון לא מופיע בהסבר
  while (phases.length && !phases[phases.length - 1].sentences.length) phases.pop();
  return { setup: describeSetup(drill), phases };
}

export function explainText(drill) {
  const e = explain(drill);
  const lines = [];
  if (e.setup) lines.push(e.setup);
  for (const p of e.phases) lines.push(`${p.title}: ${p.sentences.join(' ') || '—'}`);
  return lines.join('\n');
}
