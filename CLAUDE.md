# DouValue Farm App

This folder (douvalue/) is the farm app: web/, server/, tests/, brand/.
The rest of the repo is a separate stock-selector project; do not change it for farm work.

- Requirements: docs/requirements.md (v1.4). Every requirement has an ID; cite it in commits and tests.
- Rules: rules/douvalue_rules_rev5_1.json is the source of truth. Both web/ and server/ load it from there; do not copy it.
  docs/build-rules.md is the readable copy; keep both in sync.
- Precedence: rules JSON > docs/build-rules.md > the PDFs in docs/source/.
- Extend the existing app; do not rewrite it.
- Never weaken a gate, rotation, PHI/REI or Farm Doctor limit without an explicit instruction.
