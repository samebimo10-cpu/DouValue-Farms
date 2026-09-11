// English and Nigerian Pidgin.
//
// Not decoration. On a Port Harcourt farm the hands and the manager often do not
// share a first language, and an app that only speaks formal English quietly
// becomes an app only the manager uses. The worker-facing screens carry both;
// the accounting screens stay in English, because that is the language the
// ledger and the buyers already use.

export const LANGS = { en: 'English', pcm: 'Pidgin' };

const STRINGS = {
  // Chrome
  'nav.today': { en: 'Today', pcm: 'Today' },
  'nav.field': { en: 'Field', pcm: 'Farm' },
  'nav.clinic': { en: 'Clinic', pcm: 'Clinic' },
  'nav.store': { en: 'Store', pcm: 'Store' },
  'nav.money': { en: 'Money', pcm: 'Money' },
  'nav.reports': { en: 'Reports', pcm: 'Report' },
  'nav.dashboard': { en: 'Dashboard', pcm: 'Overview' },
  'nav.plan': { en: 'Plan', pcm: 'Plan' },
  'nav.people': { en: 'People', pcm: 'Workers' },
  'nav.settings': { en: 'Settings', pcm: 'Settings' },

  // Login
  'login.who': { en: 'Who are you?', pcm: 'Na who you be?' },
  'login.pin': { en: 'Enter your 4-digit PIN', pcm: 'Put your 4 number PIN' },
  'login.wrong': { en: 'Wrong PIN. Try again.', pcm: 'PIN no correct. Try again.' },
  'login.back': { en: 'Not me', pcm: 'No be me' },

  // Today
  'today.clockIn': { en: 'Clock in', pcm: 'I don come work' },
  'today.clockOut': { en: 'Clock out', pcm: 'I dey go house' },
  'today.clockedIn': { en: 'You are clocked in', pcm: 'You don clock in' },
  'today.tasks': { en: 'Your jobs today', pcm: 'Your work for today' },
  'today.noTasks': { en: 'No jobs assigned yet', pcm: 'Dem never give you work' },
  'today.done': { en: 'Done', pcm: 'I don finish' },
  'today.logHarvest': { en: 'Log harvest', pcm: 'Record wetin I pick' },
  'today.reportProblem': { en: 'Report a problem', pcm: 'Something dey wrong' },
  'today.logWork': { en: 'Log work done', pcm: 'Record work wey I do' },
  'today.checkPlant': { en: 'Check a sick plant', pcm: 'Check plant wey sick' },

  // Harvest
  'harvest.which': { en: 'Which bed did you pick?', pcm: 'Na which bed you pick?' },
  'harvest.howMuch': { en: 'How much did you pick?', pcm: 'How much you pick?' },
  'harvest.crates': { en: 'Crates', pcm: 'Crate' },
  'harvest.kg': { en: 'Kilograms', pcm: 'Kilo' },
  'harvest.blocked': { en: 'Do not pick this bed yet', pcm: 'No pick dis bed yet' },
  'harvest.saved': { en: 'Harvest recorded', pcm: 'Dem don record am' },

  // Diagnosis
  'dx.start': { en: 'What does the plant look like?', pcm: 'Wetin di plant dey look like?' },
  'dx.where': { en: 'Where is the problem?', pcm: 'Na which part get di problem?' },
  'dx.pick': { en: 'Tick everything you can see', pcm: 'Tick everything wey you see' },
  'dx.result': { en: 'What it looks like', pcm: 'Wetin e fit be' },
  'dx.confirm': { en: 'Check this to be sure', pcm: 'Check dis one make you sure' },
  'dx.doNow': { en: 'Do this now', pcm: 'Do dis one now now' },
  'dx.none': { en: 'Nothing matched. Tick a few more things, or call the agronomist.',
    pcm: 'Nothing match. Tick more thing, or call di crop doctor.' },

  // Shared
  'common.save': { en: 'Save', pcm: 'Save am' },
  'common.cancel': { en: 'Cancel', pcm: 'Leave am' },
  'common.next': { en: 'Next', pcm: 'Next' },
  'common.back': { en: 'Back', pcm: 'Go back' },
  'common.offline': { en: 'No network. Your work is saved on this phone and will sync later.',
    pcm: 'Network no dey. Your work dey save for dis phone, e go sync later.' },
  'common.bed': { en: 'Bed', pcm: 'Bed' },
  'common.note': { en: 'Note', pcm: 'Anything you wan talk' },
  'common.photo': { en: 'Add a photo', pcm: 'Snap picture' },
};

let current = 'en';

export function setLang(lang) { current = LANGS[lang] ? lang : 'en'; }
export function getLang() { return current; }

export function t(key, lang = current) {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[lang] || entry.en;
}

/** Pick the right field off a domain object that carries its own Pidgin gloss. */
export function local(obj, field = 'label', lang = current) {
  if (!obj) return '';
  if (lang === 'pcm' && obj.pidgin) return obj.pidgin;
  return obj[field] ?? obj.name ?? '';
}

/** In Pidgin mode, show the English underneath so nothing is lost in translation. */
export function pair(obj, field = 'label', lang = current) {
  const main = local(obj, field, lang);
  const other = lang === 'pcm' ? (obj[field] ?? obj.name ?? '') : (obj.pidgin || '');
  return { main, sub: other && other !== main ? other : '' };
}
