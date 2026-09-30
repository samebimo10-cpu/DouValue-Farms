// Learn — the problem cards for Greenhouse Hands (FR-LEARN-01 to 05).
//
// What this file holds the app to:
//   * Learn opens from the home screen, and never from inside a task;
//   * a hand's card shows how to recognise it, how to catch it early, what it
//     is confused with and what to do first — and no dose, rotation group,
//     product or treatment plan, on any of the 22 cards;
//   * those stay on the supervising view of the same card, which a hand cannot
//     open;
//   * the search works on the phone alone, with reference photos where added;
//   * a hand's diagnosed report links to the card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.location ??= { hash: '' };

const base = new URL('../web/js/', import.meta.url);
const load = (p) => import(new URL(p, base).href);

const store = await load('store.js');
const learn = await load('domain/learn.js');
const dx = await load('domain/diagnose.js');
const sp = await load('domain/sickplant.js');
const { learnView, learnCardView } = await load('ui/learn.js');
const { guideItemView, guideView } = await load('ui/clinic.js');
const { sickPlantView } = await load('ui/sickplant.js');
const { todayView } = await load('ui/worker.js');
const { isoDate } = await load('util.js');
const core = await import(new URL('../server/core.mjs', import.meta.url).href);

const RULES = JSON.parse(readFileSync(new URL('../rules/douvalue_rules_rev5_1.json', import.meta.url), 'utf8'));

const TODAY = isoDate();
const at = (h) => `${TODAY}T${String(h).padStart(2, '0')}:00:00.000Z`;
const ev = (id, type, payload, by = 'system', when = at(6)) => ({ id, type, at: when, by, payload });
const PHOTO = (tag) => ({ dataUrl: `data:image/jpeg;base64,${tag}`, fresh: true, bytes: 9000 });

function farm(extra = []) {
  return store.reduce([
    ev('p1', 'person.upsert', { id: 'u_hand', name: 'Emeka Okoro', role: 'hand' }),
    ev('p2', 'person.upsert', { id: 'u_sup', name: 'Tamuno West', role: 'supervisor' }),
    ev('p3', 'person.upsert', { id: 'u_mgr', name: 'Ada Briggs', role: 'manager' }),
    ev('z1', 'plot.upsert', { id: 'gh2', name: 'GH-02', type: 'greenhouse' }),
    ev('a1', 'zone.assign', { id: 'as1', zoneId: 'gh2', personId: 'u_hand', holding: 'primary' }, 'u_mgr'),
    ...extra,
  ]);
}
const ctxFor = (state, user) => ({ state, user, store: { state } });
const cardHtml = (state, user, id) => {
  globalThis.location.hash = `#/learn/card?id=${id}`;
  return learnCardView.render(ctxFor(state, user));
};

/** Anything that is a dose, a group or a product — none of it belongs on a hand's card. */
const PRODUCTS = new RegExp(`\\b(?:${learn.PRODUCT_WORDS.join('|')})`, 'i');
const TREATMENT = /\bIRAC\b|\bFRAC\b|\d\s*(?:ml|g|kg)\s*\/|\bper\s+(?:litre|tank|knapsack)|\bPHI\b|\bREI\b|rotation group|<h3>Treatment|>Treatment</i;

// --- FR-LEARN-01: from the home screen, never inside a task ---------------

test('FR-LEARN-01: My work opens Learn, in its own card and not inside any task', () => {
  const state = farm([
    ev('t1', 'task.create', { id: 't1', title: 'Scout GH-02', kind: 'scout', zoneId: 'gh2', assignedTo: 'u_hand', dueDate: TODAY }, 'u_mgr'),
    ev('t2', 'task.create', { id: 't2', title: 'Check traps', kind: 'trap', zoneId: 'gh2', assignedTo: 'u_hand', dueDate: TODAY }, 'u_mgr'),
  ]);
  const html = todayView.render(ctxFor(state, state.people.u_hand));
  const sections = html.split('<section').slice(1);
  const learnCards = sections.filter((s) => s.includes('#/learn'));
  assert.equal(learnCards.length, 1, 'one way in, from the home screen');
  assert.ok(sections.some((s) => /Scout GH-02/.test(s)), 'the tasks rendered, so the next check means something');
  for (const s of sections.filter((x) => /Scout GH-02|Check traps/.test(x))) {
    assert.ok(!s.includes('#/learn'), 'a task card never links into Learn');
  }
  // The task card and the sick-plant report are built with no way into it.
  const worker = readFileSync(new URL('ui/worker.js', base), 'utf8');
  const taskCard = worker.slice(worker.indexOf('function taskCard('), worker.indexOf('\n}\n', worker.indexOf('function taskCard(')));
  assert.ok(taskCard.length > 100 && !taskCard.includes('#/learn'));
  assert.ok(!readFileSync(new URL('ui/sickplant.js', base), 'utf8').includes('#/learn'));
  assert.ok(!sickPlantView.render(ctxFor(state, state.people.u_hand)).includes('#/learn'));
});

test('FR-LEARN-01: every role can open Learn, and it is the hand\'s only way to the cards', () => {
  for (const role of Object.keys(store.ROLES)) {
    assert.equal(store.can({ role }, learnView.perm), true, role);
    assert.equal(store.can({ role }, learnCardView.perm), true, role);
  }
  const hand = { role: 'hand' };
  assert.equal(store.can(hand, guideItemView.perm), false, 'the supervising card is not a hand\'s');
  assert.equal(store.can(hand, guideView.perm), false);
});

// --- FR-LEARN-02: the hand's card, and nothing else -----------------------

test('FR-LEARN-02: a hand\'s card has the four sections and no doses, groups, products or plans', () => {
  const state = farm();
  const hand = state.people.u_hand;
  for (const c of dx.CARDS) {
    const html = cardHtml(state, hand, c.id);
    assert.match(html, new RegExp(`<h2>${c.name}</h2>`), `${c.id} rendered`);
    assert.match(html, /How to recognise it/, c.id);
    assert.match(html, /What to do first/, c.id);
    const text = html.replace(/<[^>]+>/g, ' ');
    assert.ok(!PRODUCTS.test(text), `${c.id} names a product: ${text.match(PRODUCTS)}`);
    assert.ok(!TREATMENT.test(html), `${c.id} shows treatment detail: ${html.match(TREATMENT)}`);
    assert.ok(!html.includes('#/guide/item'), `${c.id} links a hand to the supervising card`);
    // Nothing of the card's treatment line, or of a raw first action that
    // carries a product, reaches the hand.
    assert.ok(!text.includes(c.treatment), `${c.id} shows the treatment line`);
  }
});

test('FR-LEARN-02: the sections are filled from the rules, with the treatment clauses taken out', () => {
  const state = farm();
  const thrips = learn.learnCard(state, 'thrips');
  assert.ok(thrips.recognise.detection.includes('white paper'));
  assert.ok(thrips.catchEarly.some((x) => x.includes('>10 per trap')), 'the count to tell the supervisor at');
  assert.ok(thrips.catchEarly.includes('Remove weeds/volunteers'));
  assert.ok(!thrips.catchEarly.some((x) => /pre-stocked/.test(x)), 'stock planning is not a hand\'s');
  assert.deepEqual(thrips.firstSteps.slice(0, -1), ['Log and re-count'], 'the spray clause is gone');
  assert.equal(thrips.firstSteps.at(-1), learn.REPORT_STEP, 'and every card ends on reporting it');
  assert.ok(thrips.lookalikes.some((l) => l.name === 'Aphids' && l.tellApart), 'what it is confused with, and how to tell');

  // Whole clauses go, not half of one: a dose never survives as a fragment.
  assert.deepEqual(learn.handSafe('Borax 1 g/L weekly on tips (max 1.5)'), []);
  assert.deepEqual(learn.handSafe('Abamectin or wettable sulphur on tips; remove worst tips'), ['Remove worst tips']);
  assert.deepEqual(learn.handSafe('Ca drench 1.8 kg/1,000 L; regular irrigation'), ['Regular irrigation']);
  // Every active in the rules is caught by name, so a new one is too.
  for (const a of RULES.active_ingredients) {
    assert.equal(learn.isTreatmentText(`use ${a.ai} today`), true, a.ai);
  }
});

test('FR-LEARN-02: the supervising view of the same card keeps the treatment', () => {
  const state = farm();
  const sup = state.people.u_sup;
  assert.equal(store.can(sup, 'viewTreatment'), true);
  assert.equal(store.can(state.people.u_mgr, 'viewTreatment'), true);
  assert.equal(store.can({ role: 'hand' }, 'viewTreatment'), false);
  for (const role of Object.keys(core.ROLES)) {
    assert.equal(core.can(role, 'viewTreatment'), store.can({ role }, 'viewTreatment'), `${role} app vs server`);
  }
  const learnHtml = cardHtml(state, sup, 'thrips');
  assert.match(learnHtml, /data-to="#\/guide\/item\?id=thrips"/, 'a supervisor gets the way to the full card');

  globalThis.location.hash = '#/guide/item?id=thrips';
  const full = guideItemView.render(ctxFor(state, sup));
  assert.match(full, /<h3>Treatment<\/h3>/, 'the treatment is on the supervising card');
  assert.match(full, /Spinosad IRAC 5/, 'with the product and its group');
});

// --- FR-LEARN-03 / 04: search offline, with photos ------------------------

test('FR-LEARN-03: the search finds cards by what a hand would type, and not by product', () => {
  assert.ok(learn.learnSearch('yellow leaves').length > 0);
  assert.ok(learn.learnSearch('wilt').map((c) => c.id).includes('bacterial_wilt'));
  assert.ok(learn.learnSearch('white paper').map((c) => c.id).includes('thrips'));
  assert.deepEqual(learn.learnSearch('spinosad'), [], 'a hand\'s search does not look in the treatment');
  assert.equal(learn.learnSearch('').length, dx.CARDS.length);
  assert.ok(learn.learnSearch('', { category: 'virus' }).every((c) => c.category === 'virus'));
  // Offline: the search module reaches for nothing but the bundled rules.
  const source = readFileSync(new URL('domain/learn.js', base), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|navigator\.onLine/.test(source));
});

test('FR-LEARN-04: reference photos show on the list and the card where they exist', () => {
  const state = farm([
    ev('ph1', 'reference.photo.set', { slot: 'card:thrips', photo: PHOTO('THRIPSCARD') }, 'u_mgr'),
    ev('ph2', 'reference.photo.set', { slot: 'row:1', photo: PHOTO('THRIPSROW') }, 'u_mgr'),
  ]);
  const hand = state.people.u_hand;
  const list = learnView.render(ctxFor(state, hand));
  assert.ok(list.includes('THRIPSCARD'), 'the card\'s picture is on the list');
  const html = cardHtml(state, hand, 'thrips');
  assert.ok(html.includes('THRIPSCARD') && html.includes('THRIPSROW'));
  // A card with no photo yet still reads in full.
  assert.match(cardHtml(state, hand, 'cutworm'), /How to recognise it/);
});

// --- FR-LEARN-05: the diagnosed report links to the card ------------------

test('FR-LEARN-05: when a hand\'s report is diagnosed, the result links to its Learn card', () => {
  const s0 = farm();
  const { payload } = sp.composeReport(s0, 'u_hand', {
    zoneId: 'gh2', photos: [PHOTO('HANDPHOTO')], where: ['top_leaves'], howMany: 'one', spreading: 'no',
  }, { id: 'r1', now: at(8) });
  const state = farm([
    ev('r', 'report.record', payload, 'u_hand', at(8)),
    ev('d', 'diagnosis.record', {
      id: 'dx1', engine: dx.RULES_VERSION, cardId: 'thrips', triageRow: 1, reportId: 'r1',
      photos: [PHOTO('HANDPHOTO')], confirmTest: 'Tap a tip over white paper', confirmResult: '14 on the trap',
      reasoning: 'Silvery flecks on the young leaves and a trap well over ten.', date: TODAY,
    }, 'u_sup', at(9)),
    ev('c', 'diagnosis.confirm', { id: 'dx1', confirmTest: 'Tap a tip over white paper', confirmResult: '12 again' }, 'u_mgr', at(10)),
  ]);
  const html = todayView.render(ctxFor(state, state.people.u_hand));
  assert.match(html, /Confirmed: Thrips/);
  assert.match(html, /href="#\/learn\/card\?id=thrips">Learn about Thrips/);
  // The "what happens now" line is the hand's version: the spray is left off.
  const result = sp.reportsBy(state, 'u_hand')[0].result;
  assert.equal(result.doNow, 'Log and re-count');
  assert.ok(!/Spinosad|IRAC/.test(html), 'no product or group reaches the hand\'s result');
});
