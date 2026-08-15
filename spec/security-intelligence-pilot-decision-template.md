# Security Intelligence NightWorkers Pilot Decision

Status: DRAFT — no rollout decision has been made

Decision date: `<YYYY-MM-DD>`

Pilot evidence: `./evidence/<completed-pilot-evidence>.json`

Contract version: `1`

## Decision

Choose exactly one after validating the completed evidence artifact:

- `GO`: integrity gates pass and Dependency usefulness improves. Keep default OFF; propose a separate activation PR.
- `ITERATE`: no integrity incident occurred, but usefulness, latency, reliability, or Authorization quality needs work.
- `STOP`: an integrity, privacy, evidence-resolution, or required-failure presentation incident occurred.

Selected decision: `<GO | ITERATE | STOP>`

## Evidence gate

| Gate | Required | Observed | Result |
| --- | ---: | ---: | --- |
| Valid paired samples | 10 or more | `<value>` | `<PASS/FAIL>` |
| Wrong project/revision bindings | 0 | `<value>` | `<PASS/FAIL>` |
| Secret or absolute-path leaks | 0 | `<value>` | `<PASS/FAIL>` |
| Required failures shown as success | 0 | `<value>` | `<PASS/FAIL>` |
| Evidence resolution rate | 100% | `<value>` | `<PASS/FAIL>` |
| Contract parse failures | 0 | `<value>` | `<PASS/FAIL>` |
| Rollback drill | successful | `<value>` | `<PASS/FAIL>` |

## Usefulness and cost

- Operator action rate: `<value>`
- Baseline median time-to-evidence: `<value>` seconds
- Assessment median time-to-evidence: `<value>` seconds
- Assessment build latency p50 / p95: `<value>` / `<value>` ms
- Endpoint error rate: `<value>`
- Payload size p95: `<value>` bytes
- Authorization shadow observations: `<summary or unavailable>`

## Rationale

`<Explain the decision using only the linked versioned evidence. Do not include source text, secrets, or absolute filesystem paths.>`

## Rollback and follow-up

- NightWorkers consumer flag after pilot: `OFF`
- vulnWorkbench endpoint flag after pilot: `OFF`
- Project allowlist after pilot: `empty`
- Existing NightWorkers scan API regression check: `<PASS/FAIL>`
- Follow-up owner and issue: `<reference>`
