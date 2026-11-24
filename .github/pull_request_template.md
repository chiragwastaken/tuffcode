## Linked issue

Closes #

## Summary

What changed and why, in two or three sentences.

## Changes

- 

## Evidence

Commands run and their result. Paste the tail, not a claim.

```powershell
pnpm check
pnpm test
pnpm test:e2e
```

## Risk

What could break, and how it was checked. Write "low" only with a reason.

## Audit

Path to `.tuffcode-ops/audits/<batch>-<agent>.md` with files, commands, output tails and
unverified items.

## Checklist

- [ ] One logical change, files staged explicitly
- [ ] No em dashes or en dashes
- [ ] Tests cover the behavior, not the implementation
- [ ] No stubs, TODOs, or silent fallbacks
- [ ] Markdown docs not edited by contributors (report doc changes here instead)
- [ ] Audit written
