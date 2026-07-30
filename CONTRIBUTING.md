# Contributing

Use Bun 1.3.14 and install dependencies with:

```bash
bun install --frozen-lockfile
```

Before submitting a change, run:

```bash
bun run verify:strict
git diff --check
```

`bun run verify` is the fast local gate. `bun run verify:strict` is the
closeout gate and additionally runs Web/critical coverage and browser E2E.

All `*.test.ts` and `*.test.tsx` files are discovered automatically and must
execute exactly once. API/Bun tests run in isolated processes to prevent module
mock contamination. Do not skip or quarantine a failing test without a linked
owner and expiry date.

Runtime databases, logs, reports, scan output, and reproduction output belong
under ignored `data/` or `artifacts/` paths and must not be committed. Permanent
test inputs belong in an explicit fixture directory near the test or under
`tests/fixtures/`.

Database schema changes require a forward migration in `drizzle/`, repository
tests, and a documented backup/restore path. Never put credentials, real source
snippets, or user-specific absolute paths in fixtures, snapshots, or logs.

Security-affecting dependency overrides must include an exact patched version.
Review them when the owning direct dependency is upgraded and record notable
changes in `CHANGELOG.md`.
