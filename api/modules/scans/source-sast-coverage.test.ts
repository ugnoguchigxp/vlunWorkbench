import { describe, expect, it } from "vitest";
import { buildScanProfiles } from "./profiles";
import { resolveSourceSastCoverage } from "./source-sast-coverage";

describe("truthful source SAST coverage", () => {
  it("declares Semgrep as a required strict full-scan capability", () => {
    const profile = buildScanProfiles({ optionalAdapterIds: [] }).find(
      (candidate) => candidate.id === "full-security-scan",
    );
    expect(profile?.tools.map((tool) => tool.toolId)).toContain("semgrep");
    expect(profile?.coverageGaps).toEqual([]);
    expect(resolveSourceSastCoverage(profile!)).toMatchObject({
      state: "applicable",
      coverageEffect: "gap",
      limitationCodes: [],
    });
  });

  it("makes Semgrep a required full-scan step when the adapter is enabled", () => {
    const profile = buildScanProfiles({
      optionalAdapterIds: ["semgrep"],
    }).find((candidate) => candidate.id === "full-security-scan");
    const step = profile?.steps?.find(
      (candidate) =>
        candidate.kind === "static_tool" && candidate.toolId === "semgrep",
    );
    expect(step).toMatchObject({
      required: true,
      failurePolicy: "fail_profile",
      options: { config: "curated-sast-v1" },
    });
    expect(profile?.coverageGaps).toEqual([]);
    expect(resolveSourceSastCoverage(profile!)).toMatchObject({
      state: "applicable",
      coverageEffect: "gap",
      stepId: "semgrep",
      limitationCodes: [],
    });
  });

  it("marks source SAST covered only after the required step completes", () => {
    const profile = buildScanProfiles({
      optionalAdapterIds: ["semgrep"],
    }).find((candidate) => candidate.id === "full-security-scan");
    const completed = resolveSourceSastCoverage(profile!, [
      {
        kind: "static_tool",
        toolId: "semgrep",
        toolRunId: "tool-run",
        required: true,
        status: "completed",
        findingCount: 0,
        exitCode: 0,
        error: null,
      },
    ]);
    expect(completed).toMatchObject({
      state: "executed",
      coverageEffect: "covered",
      limitationCodes: [],
    });
  });

  it("keeps a gap when the required Semgrep step fails", () => {
    const profile = buildScanProfiles({
      optionalAdapterIds: ["semgrep"],
    }).find((candidate) => candidate.id === "full-security-scan");
    const failed = resolveSourceSastCoverage(profile!, [
      {
        kind: "static_tool",
        toolId: "semgrep",
        toolRunId: "tool-run",
        required: true,
        status: "failed",
        findingCount: 0,
        exitCode: 2,
        error: "scanner adapter is unavailable",
        reasonCode: "scanner_adapter_runtime_config_missing",
      },
    ]);
    expect(failed).toMatchObject({
      state: "applicable",
      coverageEffect: "gap",
      limitationCodes: [
        "source_sast_not_executed",
        "scanner_adapter_runtime_config_missing",
      ],
    });
  });
});
