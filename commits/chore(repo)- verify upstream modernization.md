# Verify upstream modernization

Record the 2026-09-24 modernization onto upstream `e4eb9977f0`: which fork commits became which units, which were dropped because upstream covers them, and which fork test cases were replaced and why. Summarize the persistence decisions (canonical upstream migration chain plus a separate fork ledger) and the verification run on a copy of real state, the full repo checks, and the Nix package build.

## Validation Coverage

`scripts/repo-config.test.ts` checks that each commit above upstream has a note.
