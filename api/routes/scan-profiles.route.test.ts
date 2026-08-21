import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createScanProfilesRoute } from "./scan-profiles.route";

describe("Scan Profiles Route", () => {
  const app = new Hono();
  app.route("/", createScanProfilesRoute());

  it("returns scan scope profile variants without raw tool options", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);

    const body = await res.json();
		expect(body.schemaVersion).toBe(2);
		expect(body.catalogEntries).toHaveLength(12);
		expect(body.genericStartCatalogProfileIds).toEqual([
			"change-gate",
			"source-assurance",
			"runtime-passive",
		]);
		expect(body.defaultProfileIds).toEqual({
			full: "source-assurance",
			working_tree: "change-gate",
			commit: "change-gate",
			range: "change-gate",
		});
    expect(body.preflight).toEqual({ schemaVersion: 1, mode: "enforced" });
    const profileIds = body.profiles.map((profile: any) => profile.id);
    expect(profileIds).toEqual(
      expect.arrayContaining([
        "source-baseline",
        "basic-security",
        "dependency-manifest",
        "artifact",
        "full-deep",
        "detailed-security",
        "web-app-baseline",
        "runtime-http-check",
        "full-security-scan",
        "secrets-dependencies-runtime",
      ]),
    );

    const sourceProfile = body.profiles.find(
      (profile: any) => profile.id === "source-baseline",
    );
    expect(sourceProfile.scope).toEqual(
      expect.objectContaining({
        intent: "source",
        includeGenerated: false,
        includeInstalledDependencies: false,
      }),
    );
    expect(sourceProfile.tools[0].options).toBeUndefined();
    expect(sourceProfile.steps[0]).toEqual(
      expect.objectContaining({
        stepId: "gitleaks",
        kind: "static_tool",
        adapter: "gitleaks",
        toolId: "gitleaks",
        displayName: "Gitleaks Secret Detection",
      }),
    );

    const basicProfile = body.profiles.find(
      (profile: any) => profile.id === "basic-security",
    );
    expect(basicProfile.category).toBe("basic");
    expect(basicProfile.tools.map((tool: any) => tool.toolId)).toEqual([
      "gitleaks",
      "osv",
      "trivy",
    ]);

    const deepProfile = body.profiles.find(
      (profile: any) => profile.id === "full-deep",
    );
    expect(deepProfile.category).toBe("detailed");
    expect(deepProfile.scope).toEqual(
      expect.objectContaining({
        intent: "full_deep",
        includeGenerated: true,
        includeInstalledDependencies: true,
        includeVendoredDependencies: true,
      }),
    );

    const detailedProfile = body.profiles.find(
      (profile: any) => profile.id === "detailed-security",
    );
    expect(detailedProfile.category).toBe("detailed");
    expect(detailedProfile.scope.intent).toBe("full_deep");

    const webAppProfile = body.profiles.find(
      (profile: any) => profile.id === "web-app-baseline",
    );
    expect(webAppProfile.steps.map((step: any) => step.kind)).toEqual([
      "static_tool",
      "static_tool",
      "dast",
    ]);
    const dastStep = webAppProfile.steps.find(
      (step: any) => step.kind === "dast",
    );
    expect(dastStep).toEqual(
      expect.objectContaining({
        stepId: "dast:web-passive-standard",
        adapter: "web-passive-standard",
        profileId: "web-passive-standard",
        target: { mode: "auto_project_start" },
        failurePolicy: "warn_and_continue",
      }),
    );
    expect(dastStep.options).toBeUndefined();

    const fullProfile = body.profiles.find(
      (profile: any) => profile.id === "full-security-scan",
    );
    expect(fullProfile.coverageGaps).toBeUndefined();
    expect(fullProfile.coverageMeasurement).toBe("not_measured");
    expect(fullProfile.capabilityRequirements).toEqual(
      expect.arrayContaining([
        { capabilityId: "secret_detection", requirement: "required" },
        { capabilityId: "source_sast", requirement: "required_if_applicable" },
      ]),
    );
    expect(fullProfile.strictness).toBe("strict");
    expect(fullProfile.steps.map((step: any) => step.stepId)).toEqual([
      "gitleaks",
      "osv",
      "trivy",
      "semgrep",
      "sbom_export:trivy",
      "dast:web-passive-standard",
      "runtime_scanner:nuclei-safe",
      "runtime_scanner:zap-baseline",
      "api_schema_scan:schemathesis",
    ]);
    expect(fullProfile.steps.find((step: any) => step.stepId === "trivy")).toEqual(
      expect.objectContaining({
        kind: "static_tool",
        adapter: "trivy",
        displayName: "Trivy Deep Filesystem Scanner",
      }),
    );
  });
});
