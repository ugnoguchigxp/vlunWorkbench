# Maintainership

Ownership is recorded as accountable roles because this repository does not yet
have a verified second maintainer. `unassigned` is intentional evidence of the
current bus-factor risk, not an approval placeholder.

| Domain | Primary role | Backup role | Required review path |
| --- | --- | --- | --- |
| Authentication, authorization, outbound network, secret crypto | Security maintainer | unassigned | Focused boundary tests, critical coverage, strict gate |
| SQLite schema, Writer, backup and migration | Database maintainer | unassigned | Fresh/upgrade fixture, Writer tests, verified backup/restore |
| Scanner runtime, Docker isolation, artifact cleanup | Scanner-runtime maintainer | unassigned | Invocation snapshot, cleanup failure tests, container security |
| Benchmark policy and professional capability evidence | Release-evidence maintainer | unassigned | Corpus hashes, raw/normalized hashes, claim-integrity verifier |
| Web orchestration and browser workflows | Web maintainer | unassigned | Selected Web coverage plus linked Playwright test IDs |
| Release tag, changelog, package and support policy | Release maintainer | unassigned | Same-commit clean-checkout report before immutable tag |

## Onboarding path

1. Read `README.md`, `docs/production-runbook.md`, the security boundary, and
   the local runtime support boundary.
2. Run `bun run bootstrap:check -- --skip-port` and `bun run
   coverage:inventory`.
3. Pick one domain and run its smallest focused test before changing code.
4. Run `bun run verify` for normal changes and `bun run verify:strict` for a
   release candidate.
5. Practice the release drill below without creating or moving a tag.

## Backup maintainer release drill

The drill is complete only when a real backup maintainer independently:

1. creates and verifies a Writer-consistent backup;
2. restores it to an isolated path and passes `PRAGMA integrity_check`;
3. runs fresh and one-version-behind migration readiness;
4. runs the strict and clean-checkout gates on the same commit;
5. verifies that package version, changelog, release evidence and tag agree.

No backup role has completed this drill as of 2026-08-15. Therefore the bus
factor remains one and every backup role above stays `unassigned`.
