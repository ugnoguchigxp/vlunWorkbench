# Security Intelligence NightWorkers Integrity Smoke Decision

Status: DRAFT — no rollout decision has been made

Decision date: `<YYYY-MM-DD>`

Integrity evidence: `./evidence/<completed-integrity-evidence>.json`

Contract version: `1`

## Decision

Choose exactly one decision for each capability after validating the completed evidence artifact.
Do not collapse unrelated capabilities into one rollout decision.

| Capability | Decision | Evidence refs | Rationale |
| --- | --- | --- | --- |
| Assessment consumer | `<GO \| ITERATE \| STOP>` | `<refs>` | `<summary>` |
| Post-assessment workspace grant | `<GO \| ITERATE \| STOP>` | `<refs>` | `<summary>` |
| Candidate export | `<GO \| ITERATE \| STOP>` | `<refs>` | `<summary>` |
| Feedback export | `<GO \| ITERATE \| STOP>` | `<refs>` | `<summary>` |
| Shadow retrieval | `<GO \| ITERATE \| STOP>` | `<refs>` | `<summary>` |

`GO` means eligible for a later controlled activation change. It does not authorize default ON.

## Evidence gate

| Gate | Required | Observed | Result |
| --- | ---: | ---: | --- |
| Cross-repository fixture digests recorded and aligned | 5 | `<value>` | `<PASS/FAIL>` |
| Authoritative implementation Runs | exactly 1 | `<value>` | `<PASS/FAIL>` |
| Pre → contract → post → judgment lifecycle | complete on the same Run | `<value>` | `<PASS/FAIL>` |
| Secondary runtime lane | adapter/tool contract verified | `<value>` | `<PASS/FAIL>` |
| Wrong project/revision bindings | 0 | `<value>` | `<PASS/FAIL>` |
| Wrong evidence subject accepted | 0 | `<value>` | `<PASS/FAIL>` |
| Cross-Run evidence accepted | 0 | `<value>` | `<PASS/FAIL>` |
| Secret or absolute-path leaks | 0 | `<value>` | `<PASS/FAIL>` |
| Required failures shown as success | 0 | `<value>` | `<PASS/FAIL>` |
| Unavailable results shown as success | 0 | `<value>` | `<PASS/FAIL>` |
| Evidence resolution rate | 100% | `<value>` | `<PASS/FAIL>` |
| Contract parse failures | 0 | `<value>` | `<PASS/FAIL>` |
| Stage 3 shadow isolation checks | all pass | `<value>` | `<PASS/FAIL>` |
| Rollback drill | successful | `<value>` | `<PASS/FAIL>` |

## Usefulness and cost

- Assessment build latency: `<value>` ms
- Endpoint requests / unexpected errors: `<value>` / `<value>`
- Payload size: `<value>` bytes
- Declaration scope: `<verified_repository_declarations | transport_integrity_only>`
- Stage 3 shadow observations: `<summary>`

These are operational observations from one integrity Run, not a baseline-versus-enabled
performance comparison.

## Rationale

`<Explain each capability decision using only linked versioned evidence. Do not include source text, secrets, or absolute filesystem paths.>`

## Rollback and follow-up

- NightWorkers assessment / post-assessment flags after smoke: `OFF`
- candidate / feedback / shadow flags after smoke: `OFF`
- vulnWorkbench endpoint flag after smoke: `OFF`
- Project allowlist after smoke: `empty`
- Default activation authorized by this decision: `NO`
- Existing NightWorkers scan API regression check: `<PASS/FAIL>`
- Follow-up owner and issue: `<reference>`
