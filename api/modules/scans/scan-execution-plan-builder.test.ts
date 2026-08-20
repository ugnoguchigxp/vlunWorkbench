import { describe, expect, it } from "vitest";
import type { ScanPreflightResult } from "../../../shared/schemas/scan-preflight.schema";
import { buildScanProfiles } from "./profiles";
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
});
