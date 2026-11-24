# Contributing

Tuffcode is Windows-first and local-first. Contributions follow the same standards the project
uses for its own releases: measurable, auditable, and small.

## Issues

Every issue must be workable without a conversation. Use the forms in
`.github/ISSUE_TEMPLATE/` (bug, feature, performance). Required sections:

- Summary: the problem in one or two sentences.
- Context: why it matters and the current behavior.
- Scope: what is in, and explicitly what is out.
- Acceptance criteria: checkable statements, each with the command or measurement that proves it.
- Verification: the commands or steps a reviewer will run.

Bug issues also need steps to reproduce, expected, actual with evidence, and the version and
build. Performance issues also need a measurement table (measured value, budget, status) and the
machine used. Feature issues also need the problem, the simplest proposed solution, and the
alternatives considered.

Title prefixes: `bug:`, `feat:`, `perf:`, `chore:`. Labels: one `area:*` and one `priority:*`.
Blank issues are disabled; security reports go to private advisories.

## Pull requests

- Branch from `main` as `feat/<slice>` or `fix/<slice>`. One logical change per PR.
- Link the issue with `Closes #N` and fill the PR template: summary, changes, evidence with
  command tails, risk, audit path, checklist.
- Stage only the files you changed, with explicit paths.
- A reviewer other than the author reads the diff. Squash merge. Never force push `main`.
- CI must be green: `pnpm check` and `pnpm test`. If GitHub Actions does not fire, record local
  `pnpm check`, `pnpm test` and `pnpm test:e2e` tails in the PR and treat the post-merge main run
  as the check.
- No em dashes or en dashes anywhere. `pnpm check:emdash` enforces this, file names included.
- No stubs, TODOs, silent fallbacks, or weakened tests.
- Do not commit local material: `Chief/`, `Noticing/`, `references/`, `others/`, `decisions.md`,
  `PRD.md`, `spec.md`, `spec-ui.md`, `plan.md`, `WORKFLOW.md`, `WHAT-HAPPENED-TILL-NOW.md`,
  `.tuffcode-ops/`, `.env*`.

## Audits

Every change ships with an audit at `.tuffcode-ops/audits/<batch>-<agent>.md`: files touched,
exact commands and output tails, deviations, and what was not verified. No audit, no merge.

## Documentation

Only the maintainer edits `README.md`, `AGENTS.md`, `CHANGELOG.md`, `docs/`, and the local
planning documents. Contributors report doc changes in the PR body.

## Releases

- `CHANGELOG.md` has a dated section for the version, grouped by area, with Known issues.
- Tag `vX.Y.Z` from green `main`. The release workflow builds the NSIS installer and uploads the
  exe, `latest.yml`, and the blockmap, and fails verification when any asset is missing.
- Verify from GitHub, not a local build: download the exe, silent install to a temp directory,
  launch with a fresh `TUFFCODE_HOME` and `LOCALAPPDATA`, confirm `/health` reports the tagged
  version, uninstall, and confirm no processes or install directory remain.
- Record the release URL, asset sizes, and the verification result in the release notes.

## Verification commands

```powershell
pnpm install
pnpm check        # typecheck, lint, emdash
pnpm test         # Vitest unit and integration
pnpm test:e2e     # Playwright Electron
pnpm build:server
pnpm build:win    # NSIS installer
```
