import { describe, expect, it, vi } from "vitest";
import type { ScanProfile } from "../../../shared/schemas/scan-profile.schema";
import { recordScannerE2EFailureObservation } from "../../testing/scanner-e2e-failure-observation";
import { buildScanProfiles } from "./profiles";
import {
  preflightBlocksExecution,
	resolveScanPreflightMode,
  runScanPreflight,
  type ScanPreflightDependencies,
} from "./scan-preflight";
import type { ScannerDataManifest } from "./tools/scanner-provenance";

const NOW = new Date("2026-08-16T00:00:00.000Z");
const DIGEST = `sha256:${"a".repeat(64)}`;
const MANIFEST_HASH = `sha256:${"b".repeat(64)}`;

function manifest(
  state: "ready" | "missing" | "stale" = "ready",
): ScannerDataManifest {
  return {
    version: 2,
    snapshotDate: "2026-08-16",
    manifestHash: MANIFEST_HASH,
    legacyManifest: false,
    tools: {
      gitleaks: {
        version: "8.30.1",
        dataKind: "binary",
        state: "ready",
        path: null,
        runtimePath: null,
        digest: null,
      },
      osv: {
        version: "2.4.0",
        dataKind: "vulnerability-db",
        state,
        path: null,
        runtimePath: "/opt/vuln-workbench/scanner-data/osv",
        digest: DIGEST,
      },
    },
  };
}

function dependencies(
  overrides: Partial<ScanPreflightDependencies> = {},
): ScanPreflightDependencies {
  return {
    loadManifest: async () => manifest(),
    probeScannerVersion: async (scannerId) => `${scannerId} 1.0.0`,
    probeDocker: async () => ({
      ready: true,
      version: "28.0.0",
      platform: "linux/amd64",
      reasonCode: null,
    }),
    probeDockerImage: async () => ({
      ready: true,
      digest: DIGEST,
      platform: "linux/amd64",
      reasonCode: null,
    }),
    probeDockerRuntimePath: async () => true,
    inferTargetPlan: async ({ repoPath }) => ({
      pluginId: "build.npm",
      repoPath,
      scriptName: "start",
      script: "vite",
      packageManager: "bun",
      command: ["bun", "run", "start"],
      env: {},
      requiresProjectCodeConsent: false,
      port: 4000,
      origin: "http://127.0.0.1:4000",
      readinessPaths: ["/"],
      warnings: [],
    }),
    discoverRepositorySchema: async () => false,
    probeBrowser: async () => "chromium",
	resolveSourceRevision: async () => "c".repeat(40),
	resolveSourceState: async () => "clean",
    loadQualification: async () => null,
		loadQualificationContractHash: async () => DIGEST,
    now: () => NOW,
    ...overrides,
  };
}

function profile(id = "baseline"): ScanProfile {
  return buildScanProfiles({ optionalAdapterIds: [] }).find(
    (candidate) => candidate.id === id,
  )!;
}

describe("scan preflight", () => {
	it("uses enforced mode unless shadow was explicitly requested", () => {
		expect(resolveScanPreflightMode(undefined)).toBe("enforced");
		expect(resolveScanPreflightMode("shadow")).toBe("shadow");
		expect(resolveScanPreflightMode("enforced")).toBe("enforced");
	});

	it("fails closed for a strict profile without a clean immutable source revision", async () => {
		const selected = profile("full-security-scan");
		const result = await runScanPreflight({
			profile: selected,
			steps: selected.tools.map((tool) => ({
				kind: "static_tool" as const,
				...tool,
			})),
			repoPath: "/redacted/project",
			execution: { runner: "host" },
			dependencies: dependencies({ resolveSourceState: async () => "dirty" }),
		});

		expect(result.status).toBe("blocked");
		expect(result.limitationCodes).toContain("source_worktree_dirty");
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				kind: "source_revision",
				required: true,
				status: "blocked",
			}),
		);
	});

	it("blocks before execution when a required scanner binary is unavailable", async () => {
		const selected = profile("baseline");
		const result = await runScanPreflight({
			profile: selected,
			steps: selected.tools.map((tool) => ({
				kind: "static_tool" as const,
				...tool,
			})),
			repoPath: "/redacted/project",
			execution: { runner: "host" },
			mode: "enforced",
			dependencies: dependencies({ probeScannerVersion: async () => null }),
		});

		expect(result.status).toBe("blocked");
		expect(result.limitationCodes).toEqual(["scanner_binary_unavailable"]);
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				kind: "binary_version",
				required: true,
				status: "blocked",
				reasonCode: "scanner_binary_unavailable",
			}),
		);
		expect(preflightBlocksExecution(result)).toBe(true);
		recordScannerE2EFailureObservation("FI-01", {
			profileOutcome: "blocked",
			reasonCodes: result.limitationCodes,
		});
	});

  it("blocks a required OSV step before execution when its database is missing", async () => {
    const probeScannerVersion = vi.fn(async (scannerId: string) =>
      scannerId === "gitleaks" ? "8.30.1" : "2.4.0",
    );
    const selected = profile();
    const result = await runScanPreflight({
      profile: selected,
      steps: selected.tools.map((tool) => ({
        kind: "static_tool" as const,
        ...tool,
      })),
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      mode: "enforced",
      dependencies: dependencies({
        loadManifest: async () => manifest("missing"),
        probeScannerVersion,
      }),
    });
    expect(result).toMatchObject({
      status: "blocked",
      limitationCodes: ["scanner_data_missing"],
    });
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        stepId: "osv",
        kind: "scanner_data",
        status: "blocked",
        required: true,
      }),
    );
    expect(preflightBlocksExecution(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("/redacted/project");
		recordScannerE2EFailureObservation("FI-03", {
			profileOutcome: "blocked",
			reasonCodes: result.limitationCodes,
		});
  });

  it("does not trust a ready manifest when the Docker runtime path is unreadable", async () => {
    const selected = profile();
    const result = await runScanPreflight({
      profile: selected,
      steps: selected.tools.map((tool) => ({
        kind: "static_tool" as const,
        ...tool,
      })),
      repoPath: "/redacted/project",
      execution: {
        runner: "docker",
        docker: { image: "toolbox:local", networkMode: "none" },
      },
      mode: "enforced",
      dependencies: dependencies({
        probeDockerRuntimePath: async (_bin, _image, runtimePath) =>
          !runtimePath.endsWith("/osv"),
      }),
    });
    expect(result.limitationCodes).toContain("scanner_data_runtime_unreadable");
    expect(result.status).toBe("blocked");
  });

  it("blocks a scanner whose observed version differs from the manifest", async () => {
    const selected = profile();
    const result = await runScanPreflight({
      profile: selected,
      steps: selected.tools.map((tool) => ({
        kind: "static_tool" as const,
        ...tool,
      })),
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      mode: "enforced",
      dependencies: dependencies({
        probeScannerVersion: async (scannerId) =>
          scannerId === "gitleaks" ? "gitleaks 8.29.0" : "osv 2.4.0",
      }),
    });
    expect(result.status).toBe("blocked");
    expect(result.limitationCodes).toContain("scanner_version_mismatch");
  });

  it("accepts an ANSI-coloured v-prefixed Nuclei version", async () => {
    const selected = profile("runtime-web-safe");
    const nucleiStep = selected.steps?.find(
      (step) =>
        step.kind === "runtime_scanner" && step.adapter === "nuclei-safe",
    );
    expect(nucleiStep).toBeDefined();
    const result = await runScanPreflight({
      profile: selected,
      steps: [nucleiStep!],
      repoPath: "/redacted/project",
      execution: {
        runner: "docker",
        docker: { image: "toolbox:local", networkMode: "default" },
      },
      mode: "enforced",
      dependencies: dependencies({
        loadManifest: async () => ({
          ...manifest(),
          tools: {
            ...manifest().tools,
            "nuclei-safe": {
              version: "3.11.1",
              dataKind: "template",
              state: "ready",
              path: null,
              runtimePath: "/opt/vuln-workbench/nuclei-safe-templates",
              digest: DIGEST,
            },
          },
        }),
        probeScannerVersion: async () =>
          "\u001b[34mINF\u001b[0m Nuclei Engine Version: v3.11.1",
      }),
    });

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "runtime_scanner:nuclei-safe:binary-version",
        status: "ready",
        reasonCode: null,
      }),
    );
  });

	it("keeps normal strict scans independent from the protected-CI qualification artifact", async () => {
    const selected = profile("api-schema-readonly");
    const result = await runScanPreflight({
      profile: selected,
      steps: selected.steps!,
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      mode: "enforced",
      dependencies: dependencies(),
	});

    expect(result.status).toBe("ready");
    expect(result.checks).not.toContainEqual(
      expect.objectContaining({ kind: "scanner_e2e_qualification" }),
    );
  });

	it("blocks a strict API scan before any target or scanner process when route evidence has no schema", async () => {
		const selected = profile("api-schema-readonly");
		const probeScannerVersion = vi.fn(async () => "schemathesis 4.0.0");
		const inferTargetPlan = vi.fn(async ({ repoPath }: { repoPath: string }) => ({
			pluginId: "build.npm",
			repoPath,
			scriptName: "start",
			script: "vite",
			packageManager: "bun" as const,
			command: ["bun", "run", "start"],
			env: {},
			requiresProjectCodeConsent: false,
			port: 4000,
			origin: "http://127.0.0.1:4000",
			readinessPaths: ["/"],
			warnings: [],
		}));
		const result = await runScanPreflight({
			profile: selected,
			steps: selected.steps!,
			repoPath: "/redacted/project",
			execution: { runner: "host" },
			mode: "enforced",
			dependencies: dependencies({
				probeScannerVersion,
				inferTargetPlan,
				discoverRepositorySchema: async () => ({
					schemaPresent: false,
					apiDetected: true,
					evidenceRefs: ["api-source:src/server.ts"],
				}),
			}),
		});

		expect(result).toMatchObject({
			status: "blocked",
			limitationCodes: ["schema_not_found"],
		});
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				kind: "api_schema_applicability",
				status: "blocked",
				required: true,
				evidenceRefs: ["api-source:src/server.ts"],
			}),
		);
		expect(probeScannerVersion).not.toHaveBeenCalled();
		expect(inferTargetPlan).not.toHaveBeenCalled();
	});

	it("bounds API route evidence before validating the preflight result", async () => {
		const selected = profile("api-schema-readonly");
		const evidenceRefs = Array.from(
			{ length: 12 },
			(_, index) => `api-source:src/routes/route-${index}.ts`,
		);
		const result = await runScanPreflight({
			profile: selected,
			steps: selected.steps!,
			repoPath: "/redacted/project",
			execution: { runner: "host" },
			mode: "enforced",
			dependencies: dependencies({
				discoverRepositorySchema: async () => ({
					schemaPresent: false,
					apiDetected: true,
					evidenceRefs,
				}),
			}),
		});

		const schemaCheck = result.checks.find(
			(check) => check.kind === "api_schema_applicability",
		);
		expect(result.status).toBe("blocked");
		expect(schemaCheck?.evidenceRefs).toEqual(evidenceRefs.slice(0, 10));
	});

  it("can enforce the verified scanner qualification as an explicit deployment admission control", async () => {
    const selected = profile("api-schema-readonly");
    const result = await runScanPreflight({
      profile: selected,
      steps: selected.steps!,
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      mode: "enforced",
      requireScannerE2EQualification: true,
      dependencies: dependencies(),
    });
    expect(result).toMatchObject({
      status: "blocked",
      limitationCodes: ["scanner_e2e_qualification_missing"],
    });
  });

  it("blocks an image whose platform differs from the Docker daemon", async () => {
    const selected = profile();
    const result = await runScanPreflight({
      profile: selected,
      steps: selected.tools.map((tool) => ({
        kind: "static_tool" as const,
        ...tool,
      })),
      repoPath: "/redacted/project",
      execution: {
        runner: "docker",
        docker: { image: "toolbox:local", networkMode: "none" },
      },
      mode: "enforced",
      dependencies: dependencies({
        probeDockerImage: async () => ({
          ready: true,
          digest: DIGEST,
          platform: "linux/arm64",
          reasonCode: null,
        }),
      }),
    });
    expect(result.status).toBe("blocked");
    expect(result.limitationCodes).toContain(
      "docker_image_platform_incompatible",
    );
  });

  it("keeps optional preflight failures as enforceable coverage gaps", async () => {
    const optionalProfile: ScanProfile = {
      id: "optional-preflight",
      name: "Optional",
      description: "Optional scanner",
      category: "focused",
      enabled: true,
      defaultTimeoutSec: 60,
      tools: [
        {
          toolId: "osv",
          displayName: "OSV",
          required: false,
          failurePolicy: "warn_and_continue",
        },
      ],
    };
    const result = await runScanPreflight({
      profile: optionalProfile,
      steps: optionalProfile.tools.map((tool) => ({
        kind: "static_tool" as const,
        ...tool,
      })),
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      mode: "enforced",
      dependencies: dependencies({
        loadManifest: async () => manifest("stale"),
      }),
    });
    expect(result.status).toBe("ready_with_gaps");
    expect(preflightBlocksExecution(result)).toBe(false);
		recordScannerE2EFailureObservation("FI-03", {
			profileOutcome: "blocked",
			reasonCodes: ["scanner_data_stale"],
		});
  });

  it("binds target plan, profile, execution, and manifest without storing source", async () => {
    const selected = profile("runtime-http-check");
    const first = await runScanPreflight({
      profile: selected,
      steps: selected.steps!,
      repoPath: "/private/source/with-secrets",
      execution: { runner: "host" },
      dependencies: dependencies(),
    });
    const changed = await runScanPreflight({
      profile: selected,
      steps: selected.steps!,
      repoPath: "/private/source/with-secrets",
      execution: { runner: "docker", docker: { image: "toolbox:local" } },
      dependencies: dependencies(),
    });
    expect(first.binding.targetPlanHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.bindingHash).not.toBe(changed.bindingHash);
    expect(JSON.stringify(first)).not.toContain("/private/source");
  });

  it("binds scanner versions and complete target start inputs", async () => {
    const staticProfile = profile();
    const staticSteps = staticProfile.tools.map((tool) => ({
      kind: "static_tool" as const,
      ...tool,
    }));
    const first = await runScanPreflight({
      profile: staticProfile,
      steps: staticSteps,
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      dependencies: dependencies({
        probeScannerVersion: async () => "scanner 1.0.0",
      }),
    });
    const changedVersion = await runScanPreflight({
      profile: staticProfile,
      steps: staticSteps,
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      dependencies: dependencies({
        probeScannerVersion: async () => "scanner 2.0.0",
      }),
    });
    expect(first.bindingHash).not.toBe(changedVersion.bindingHash);

    const runtimeProfile = profile("runtime-http-check");
    const changedPlan = await runScanPreflight({
      profile: runtimeProfile,
      steps: runtimeProfile.steps!,
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      dependencies: dependencies({
        inferTargetPlan: async ({ repoPath }) => ({
          ...(await dependencies().inferTargetPlan({
            repoPath,
            consentProjectCodeExecution: true,
          })),
          command: ["bun", "run", "changed"],
        }),
      }),
    });
    const originalPlan = await runScanPreflight({
      profile: runtimeProfile,
      steps: runtimeProfile.steps!,
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      dependencies: dependencies(),
    });
    expect(originalPlan.bindingHash).not.toBe(changedPlan.bindingHash);
  });

  it("reports consent and sandbox blocks for a non-sandboxed start plan", async () => {
    const selected = profile("runtime-http-check");
    const result = await runScanPreflight({
      profile: selected,
      steps: selected.steps!,
      repoPath: "/redacted/project",
      execution: { runner: "host" },
      mode: "enforced",
      dependencies: dependencies({
        inferTargetPlan: async ({ repoPath }) => ({
          ...(await dependencies().inferTargetPlan({
            repoPath,
            consentProjectCodeExecution: true,
          })),
          pluginId: "framework.python.fastapi",
          packageManager: "python",
          requiresProjectCodeConsent: true,
        }),
      }),
    });
    expect(result.limitationCodes).toEqual(
      expect.arrayContaining([
        "project_code_execution_consent_required",
        "project_code_execution_sandbox_required",
      ]),
    );
    expect(result.status).toBe("blocked");
  });
});
