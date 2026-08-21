import { describe, expect, it } from "vitest";
import {
	runtimeIsolationPlanV1Schema,
	runtimeTargetRecipeV1Schema,
} from "./runtime-isolation.schema";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;

describe("runtime isolation schemas", () => {
	it("accepts a bounded npm/SQLite recipe", () => {
		const parsed = runtimeTargetRecipeV1Schema.parse({
			schemaVersion: 1,
			startPlannerId: "build.npm",
			dependencyAdapterId: "npm-package-lock-v1",
			database: {
				mode: "sqlite_ephemeral",
				environmentBindings: [{ key: "SQLITE_PATH", valueKind: "file_path" }],
			},
			readinessPaths: ["/health"],
		});
		expect(parsed.database.mode).toBe("sqlite_ephemeral");
	});

	it("rejects database bindings for none mode and unknown recipe fields", () => {
		expect(() =>
			runtimeTargetRecipeV1Schema.parse({
				schemaVersion: 1,
				startPlannerId: "build.npm",
				dependencyAdapterId: "npm-package-lock-v1",
				database: {
					mode: "none",
					environmentBindings: [{ key: "DATABASE_URL", valueKind: "url" }],
				},
				image: "not-allowed",
			}),
		).toThrow();
	});

	it("requires all runtime plan hashes and never accepts arbitrary network settings", () => {
		const plan = {
			schemaVersion: 1,
			profileId: "runtime-web-safe",
			source: {
				sourceSnapshotDigest: digest("a"),
				runtimeProjectionDigest: digest("b"),
				projectionPolicyVersion: 1,
			},
			recipe: { recipeHash: digest("c"), startPlannerId: "build.npm" },
			dependency: {
				adapterId: "npm-package-lock-v1",
				policyVersion: 1,
				lockDigest: digest("d"),
			},
			images: {
				namespaceOwnerImageDigest: digest("e"),
				nodeRuntimeImageDigest: digest("f"),
				materializerImageDigest: digest("0"),
				registryProxyImageDigest: digest("1"),
				probeImageDigest: digest("2"),
				httpExecutorImageDigest: digest("3"),
				databaseImageDigest: null,
				scannerImageDigests: { nuclei: digest("4") },
			},
			start: { executable: "npm", args: ["run", "start"], port: 18080, readinessPaths: ["/"] },
			database: { mode: "none", policyVersion: 1, bindings: [] },
			environment: { policyVersion: 1 },
			network: { kind: "container_namespace", policyVersion: 1 },
			limits: { policyVersion: 1, targetMemoryMiB: 1024, targetPids: 256 },
			cleanup: { required: true, policyVersion: 1 },
			dockerDaemonIdentityHash: digest("5"),
			qualificationHash: digest("6"),
		};
		expect(runtimeIsolationPlanV1Schema.parse(plan).network.kind).toBe("container_namespace");
		expect(() => runtimeIsolationPlanV1Schema.parse({ ...plan, network: { kind: "host" } })).toThrow();
	});
});
