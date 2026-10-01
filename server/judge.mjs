// The farm server judges the records the gates are about, with the app's own
// code — FR-GATE-01 to 05, FR-TREAT-02, FR-PROOF-01/02, FR-STOCK-04/07/08 and
// the Week 10 organics rule.
//
// Until this file those checks ran only on the phone. The phone is the thing a
// person controls, and a phone that skipped a screen — an old build, a patched
// one, a curl command with a token — could sync a planting into untested soil,
// a spray with no diagnosis or out of rotation, or a harvest inside its
// waiting period, and every other phone would replay it as fact.
//
// The rules are not written down twice. The server rebuilds the farm from its
// own log with the app's reduce() and asks the app's own gate functions, with
// the rules file loaded from where it is published (CLAUDE.md: one copy).
// scripts-build-deno.mjs bundles these modules into the single-file Deno
// server, so Deno Deploy runs exactly this code too.
//
// Two numbers never come from the phone: the pre-harvest and re-entry
// intervals on a spray are the server's catalogue's (FR-STOCK-07), and the
// harvest block is judged on those (FR-TREAT-02).

// store.js first: the app's modules import each other in a cycle that only
// resolves in this order (onboarding → catalogue → store → gates → onboarding).
import { reduce } from '../web/js/store.js';
import { canAssignBatch, canPlant, canTreat } from '../web/js/domain/gates.js';
import { harvestCheck } from '../web/js/domain/onboarding.js';
import { buildCatalogue, sprayIntervals } from '../web/js/domain/catalogue.js';
import { proofCheck } from '../web/js/domain/proof.js';

/** The record types judged here. Anything else passes through untouched. */
export const JUDGED = new Set(['cycle.start', 'topsoil.assign', 'spray.record', 'harvest.record', 'task.complete']);

const FARM_OFFSET_MS = 3600 * 1000;   // WAT, UTC+1: the day on the farm, not in UTC

/** The farm's calendar day at an instant. */
export function farmDay(at) {
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t + FARM_OFFSET_MS).toISOString().slice(0, 10) : null;
}

const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** A refusal in one shape: what, why, what to do, and the requirement behind it. */
const refuse = (why, fix = null, rule = null) => ({ ok: false, why, fix, rule });

/** The reasons a spray is refused, mapped to the requirement each one is. */
const SPRAY_RULE = {
  'no-diagnosis': 'FR-GATE-04', unconfirmed: 'FR-GATE-04', 'awaiting-approval': 'FR-ROLE-13',
  'spray-history-missing': 'FR-ONB-05', rotation: 'FR-GATE-05', 'thrips-programme': 'FR-GATE-05',
  interval: 'FR-GATE-05', 'metalaxyl-interval': 'FR-GATE-05', 'not-in-catalogue': 'FR-STOCK-05',
  'no-rate': 'FR-STOCK-08', 'week-10': 'Week 10 organics rule (SR-08)', expired: 'FR-STOCK-04',
};

/**
 * A state for judging one record: the farm as the server holds it, cut back so
 * nothing dated after the record's own day can count against it — a spray
 * logged on Monday is not refused for a spray somebody else logged on Tuesday.
 */
function asOf(state, day) {
  const dated = (x) => !x.date || x.date <= day;
  return { ...state, sprays: (state.sprays || []).filter(dated), backfills: (state.backfills || []).filter(dated) };
}

/**
 * Judge one record against the farm. `state` is reduce() of the server's log
 * plus whatever this push has already accepted. Returns `{ ok: true }`,
 * `{ ok: true, payload }` when the server rewrites part of it, or a refusal.
 */
export function judgeRecord(event, state, { rules }) {
  const p = event.payload || {};
  const at = String(event.at || new Date().toISOString());
  const day = isDay(p.date) ? p.date : farmDay(at);

  switch (event.type) {
    // FR-GATE-01/02/03/06, FR-FARM-05: nothing is transplanted until every
    // gate that blocks transplant is clear or overridden by the Owner.
    case 'cycle.start': {
      const verdict = canPlant(state, p.plotId, { today: farmDay(at), now: at, batchId: p.seedlingBatchId || null });
      if (verdict.ok) return { ok: true };
      const first = verdict.blocking[0] || {};
      return refuse(`Planting is blocked on ${zoneName(state, p.plotId)}: ${verdict.why}. ${first.why || ''}`.trim(),
        first.fix || 'Record what the gates are missing on the Gates screen. Only the Owner can override a gate.',
        'FR-GATE-01/02/03');
    }

    // FR-GATE-03: an untested batch cannot be assigned to a zone.
    case 'topsoil.assign': {
      const verdict = canAssignBatch(state, p.batchId, p.zoneId, { today: farmDay(at) });
      return verdict.ok ? { ok: true } : refuse(verdict.why, verdict.fix, 'FR-GATE-03');
    }

    // FR-GATE-04/05, FR-STOCK-04/05/08, the Week 10 rule — and the waiting
    // periods it carries, from this server's catalogue (FR-STOCK-07).
    case 'spray.record': {
      const productRef = p.activeId || p.productId;
      if (!productRef) {
        return refuse('A spray names the active ingredient that went on.',
          'Choose it from the catalogue on the spray screen.', 'FR-STOCK-05');
      }
      const catalogue = buildCatalogue(state, rules);
      const verdict = canTreat(state, p.cycleId, {
        today: day, now: at, activeId: productRef, catalogue, target: p.targetProblem || null,
      });
      if (!verdict.ok) return refuse(verdict.why, verdict.fix || null, SPRAY_RULE[verdict.reason] || 'FR-GATE-04/05');
      const { phiDays, reiHours } = sprayIntervals(catalogue, p);
      return { ok: true, payload: { ...p, phiDays, reiHours } };
    }

    // FR-TREAT-02 with FR-ONB-04/05: no picking inside a waiting period, read
    // off the catalogue, or on a zone whose spray history is missing.
    case 'harvest.record': {
      if (!p.cycleId) return { ok: true };
      const catalogue = buildCatalogue(state, rules);
      const verdict = harvestCheck(asOf(state, day), p.cycleId, `${day}T12:00:00`, { catalogue, rules });
      if (verdict.safe) return { ok: true };
      return refuse(verdict.historyMissing
        ? verdict.reason
        : `Do not pick ${zoneName(state, (state.cycles[p.cycleId] || {}).plotId)} yet. ${verdict.reason}`,
      verdict.historyMissing
        ? 'The Farm Manager or Owner enters the spray history on the Setup screen.'
        : 'Pick it once the waiting period has passed.',
      verdict.historyMissing ? 'FR-ONB-05' : 'FR-TREAT-02');
    }

    // FR-PROOF-01/02/03: a scouting round or a trap check closes on a photo
    // taken now, in the app, stamped with date, time, zone and person.
    case 'task.complete': {
      const task = (state.tasks || {})[p.id];
      if (!task) return { ok: true };   // not here yet: every phone parks it until it is
      const verdict = proofCheck(task, p);
      return verdict.ok ? { ok: true } : refuse(`${task.title || 'That task'}: ${verdict.why}`, verdict.fix || null, verdict.rule);
    }
    default:
      return { ok: true };
  }
}

function zoneName(state, zoneId) {
  const zone = ((state && state.plots) || {})[zoneId];
  return zone ? zone.name : 'that zone';
}

/**
 * The farm as the server holds it, kept for the length of one push: the stored
 * log plus each record accepted so far, rebuilt only when something new has
 * gone in since the last time it was asked for.
 */
export function judgingLog(events) {
  const all = [...events];
  const ids = new Set(all.map((e) => e.id));
  let state = null;
  return {
    has: (id) => ids.has(id),
    add(event) { all.push(event); ids.add(event.id); state = null; },
    state() { if (!state) state = reduce(all); return state; },
  };
}
