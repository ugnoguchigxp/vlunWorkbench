import { createStaticScannerAdapterRegistry } from "../static-scanner-adapters";
import { describe, expect, it } from "vitest";
import { buildScanProfiles } from "../profiles";
import { resolveSourceSastCoverage } from "./source-sast-coverage";
import { resolveSourceSastApplicability } from "./source-sast-applicability";

describe("truthful source SAST coverage", () => {
	it("keeps a truthful gap when Semgrep is disabled", () => {
    const profile = buildScanProfiles({ optionalAdapterIds: [] }).find(
      (candidate) => candidate.id === "full-security-scan",
    );
		expect(profile?.tools.map((tool) => tool.toolId)).not.toContain("semgrep");
		expect(profile?.coverageGaps).toContain(
			"source_sast_adapter_not_available",
		);
    expect(profile?.capabilityRequirements).toContainEqual({
      capabilityId: "source_sast",
			requirement: "advisory",
    });
    expect(resolveSourceSastCoverage(profile!)).toMatchObject({
      state: "applicable",
      coverageEffect: "gap",
			limitationCodes: ["source_sast_not_executed"],
    });
  });

	it("adds Semgrep as a preferred advisory step when enabled", () => {
    const profile = buildScanProfiles({
      optionalAdapterIds: ["semgrep"],
    }).find((candidate) => candidate.id === "full-security-scan");
    const step = profile?.steps?.find(
      (candidate) =>
        candidate.kind === "static_tool" && candidate.toolId === "semgrep",
    );
    expect(step).toMatchObject({
			required: false,
			requirement: "advisory",
			failurePolicy: "warn_and_continue",
      options: { config: "curated-sast-v1" },
    });
		expect(profile?.coverageGaps).toEqual([]);
    expect(resolveSourceSastCoverage(profile!)).toMatchObject({
      state: "applicable",
      coverageEffect: "gap",
      stepId: "semgrep",
      limitationCodes: ["source_sast_not_executed"],
    });
  });

	it("marks source SAST covered only after the preferred step completes", () => {
    const profile = buildScanProfiles({
      optionalAdapterIds: ["semgrep"],
    }).find((candidate) => candidate.id === "full-security-scan");
    const completed = resolveSourceSastCoverage(profile!, [
      {
        kind: "static_tool",
        toolId: "semgrep",
        toolRunId: "tool-run",
			required: false,
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

	it("records an evidence-based N/A separately from an unexecuted scan", () => {
		const profile = buildScanProfiles({ optionalAdapterIds: ["semgrep"] }).find(
			(candidate) => candidate.id === "full-security-scan",
		);
		expect(
			resolveSourceSastCoverage(
				profile!,
				[],
				resolveSourceSastApplicability({
					hasSourceFiles: false,
					hasSupportedLanguage: false,
					rulesetAvailable: true,
					adapterAvailable: true,
				}),
			),
		).toMatchObject({
			applicability: "not_applicable",
			state: "not_applicable",
			coverageEffect: "covered",
			limitationCodes: ["source_sast_no_supported_files"],
		});
	});

	it("keeps a gap when the preferred Semgrep step fails", () => {
    const profile = buildScanProfiles({
      optionalAdapterIds: ["semgrep"],
    }).find((candidate) => candidate.id === "full-security-scan");
    const failed = resolveSourceSastCoverage(profile!, [
      {
        kind: "static_tool",
        toolId: "semgrep",
        toolRunId: "tool-run",
			required: false,
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

it("derives a new SAST adapter's coverage without tool-specific branches", () => {
  const id = "coverage-fixture-sast";
  const registry = createStaticScannerAdapterRegistry();
  if (!registry.has(id)) {
    registry.register({
      ...registry.require("semgrep"),
      manifest: {
        ...registry.require("semgrep").manifest,
        id,
        capabilities: ["source_sast"],
        sourceSastRulesetId: "fixture-rules-v1",
      },
    });
  }
  const profile = buildScanProfiles({ optionalAdapterIds: ["semgrep"] }).find((entry) => entry.id === "full-security-scan")!;
  const customProfile = { ...profile, steps: [{ kind: "static_tool", toolId: id, required: true }] } as typeof profile;
  expect(resolveSourceSastCoverage(customProfile, undefined, undefined, registry)).toMatchObject({ coverageEffect: "gap", engine: id });
  expect(resolveSourceSastCoverage(customProfile, [{ kind: "static_tool", toolId: id, status: "completed" } as never], undefined, registry)).toMatchObject({ coverageEffect: "covered", engine: id, stepId: id, rulesetId: "fixture-rules-v1" });
});
