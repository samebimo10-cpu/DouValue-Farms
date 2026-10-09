// The sample farm as a state, with today's work generated on it — what a
// phone shows on its first open after "Load a sample farm". For screen tests
// that need a real-looking farm: beds in their PHI, a picking on the board, a
// spray on record. Dates are relative to today, as the sample's are.

const base = new URL('../../web/js/', import.meta.url);
const load = (p) => import(new URL(p, base).href);

export async function sampleState(extra = []) {
  const store = await load('store.js');
  const { seedSampleFarm } = await load('sample.js');
  const { missingTasks } = await load('domain/schedule.js');
  const { missingFollowUps } = await load('domain/doctor.js');
  const { isoDate } = await load('util.js');

  let events = [];
  await seedSampleFarm({ dispatchMany: async (list) => { events = list; } });
  events = events.map((e, i) => ({ id: `s${i}`, ...e }));
  let state = store.reduce(events);
  const today = isoDate();
  const tasks = [...missingTasks(state, { date: today }), ...missingFollowUps(state, { today })]
    .map((t) => ({ id: `ev_${t.id}`, type: 'task.create', payload: t, by: 'sp_ada', at: new Date().toISOString() }));
  state = store.reduce([...events, ...tasks, ...extra]);
  return { state, events: [...events, ...tasks], reduce: store.reduce };
}

/** The context a view's render() reads. */
export const ctxFor = (state, user) => ({ state, user, store: { state, user } });
