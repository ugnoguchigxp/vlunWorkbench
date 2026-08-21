import { describe, expect, it } from "vitest";
import type { ScanPreflightResult } from "../../../../shared/schemas/scan-preflight.schema";
import { buildScanProfiles } from "../profiles";
import {
  applyExecutionPlanToSteps,
  applyStrictProfileRequirements,
  buildScanExecutionPlan,
  executionPlanBlocks,
} from "./scan-execution-plan-builder";

const DIGEST = `sha256:${"a".repeat(64)}`;

function preflight(params: {
  profileId: string;
  stepId: string;
  status: "ready" | "blocked" | "not_applicable";
}): ScanPreflightResult {
  const blocked = params.status === "blocked";
  return {
    schemaVersion: 1,
    projectId: "project-1",
    profileId: params.profileId,
    sourceRevision: null,
		sourceState: "unknown",
    mode: "enforced",
    status: blocked ? "blocked" : "ready",
    createdAt: "2026-08-21T00:00:00.000Z",
    checks: [
      {
        id: `${params.stepId}:check`,
        stepId: params.stepId,
        kind: "api_schema_applicability",
        required: true,
        status: params.status,
        reasonCode: blocked ? "scanner_binary_unavailable" : null,
        action: blocked ? "configure_api_schema" : null,
        scannerId: null,
        observedVersion: null,
        expectedVersion: null,
        expectedDigest: null,
        observedDigest: null,
        dataState: null,
        dataGeneratedAt: null,
        evidenceRefs: ["test:evidence"],
      },
    ],
    summary: {
      ready: blocked ? 0 : 1,
      blockedRequired: blocked ? 1 : 0,
      blockedOptional: 0,
      notApplicable: params.status === "not_applicable" ? 1 : 0,
    },
    limitationCodes: blocked ? ["scanner_binary_unavailable"] : [],
    binding: {
      resolvedProfileHash: DIGEST,
      executionHash: DIGEST,
      scannerManifestHash: DIGEST,
      scannerVersionsHash: DIGEST,
      dockerImagesHash: null,
      targetPlanHash: null,
      sourceRevisionHash: null,
    },
    bindingHash: DIGEST,
    preflightHash: DIGEST,
  };
}

describe("scan execution plan compiler", () => {
  it("upgrades strict applicable steps to required and blocks missing readiness", () => {
    const profile = buildScanProfiles().find(
      (candidate) => candidate.id === "api-schema-readonly",
    )!;
    const steps = applyStrictProfileRequirements(profile, profile.steps!);
    const plan = buildScanExecutionPlan({
      scanRunId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      profile,
      steps,
      preflight: preflight({
        profileId: profile.id,
        stepId: "api_schema_scan:schemathesis",
        status: "blocked",
      }),
    });
    expect(plan.strictness).toBe("strict");
    expect(plan.steps[0]).toMatchObject({
      required: true,
      applicability: "applicable",
      readiness: "blocked",
    });
    expect(executionPlanBlocks(plan)).toBe(true);
    expect(applyExecutionPlanToSteps(steps, plan)[0]).toMatchObject({
      required: true,
      failurePolicy: "fail_profile",
    });
  });

  it("allows a strict API capability to be explicitly not applicable", () => {
    const profile = buildScanProfiles().find(
      (candidate) => candidate.id === "api-schema-readonly",
    )!;
    const plan = buildScanExecutionPlan({
      scanRunId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      profile,
      steps: applyStrictProfileRequirements(profile, profile.steps!),
      preflight: preflight({
        profileId: profile.id,
        stepId: "api_schema_scan:schemathesis",
        status: "not_applicable",
      }),
    });
    expect(plan.steps[0]).toMatchObject({
      applicability: "not_applicable",
      required: false,
    });
    expect(executionPlanBlocks(plan)).toBe(false);
  });

  it("fails closed when a strict step has no applicability evidence", () => {
    const profile = buildScanProfiles().find(
      (candidate) => candidate.id === "api-schema-readonly",
    )!;
    const readyPreflight = preflight({
      profileId: profile.id,
      stepId: "unrelated-step",
      status: "ready",
    });
    const plan = buildScanExecutionPlan({
      scanRunId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      profile,
      steps: applyStrictProfileRequirements(profile, profile.steps!),
      preflight: readyPreflight,
    });
    expect(plan.steps[0]).toMatchObject({
      required: true,
      applicability: "unknown",
      readiness: "unchecked",
    });
    expect(executionPlanBlocks(plan)).toBe(true);
  });

  it("keeps the preview/start plan hash independent of the run row identity", () => {
    const profile = buildScanProfiles().find(
      (candidate) => candidate.id === "api-schema-readonly",
    )!;
    const input = {
      projectId: "00000000-0000-4000-8000-000000000002",
      profile,
      steps: applyStrictProfileRequirements(profile, profile.steps!),
      preflight: preflight({
        profileId: profile.id,
        stepId: "api_schema_scan:schemathesis",
        status: "not_applicable",
      }),
    };
    const preview = buildScanExecutionPlan({
      ...input,
      scanRunId: "00000000-0000-4000-8000-000000000001",
    });
    const started = buildScanExecutionPlan({
      ...input,
      scanRunId: "00000000-0000-4000-8000-000000000003",
    });
    expect(started.planHash).toBe(preview.planHash);
  });

	it("keeps the plan hash stable across equivalent preflight timestamps", () => {
		const profile = buildScanProfiles().find(
			(candidate) => candidate.id === "api-schema-readonly",
		)!;
		const firstPreflight = preflight({
			profileId: profile.id,
			stepId: "api_schema_scan:schemathesis",
			status: "not_applicable",
		});
		const secondPreflight = {
			...firstPreflight,
			createdAt: "2026-08-21T00:01:00.000Z",
			preflightHash: `sha256:${"b".repeat(64)}`,
		};
		const input = {
			scanRunId: "00000000-0000-4000-8000-000000000001",
			projectId: "00000000-0000-4000-8000-000000000002",
			profile,
			steps: applyStrictProfileRequirements(profile, profile.steps!),
		};
		const preview = buildScanExecutionPlan({
			...input,
			preflight: firstPreflight,
		});
		const started = buildScanExecutionPlan({
			...input,
			preflight: secondPreflight,
		});

		expect(started.preflightHash).not.toBe(preview.preflightHash);
		expect(started.planHash).toBe(preview.planHash);
	});

	it("binds an immutable source snapshot digest into the plan hash", () => {
		const profile = buildScanProfiles().find(
			(candidate) => candidate.id === "api-schema-readonly",
		)!;
		const input = {
			scanRunId: "00000000-0000-4000-8000-000000000001",
			projectId: "00000000-0000-4000-8000-000000000002",
			profile,
			steps: applyStrictProfileRequirements(profile, profile.steps!),
			preflight: preflight({
				profileId: profile.id,
				stepId: "api_schema_scan:schemathesis",
				status: "not_applicable" as const,
			}),
		};
		const first = buildScanExecutionPlan({
			...input,
			sourceSnapshotDigest: "a".repeat(64),
		});
		const second = buildScanExecutionPlan({
			...input,
			sourceSnapshotDigest: "b".repeat(64),
		});

		expect(first.sourceSnapshotDigest).toBe("a".repeat(64));
		expect(second.planHash).not.toBe(first.planHash);
	});

	it("writes v2 only when explicitly selected and preserves immutable bindings", () => {
		const profile = buildScanProfiles().find(
			(candidate) => candidate.id === "full-security-scan",
		)!;
		const v1 = buildScanExecutionPlan({
			scanRunId: "00000000-0000-4000-8000-000000000001",
			projectId: "00000000-0000-4000-8000-000000000002",
			profile,
			steps: profile.steps!,
			preflight: preflight({ profileId: profile.id, stepId: "gitleaks", status: "ready" }),
		});
		const v2 = buildScanExecutionPlan({
			scanRunId: "00000000-0000-4000-8000-000000000001",
			projectId: "00000000-0000-4000-8000-000000000002",
			profile,
			steps: profile.steps!,
			preflight: preflight({ profileId: profile.id, stepId: "gitleaks", status: "ready" }),
			schemaVersion: 2,
		});

		expect(v1.schemaVersion).toBe(1);
		expect(v2).toMatchObject({
			schemaVersion: 2,
			capabilityRequirements: expect.arrayContaining([
				{ capabilityId: "secret_detection", requirement: "required" },
			]),
			steps: expect.arrayContaining([
					expect.objectContaining({
						stepId: "gitleaks",
						cleanupRequirement: "not_required",
						budget: { timeoutSec: profile.defaultTimeoutSec, maxRequests: null },
						inputBindingHash: expect.stringMatching(/^sha256:/),
						policyHash: expect.stringMatching(/^sha256:/),
				}),
			]),
		});
		expect(v2.planHash).not.toBe(v1.planHash);
	});

	it("requires and persists a runtime isolation envelope for v3", () => {
		const profile = buildScanProfiles().find(
			(candidate) => candidate.id === "runtime-web-safe",
		)!;
		const input = {
			scanRunId: "00000000-0000-4000-8000-000000000001",
			projectId: "00000000-0000-4000-8000-000000000002",
			profile,
			steps: profile.steps!,
			preflight: preflight({
				profileId: profile.id,
				stepId: "dast:standard",
				status: "ready",
			}),
		};
		expect(() => buildScanExecutionPlan({ ...input, schemaVersion: 3 })).toThrow(
			"runtime_isolation_plan_required",
		);
		const plan = buildScanExecutionPlan({
			...input,
			schemaVersion: 3,
			runtimeIsolation: {
				planHash: DIGEST,
				qualificationHash: DIGEST,
				sourceSnapshotDigest: DIGEST,
				projectionDigest: DIGEST,
				recipeHash: DIGEST,
				dependencyLockDigest: DIGEST,
				dockerDaemonIdentityHash: DIGEST,
				imageDigests: { node: DIGEST },
				databaseMode: "none",
			},
		});
		expect(plan).toMatchObject({ schemaVersion: 3, runtimeIsolation: { planHash: DIGEST } });
	});
});
