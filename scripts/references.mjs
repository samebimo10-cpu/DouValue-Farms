// docs/references.md is generated from rules/sources.json (FR-KNOW-06), so the
// reading list and the app cannot drift apart.
//
//   node scripts/references.mjs          rewrite docs/references.md
//   npm run references                   the same
//
// tests/sources.test.mjs regenerates it in memory and fails if the committed
// file differs, so an edit to the registry without a rerun goes red in CI.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
export const REGISTRY = new URL('rules/sources.json', root);
export const REFERENCES = new URL('docs/references.md', root);

/** Pipes and line breaks would break a table row. */
const cell = (v) => String(v == null || v === '' ? '—' : v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function row(s) {
  const title = s.url ? `[${cell(s.title)}](${String(s.url).replace(/\)/g, '%29')})` : cell(s.title);
  return `| \`${s.id}\` | ${title} | ${cell(s.publisher)} | ${cell(s.kind)} | ${cell(s.region)} `
    + `| ${cell(s.licence)} | ${cell(s.retrieved)} | ${cell((s.covers || []).join(', '))} |`;
}

function table(list) {
  return [
    '| ID | Title | Publisher | Kind | Region | Licence | Retrieved | Covers |',
    '|---|---|---|---|---|---|---|---|',
    ...list.map(row),
  ].join('\n');
}

/** The whole of docs/references.md, from a registry document. Deterministic. */
export function referencesMarkdown(registry) {
  const list = [...((registry && registry.sources) || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bundled = list.filter((s) => s.bundled === true);
  const linked = list.filter((s) => s.bundled !== true);
  const version = (registry && registry.meta && registry.meta.version) || 'unversioned';

  const out = [
    '# DouValue Farm App — References',
    '',
    '<!-- Generated from rules/sources.json by scripts/references.mjs. Do not edit by hand: -->',
    '<!-- change the registry and run `npm run references`. -->',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Generated from | `rules/sources.json` |',
    `| Registry version | ${cell(version)} |`,
    `| Sources | ${list.length} (${bundled.length} bundled, ${linked.length} linked only) |`,
    '| Spec | docs/knowledge-layer.md §2 and §3 (FR-KNOW-00 to FR-KNOW-06) |',
    '',
    'Every outside source the app\'s rules, triage rows and diagnosis cards rest on, listed once. '
      + 'Rules entries name these by ID in their `sources` array, and the Farm Doctor\'s '
      + '"What it looked at" lists the ones behind each answer.',
    '',
    '## Bundled with the app',
    '',
    'A copy ships inside the app, under the licence shown. Non-commercial (NC) material is never bundled (FR-KNOW-02).',
    '',
    bundled.length ? table(bundled) : '_None yet._',
    '',
    '## Linked only',
    '',
    'Read at the link. Nothing from these is copied into the app.',
    '',
    linked.length ? table(linked) : '_None yet._',
    '',
  ];
  return out.join('\n');
}

export function readRegistry() {
  return JSON.parse(readFileSync(REGISTRY, 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(REFERENCES, referencesMarkdown(readRegistry()));
  console.log(`Wrote ${fileURLToPath(REFERENCES)}`);
}
