// Turns a tick-list of what a worker can see into a ranked, explained shortlist.
//
// The scoring is deliberately transparent. A farm hand should be able to see why
// the app said what it said, and an agronomist should be able to argue with it.

import { PROBLEMS, PROBLEM_BY_ID, SYMPTOM_BY_ID, SYMPTOMS } from './pests.js';
import { stageAt } from './crops.js';
import { wetnessIndex, drynessIndex, waterloggingIndex } from './climate.js';
import { clamp } from '../util.js';

/** A symptom with weight 5 is close to decisive for that problem. */
const DECISIVE = 5;

/**
 * How much a symptom narrows things down.
 *
 * "Started after heavy rain" fits a third of the guide and proves almost
 * nothing. "Cut stem oozes milky thread" fits one thing only. Without this,
 * a single vague tick can carry an unrelated problem to the top of the list
 * purely because that problem had nothing else to be judged on.
 */
const SPECIFICITY = (() => {
  const df = new Map();
  for (const p of PROBLEMS) {
    for (const sid of Object.keys(p.symptoms)) df.set(sid, (df.get(sid) || 0) + 1);
  }
  const n = PROBLEMS.length;
  const ceiling = Math.log(1 + n);
  const out = {};
  for (const [sid, count] of df) {
    const info = Math.log(1 + n / count) / ceiling; // 1 for unique, low for common
    out[sid] = 0.5 + 0.5 * info;
  }
  return out;
})();

function spec(sid) { return SPECIFICITY[sid] ?? 0.75; }

function weatherFit(problem, date, observed) {
  const c = problem.conditions || {};
  const keys = Object.keys(c);
  if (!keys.length) return 1;
  const index = {
    wetness: wetnessIndex(date, observed),
    dryness: drynessIndex(date, observed),
    waterlogging: waterloggingIndex(date, observed),
  };
  let weighted = 0, total = 0;
  for (const k of keys) {
    weighted += (c[k] || 0) * (index[k] ?? 0.5);
    total += c[k] || 0;
  }
  const fit = total ? weighted / total : 0.5;
  // Weather nudges the ranking; it never decides it on its own.
  return 0.75 + 0.5 * fit;
}

function stageFit(problem, stageId) {
  if (!problem.stages || !problem.stages.length) return 1;
  if (!stageId) return 1;
  return problem.stages.includes(stageId) ? 1 : 0.6;
}

/**
 * Score every problem against the observations.
 *
 * ctx: { symptoms: string[], parts: string[], cropId, dat, date, observed }
 *  - parts is which parts of the plant the worker actually inspected. Only
 *    symptoms in those parts count against a problem, so a worker who never
 *    dug the roots is not penalised for missing root galls.
 */
export function diagnose(ctx = {}) {
  const ticked = new Set(ctx.symptoms || []);
  const inspected = new Set(ctx.parts && ctx.parts.length
    ? ctx.parts
    : [...ticked].map((s) => SYMPTOM_BY_ID[s]?.part).filter(Boolean));
  const date = ctx.date || new Date();
  const stageId = ctx.stage || (ctx.cropId != null && ctx.dat != null
    ? stageAt(ctx.cropId, ctx.dat).id : null);

  if (!ticked.size) return { results: [], asked: 0, nextChecks: [] };

  const results = [];
  for (const problem of PROBLEMS) {
    if (ctx.cropId && problem.crops && !problem.crops.includes(ctx.cropId)) continue;

    let matched = 0, possible = 0, total = 0, bestHit = 0;
    const hits = [], misses = [];
    for (const [sid, w] of Object.entries(problem.symptoms)) {
      const sym = SYMPTOM_BY_ID[sid];
      if (!sym) continue;
      const weight = w * spec(sid);
      total += weight;
      if (ticked.has(sid)) {
        matched += weight;
        bestHit = Math.max(bestHit, w);
        hits.push({ id: sid, weight: w });
        continue;
      }
      if (inspected.has(sym.part)) {
        possible += weight;
        if (w >= DECISIVE) misses.push({ id: sid, weight: w });
      }
    }
    if (!matched) continue;
    possible += matched;

    let score = matched / possible;

    // A decisive symptom seen is worth more than the same weight spread thin.
    const sawDecisive = hits.some((h) => h.weight >= DECISIVE);
    if (sawDecisive) score = clamp(score * 1.2, 0, 1);

    // A decisive symptom looked for and not found argues against.
    if (misses.length) score *= Math.max(0.55, 1 - 0.22 * misses.length);

    // How much of this problem's evidence was even in view. A problem whose
    // tell-tale signs are all on a part nobody looked at cannot be confirmed
    // from here, however well the one tick that did land fits. It belongs in
    // "go and check this next", not at the top of the answer.
    const coverage = Math.sqrt(clamp(possible / Math.max(total, 0.001), 0.25, 1));
    score *= coverage;

    // Nothing but vague signs is not a diagnosis.
    if (bestHit < 4) score *= 0.55;

    score *= stageFit(problem, stageId);
    score *= weatherFit(problem, date, ctx.observed);

    // Breadth matters: two ticks out of two is weaker evidence than six out of seven.
    const breadth = clamp(hits.length / 3, 0.55, 1);
    score *= 0.7 + 0.3 * breadth;

    results.push({
      id: problem.id,
      problem,
      score: clamp(score, 0, 1),
      matchedWeight: Math.round(matched * 10) / 10,
      coverage: Math.round(coverage * 100) / 100,
      hits: hits.sort((a, b) => b.weight - a.weight),
      missedDecisive: misses,
      urgency: clamp(score, 0, 1) * problem.severity,
      confidence: confidenceLabel(clamp(score, 0, 1)),
    });
  }

  results.sort((a, b) => b.score - a.score || b.problem.severity - a.problem.severity);
  return {
    results,
    asked: ticked.size,
    inspected: [...inspected],
    nextChecks: nextChecks(results, inspected, ticked),
    separator: separatingSymptom(results),
  };
}

export function confidenceLabel(score) {
  if (score >= 0.6) return { id: 'strong', label: 'Strong match', hint: 'Act on this, and confirm as you go.' };
  if (score >= 0.35) return { id: 'likely', label: 'Likely', hint: 'Do the confirming checks before you spend money.' };
  if (score >= 0.18) return { id: 'possible', label: 'Possible', hint: 'Not enough to act on yet. Look again.' };
  return { id: 'weak', label: 'Long shot', hint: 'Listed only so you do not miss it.' };
}

/**
 * What to go and look at next: decisive symptoms of the leading candidates that
 * sit in parts nobody has inspected yet. This is what turns a vague answer into
 * a sharp one on the second pass.
 */
export function nextChecks(results, inspected, ticked, limit = 4) {
  const top = results.slice(0, 4);
  const out = new Map();
  for (const r of top) {
    for (const [sid, w] of Object.entries(r.problem.symptoms)) {
      if (ticked.has(sid) || w < 4) continue;
      const sym = SYMPTOM_BY_ID[sid];
      if (!sym || inspected.has(sym.part)) continue;
      const prev = out.get(sid);
      const value = w * r.score;
      if (!prev || prev.value < value) {
        out.set(sid, { symptom: sym, value, forProblem: r.problem.name, part: sym.part });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

/**
 * The single observation that would best separate the top two candidates.
 * "Do the streaming test" beats "gather more information".
 */
export function separatingSymptom(results) {
  if (results.length < 2) return null;
  const [a, b] = results;
  if (a.score - b.score > 0.3) return null; // already clear enough
  let best = null;
  const all = new Set([...Object.keys(a.problem.symptoms), ...Object.keys(b.problem.symptoms)]);
  for (const sid of all) {
    const wa = a.problem.symptoms[sid] || 0;
    const wb = b.problem.symptoms[sid] || 0;
    const gap = Math.abs(wa - wb);
    if (gap < 3) continue;
    if (!best || gap > best.gap) {
      best = {
        gap,
        symptom: SYMPTOM_BY_ID[sid],
        points_to: wa > wb ? a.problem : b.problem,
        away_from: wa > wb ? b.problem : a.problem,
      };
    }
  }
  return best && best.symptom ? best : null;
}

/**
 * Standing risk board: what the weather and the crop stage make likely right
 * now, before anyone reports anything. This is the early-warning half of the
 * clinic, and it is what lets a manager spray before a problem, not after.
 */
export function riskForecast(cycles, date = new Date(), observed = null) {
  const byProblem = new Map();
  for (const cyc of cycles) {
    const stage = cyc.stage;
    for (const problem of PROBLEMS) {
      if (problem.crops && !problem.crops.includes(cyc.cropId)) continue;
      if (problem.stages && stage && !problem.stages.includes(stage)) continue;
      const conditions = problem.conditions || {};
      const keys = Object.keys(conditions);
      if (!keys.length) continue;
      const idx = {
        wetness: wetnessIndex(date, observed),
        dryness: drynessIndex(date, observed),
        waterlogging: waterloggingIndex(date, observed),
      };
      let weighted = 0, total = 0;
      for (const k of keys) { weighted += conditions[k] * (idx[k] ?? 0.5); total += conditions[k]; }
      const pressure = total ? weighted / total : 0;
      const risk = clamp(pressure * (0.5 + 0.1 * problem.severity), 0, 1);
      const entry = byProblem.get(problem.id) || {
        problem, risk: 0, beds: [], driver: keys.sort((a, b) => conditions[b] - conditions[a])[0],
      };
      entry.risk = Math.max(entry.risk, risk);
      entry.beds.push(cyc.label || cyc.id);
      byProblem.set(problem.id, entry);
    }
  }
  return [...byProblem.values()]
    .filter((e) => e.risk >= 0.3)
    .sort((a, b) => b.risk - a.risk);
}

export const RISK_DRIVER_TEXT = {
  wetness: 'wet leaves and rain splash',
  dryness: 'hot dry weather',
  waterlogging: 'water standing in the beds',
};

/** Free-text search across the guide, for when someone knows the name already. */
export function searchProblems(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return PROBLEMS.filter((p) => {
    const hay = [p.name, p.local, p.cause, p.type, ...(p.confirm || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** All symptoms grouped by part, for building the wizard. */
export function symptomTree() {
  const tree = new Map();
  for (const s of SYMPTOMS) {
    if (!tree.has(s.part)) tree.set(s.part, []);
    tree.get(s.part).push(s);
  }
  return tree;
}

export { PROBLEM_BY_ID };
