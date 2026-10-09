# DouValue Farm App — Simplification Pass: what moved

| Field | Value |
|---|---|
| Spec | `docs/simplify.md` (FR-SIMP-01 to FR-SIMP-08) |
| Screens | One file per screen in this folder, `01-home.md` to `08-gates.md`, each added by its own commit |
| Tests | `tests/simplify-NN-<screen>.test.mjs` (every move, by its new location) and `tests/simplify-NN-<screen>-360.test.mjs` (the main action at 360 px, in Chrome); `tests/simplify-report.test.mjs` checks these files |

Each screen of the pass is one commit, in the order of `docs/simplify.md` §4, so any one can be reverted on its own. Every element on the screen is listed with its rating from §1:

1. **Do I act on this now?** — kept, largest on the screen
2. **Do I need it to finish this task?** — kept, smaller
3. **Would I go looking for it?** — one tap away, behind a named link or disclosure
4. **Is it here because the app knows it?** — moved off the field screens

Nothing is deleted (FR-SIMP-01) and no record loses a field (FR-SIMP-02): the pass changes screens, not data. A moved element carries `data-moved="<screen>.<element>"` where it landed, so the tests can find it. A disclosure (`▸ Why this matters`) is one tap and works with no signal.

"Main action" is what FR-SIMP-08 measures: it carries `data-main-action` and must be on screen, not under the tab bar, at 360 × 740 with nothing scrolled.
