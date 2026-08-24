import { describe, expect, it } from "vitest";
import { buildScanProfiles } from "../modules/scans/profiles";
import { buildScanProfileDryRun } from "./scan-profile-dry-run";

const DIGEST = `sha256:${"a".repeat(64)}`;

describe("scan profile dry run", () => {
  it("keeps the core dry run valid when optional Semgrep is disabled", () => {
    const profiles = buildScanProfiles({ optionalAdapterIds: [] });
    expect(profiles.some((candidate) => candidate.id === "semgrep-baseline")).toBe(
      false,
    );
    const profile = profiles.find(
      (candidate) => candidate.id === "full-security-scan",
    )!;
    const result = buildScanProfileDryRun({
      profile,
      scanTarget: { kind: "full" },
      finalReportEnabled: true,
      automatedDiagnosticEnabled: true,
    });
    expect(result.coverageGaps).toBeUndefined();
    expect(result.coverageMeasurement).toBe("not_measured");
    expect(result.capabilityRequirements).toEqual(
      expect.arrayContaining([
        { capabilityId: "secret_detection", requirement: "required" },
      ]),
    );
    expect(result.resolvedProfileHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.capabilityRequirements).toContainEqual({
      capabilityId: "source_sast",
      requirement: "advisory",
    });
    expect(result.stepOrder).not.toContain("semgrep");
  });

  it("adds Semgrep when the optional adapter is preferred", () => {
    const profiles = buildScanProfiles({
      optionalAdapterIds: ["semgrep"],
    });
    expect(profiles.some((candidate) => candidate.id === "semgrep-baseline")).toBe(
      true,
    );
    const profile = profiles.find(
      (candidate) => candidate.id === "full-security-scan",
    )!;
    const result = buildScanProfileDryRun({
      profile,
      scanTarget: { kind: "full" },
      finalReportEnabled: true,
      automatedDiagnosticEnabled: true,
    });
    expect(result.coverageGaps).toBeUndefined();
    expect(result.coverageMeasurement).toBe("not_measured");
    expect(result.stepOrder).toContain("semgrep");
  });

  it("returns the server preflight and rejects a changed binding", () => {
    const profile = buildScanProfiles({ optionalAdapterIds: [] }).find(
      (candidate) => candidate.id === "baseline",
    )!;
    const preflight = {
      schemaVersion: 1 as const,
      projectId: "project-1",
      profileId: "baseline",
      sourceRevision: null,
		sourceState: "unknown" as const,
      mode: "shadow" as const,
      status: "ready" as const,
      createdAt: "2026-08-16T00:00:00.000Z",
      checks: [],
      summary: {
        ready: 0,
        blockedRequired: 0,
        blockedOptional: 0,
        notApplicable: 0,
      },
      limitationCodes: [],
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
    const result = buildScanProfileDryRun({
      profile,
      scanTarget: { kind: "full" },
      finalReportEnabled: true,
      automatedDiagnosticEnabled: true,
      preflight,
    });
    expect(result.preflight).toEqual(preflight);

    const changed = buildScanProfileDryRun({
      profile,
      scanTarget: { kind: "full" },
      finalReportEnabled: true,
      automatedDiagnosticEnabled: true,
      preflight,
      expectedPreflightBindingHash: `sha256:${"b".repeat(64)}`,
    });
    expect(changed).toMatchObject({
      ok: false,
      message: expect.stringContaining("preflight_changed"),
    });
  });
});
