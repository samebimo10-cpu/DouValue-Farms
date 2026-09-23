// The KPI screen — FR-REP-03.
//
// "A KPI screen shows the measures in section 3, per week and per zone."
//
// The measures themselves are tested against the records in alerts.test.mjs.
// What this file is for is the screen: that all six are on it, that the week
// and zone breakdowns are really breakdowns rather than the same farm-wide
// number printed six times, and that a measure with nothing behind it says so
// instead of showing a zero that reads as a pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const { kpiView } = await import(new URL('ui/kpis.js', base).href);
const { isoDate } = await import(new URL('util.js', base).href);
const { kpis, kpisByWeek, kpisByZone } = await import(new URL('domain/alerts.js', base).href);

// The clock, read the way the screen reads it.
//
// kpiView.render() takes no date — the KPI screen is about now — so it calls
// isoDate(). A fixture pinned to a literal date drifts out of the 28-day
// window the measures are computed over, and then the screen tests below are
// reading a screen with nothing on it. The domain calls take `now` as an
// argument, so they are given the same instant the view will find.
const NOW = new Date().toISOString();
const day = (n) => isoDate(new Date(Date.now() + n * 86400000));

function farm(over = {}) {
  return {
    settings: { farmName: 'DouValue Farms Limited' },
    people: { u_owner: { id: 'u_owner', name: 'Ebimo Sam', role: 'ceo', active: true } },
    plots: {
      gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' },
      gh4: { id: 'gh4', name: 'GH-04', type: 'greenhouse' },
    },
    cycles: {
      c1: { id: 'c1', plotId: 'gh1', cropId: 'bell', transplantDate: day(-60), status: 'active' },
      c4: { id: 'c4', plotId: 'gh4', cropId: 'bell', transplantDate: day(-60), status: 'active' },
    },
    tasks: {}, inputs: {}, harvests: [], sales: [], sprays: [], scouts: [], diagnoses: [],
    expenses: [], stockMoves: [], attendance: [], workLogs: [], weather: [], reports: [],
    shifts: [], soilTests: [], topsoilBatches: {}, gateOverrides: [], alertAcks: [],
    alertDecisions: [], positions: {}, absences: [], log: [], orphans: [],
    ...over,
  };
}

const ctx = (state) => ({ state, user: state.people.u_owner, store: { state } });

test('all six of section 3\'s measures are on the screen, with their targets', () => {
  const html = kpiView.render(ctx(farm()));
  for (const row of kpis(farm(), { now: NOW })) {
    assert.ok(html.includes(row.measure), `${row.id} is missing from the screen`);
  }
  assert.match(html, /≤ 24 h/, 'KPI-01 carries its target');
  assert.match(html, /≥ 95%/, 'KPI-02 carries its target');
});

test('a measure with nothing behind it says so rather than showing a pass', () => {
  // "0 treatments without a diagnosis" on a farm that has logged no treatments
  // at all is not a pass; it is an empty farm.
  const html = kpiView.render(ctx(farm()));
  assert.match(html, /nothing to measure yet/);
  assert.match(html, /A dash means there is nothing to measure yet/);
});

test('the week grid is a grid: one row per week, all six measures across', () => {
  const html = kpiView.render(ctx(farm()));
  assert.match(html, /Week by week/);
  assert.match(html, /This week/);
  assert.match(html, /Last week/);
  for (const id of ['K01', 'K02', 'K03', 'K04', 'K05', 'K06']) {
    assert.ok(html.includes(id), `${id} has no column`);
  }
  assert.match(html, /K01<\/b> breach to treatment/, 'the short codes are explained underneath');
});

test('a bad week shows as a bad week, and the weeks around it do not', () => {
  const state = farm({
    sprays: [{ id: 'sp1', cycleId: 'c1', productId: 'neem', date: day(-9),
      at: `${day(-9)}T10:00:00.000Z` }],
  });
  const weeks = kpisByWeek(state, { now: NOW, weeks: 3 });
  const k3 = (week) => week.rows.find((r) => r.id === 'KPI-03');

  const failing = weeks.filter((w) => k3(w).value > 0);
  assert.equal(failing.length, 1, 'the spray lands in one week only');
  assert.equal(k3(failing[0]).ok, false);
  for (const week of weeks.filter((w) => !failing.includes(w))) {
    assert.equal(k3(week).value, 0);
  }
});

test('the zone blocks hold each zone\'s own numbers, worst zone first', () => {
  const state = farm({
    sprays: [
      { id: 'sp1', cycleId: 'c4', productId: 'neem', date: day(-1), at: `${day(-1)}T10:00:00.000Z` },
      { id: 'sp2', cycleId: 'c4', productId: 'neem', date: day(-2), at: `${day(-2)}T10:00:00.000Z` },
    ],
  });

  const zones = kpisByZone(state, { now: NOW });
  assert.equal(zones[0].zone.name, 'GH-04', 'the zone with failures is at the top');
  assert.equal(zones[0].rows.find((r) => r.id === 'KPI-03').value, 2);
  assert.equal(zones[1].rows.find((r) => r.id === 'KPI-03').value, 0, 'GH-01 is not blamed for it');

  const html = kpiView.render(ctx(state));
  assert.match(html, /By zone/);
  assert.match(html, /GH-04/);
  assert.match(html, /not met/);
});

test('the zone block carries that zone\'s trap-count trend under it', () => {
  // FR-SCOUT-06 and FR-REP-03 on one card: "GH-01 is failing KPI-01" and
  // "here is GH-01's count climbing through the line" are one sentence.
  const state = farm({
    scouts: [0, 1, 2].map((i) => ({
      id: `sc${i}`, cycleId: 'c1', pestId: 'thrips', trapCount: [2, 7, 14][i],
      date: day(-6 + i * 2), at: `${day(-6 + i * 2)}T09:00:00.000Z`, by: 'u_owner',
    })),
  });
  const html = kpiView.render(ctx(state));

  assert.match(html, /Trap counts/);
  assert.match(html, /class="threshold"/);
  assert.match(html, /threshold 10/);
  // And a zone with no counts says that, rather than drawing an empty box.
  assert.match(html, /No counts recorded for this zone yet/);
});

test('a farm with no zones yet is told what to do, not shown an empty grid', () => {
  const html = kpiView.render(ctx(farm({ plots: {}, cycles: {} })));
  assert.match(html, /No zones yet/);
});

test('the screen is the manager\'s and the Owner\'s, not a hand\'s', () => {
  assert.equal(kpiView.perm, 'viewReports');
});
