# Phase 46 Release Readiness Evidence

Date: 2026-07-24

Status: **CONDITIONAL GO — clean-checkout CI and final commit SHA pending**

This report records the local release rehearsal for the current Phase 46
working tree. The source state is not yet represented by a commit, so
`f681bb616fe1f1d022f87c3b8f6ea2393b2bf0b4` is only the implementation
baseline, not the final release commit.

## Local release gates

| Gate | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS; 590 packages checked, no changes |
| `bun run bootstrap` | PASS; 15 migrations present, existing admin preserved |
| `bun run bootstrap:check -- --skip-port` | PASS |
| `bun run verify` | PASS |
| test inventory | PASS; 156 files, 20 Vitest and 136 Bun, no duplicates |
| web coverage | PASS; 91.90% statements, 81.15% branches, 93.97% lines |
| security-critical coverage | PASS; configured per-file thresholds satisfied |
| browser E2E / accessibility | PASS; 3 Chromium scenarios |
| dependency audit policy | PASS; 0 blocking advisories |
| tracked runtime artifacts | PASS; 0 |
| bundle budget | PASS; initial JS 21,124 gzip bytes, initial CSS 27,557 gzip bytes |
| Git history secret scan | PASS; 42 commits scanned, no leaks |
| P0/P1 source TODO search | PASS; no open P0/P1 TODO marker |

The largest generated JavaScript chunk is 800,711 bytes. It remains below the
current staged limit of 820,000 bytes but above the 500,000-byte target.

## Database migration and recovery rehearsal

The pre-migration database had 14 legacy migration records without checksums.
Backup integrity verification initially exposed that the verifier required a
new `checksum` column even for a legacy backup. The verifier now detects the
legacy table shape, reports unchecked legacy records explicitly, and still
rejects unknown migration filenames.

Results:

- pre-migration backup: integrity PASS; 14 known legacy migrations;
- migration `0015_llm_secret_encryption.sql`: applied successfully;
- plaintext LLM secret dry run: 0 legacy plaintext rows;
- post-migration backup: integrity PASS;
- post-migration history: 15 of 15 migration checksums verified;
- representative record counts matched before and after migration.

The rehearsal backup is temporary local evidence and is not committed.

## Container supply-chain rehearsal

Images:

- toolbox:
  `sha256:ae0676a598141bf630c6f9b0202260133cdc84f0fb2a107c4cd126e6a9ce65ce`
- dynamic:
  `sha256:93fe4665e118fc03e98765c724ca1d153432a2a74e8a8020e7bfc0c6b9c8fe51`

Both images built successfully through the repository build scripts. CycloneDX
SBOMs were generated outside the repository:

- toolbox SBOM SHA-256:
  `2f0a5a1db18d7fccf226efada4f245278cc5fbf99bd5539d66dbb17b50903bd6`
- dynamic SBOM SHA-256:
  `12bded4acbd064eb1044da85f3818ef1f3efd448b5cb4ae527823044f85bc4c2`

High/Critical image scans pass after applying the four scoped, owned, and
time-bounded exceptions in `.trivyignore.yaml`. The exception rationale and
2026-10-24 expiry are documented in `spec/third-party-scanners.md`.

The direct Docker-only Trivy source-build stage exceeded the local Docker
Desktop memory limit. The repository's checksum-verified host build path
completed and produced the toolbox image. The clean Ubuntu CI container build
must still confirm the Docker-only path.

## Security scenario coverage

The release suite covers:

- allowed-root, sibling-prefix, traversal, and symlink project path rejection;
- member/admin boundaries for project registration, folder selection, settings,
  health actions, and shared source mutation;
- outbound URL, DNS, redirect, response-size, and credential-binding policy;
- encrypted secret round-trip and endpoint identity binding;
- untrusted forwarded-header rejection and enforcing production CSP;
- exactly-once test inventory;
- backup integrity and migration history validation;
- browser login accessibility and admin/member behavior.

## Remaining release blocker

The Phase 46 working tree must be committed and the pinned GitHub Actions
workflows must pass from that clean commit. After CI succeeds, replace the
baseline SHA above with the final commit SHA and change this decision from
`CONDITIONAL GO` to `GO`.
