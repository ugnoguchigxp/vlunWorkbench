import { describe, expect, test } from "bun:test";
import { SCAN_PROFILE_LEGACY_ASSOCIATIONS } from "./profile-catalog";
import {
	hashProfileResolution,
	normalizeProfileResolutionInput,
	ProfileResolutionError,
	resolveDedicatedProfileSelection,
	resolveProfileSelection,
	resolveStoredScanSafetyBoundary,
} from "./profile-resolution";
import { listProfiles } from "./profiles";

const sourceInput = normalizeProfileResolutionInput({ repoPath: "/tmp/project" });

describe("profile resolution", () => {
	test("keeps a legacy requested ID while associating it with the canonical profile", () => {
		const resolved = resolveProfileSelection({
			requestedProfileId: "baseline",
			surface: "cli",
			target: { kind: "full" },
			providedInputKinds: sourceInput,
		});
		expect(resolved.resolution).toMatchObject({
			requestedProfileId: "baseline",
			canonicalProfileId: "source-assurance",
			executionProfileId: "baseline",
			migrationKind: "legacy_preset",
			resultPolicy: "advisory",
		});
	});

	test("resolves a canonical profile and rejects an active placeholder", () => {
		const resolved = resolveProfileSelection({
			requestedProfileId: "change-gate",
			surface: "cli",
			target: { kind: "commit", head: "HEAD" },
			providedInputKinds: sourceInput,
		});
		expect(resolved.resolution).toMatchObject({
			canonicalProfileId: "change-gate",
			executionProfileId: "change-gate",
			resultPolicy: "gate",
		});
		expect(() =>
		resolveProfileSelection({
			requestedProfileId: "runtime-zap-active-lab",
			surface: "cli",
			target: { kind: "full" },
			providedInputKinds: sourceInput,
		}),
	).toThrow(ProfileResolutionError);
	});

	test("selects an explicit image variant and does not auto-build", () => {
		const resolved = resolveProfileSelection({
			requestedProfileId: "release-artifact",
			surface: "cli",
			target: { kind: "full" },
			providedInputKinds: normalizeProfileResolutionInput({ imageRef: "app:local" }),
		});
		expect(resolved.resolution).toMatchObject({
			executionProfileId: "container-image-security",
			executionVariantId: "container-image-ref",
		});
	});

	test("applies canonical strictness to a legacy execution definition", () => {
		const resolved = resolveProfileSelection({
			requestedProfileId: "release-artifact",
			surface: "web",
			target: { kind: "full" },
			providedInputKinds: sourceInput,
		});

		expect(resolved.resolution.strictness).toBe("strict");
		expect(resolved.executionProfile.id).toBe("artifact");
		expect(resolved.executionProfile.strictness).toBe("strict");
	});

	test("requires and resolves the complete offline attestation input set", () => {
		expect(() =>
			resolveProfileSelection({
				requestedProfileId: "dependency-supply-chain",
				surface: "cli",
				target: { kind: "full" },
				providedInputKinds: sourceInput,
			}),
		).toThrow("profile_input_missing");
		const resolved = resolveProfileSelection({
			requestedProfileId: "dependency-supply-chain",
			surface: "cli",
			target: { kind: "full" },
			providedInputKinds: normalizeProfileResolutionInput({
				repoPath: "/tmp/project",
				attestationSubject: "dist/app.tar.gz",
				attestationBundle: "attestations/app.bundle.json",
				trustPolicy: "security/cosign.pub",
			}),
		});
		expect(resolved.resolution).toMatchObject({
			executionProfileId: "dependency-supply-chain",
			executionVariantId: "offline-attestation",
		});
	});

	test("rejects disabled legacy active profiles before a run can be created", () => {
		for (const requestedProfileId of [
			"runtime-zap-active-lab",
			"api-zap-active-lab",
		]) {
			expect(() =>
				resolveProfileSelection({
					requestedProfileId,
					surface: "cli",
					target: { kind: "full" },
					providedInputKinds: ["source_target"],
				}),
			).toThrow("profile_not_launchable");
		}
	});

	test("does not make an unregistered execution definition launchable", () => {
		expect(() =>
			resolveProfileSelection({
				requestedProfileId: "not-in-catalog",
				surface: "cli",
				target: { kind: "full" },
				providedInputKinds: sourceInput,
			}),
		).toThrow("profile_not_found");
	});

	test("hashes resolution values independently of object key insertion order", () => {
		const resolution = resolveProfileSelection({
			requestedProfileId: "baseline",
			surface: "cli",
			target: { kind: "full" },
			providedInputKinds: sourceInput,
		}).resolution;
		expect(hashProfileResolution(resolution)).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(hashProfileResolution({ ...resolution })).toBe(
			hashProfileResolution(resolution),
		);
	});

	test("preserves every enabled legacy execution ID", () => {
		const profiles = listProfiles();
		for (const profile of profiles.filter((item) => item.enabled)) {
			const targetKind = (profile.supportedTargets ?? ["full"])[0]!;
			const target =
				targetKind === "full"
					? { kind: "full" as const }
					: targetKind === "working_tree"
						? { kind: "working_tree" as const, includeUntracked: false }
						: targetKind === "range"
							? { kind: "range" as const, base: "HEAD~1", head: "HEAD" }
							: { kind: "commit" as const, head: "HEAD" };
			const resolution = resolveProfileSelection({
				requestedProfileId: profile.id,
				surface: "cli",
				target,
				providedInputKinds: sourceInput,
			});
			expect(resolution.resolution.executionProfileId).toBe(profile.id);
			expect(
			SCAN_PROFILE_LEGACY_ASSOCIATIONS.some(
				(association) => association.legacyProfileId === profile.id,
			),
		).toBe(true);
		}
	});

	test("records dedicated workflow identity without inventing an execution profile", () => {
		const { resolution } = resolveDedicatedProfileSelection({
			canonicalProfileId: "active-technical-lab",
			providedInputKinds: [
				"disposable_target_ref",
				"rules_of_engagement_ref",
				"execution_consent",
			],
		});

		expect(resolution).toMatchObject({
			canonicalProfileId: "active-technical-lab",
			executionProfileId: null,
			launchMode: "dedicated_flow",
			resultPolicy: "advisory",
			launchability: "launchable",
		});
	});

	test("rejects a dedicated workflow with a missing required safety input", () => {
		expect(() =>
			resolveDedicatedProfileSelection({
				canonicalProfileId: "business-logic-lab",
				providedInputKinds: [
					"disposable_target_ref",
					"scenario_ref",
					"rules_of_engagement_ref",
				],
			}),
		).toThrow("Missing dedicated profile inputs: execution_consent");
	});

	test("restores a canonical safety boundary from stored scan metadata", () => {
		expect(
			resolveStoredScanSafetyBoundary({
				profile: "baseline",
				metadata: {
					profileResolution: {
						canonicalProfileId: "active-technical-lab",
					},
				},
			}),
		).toEqual({
			canonicalProfileId: "active-technical-lab",
			safetyClass: "R3",
		});
	});

	test("restores legacy safety boundaries and rejects unknown stored profiles", () => {
		expect(
			resolveStoredScanSafetyBoundary({
				profile: "source-baseline",
				metadata: null,
			}),
		).toEqual({
			canonicalProfileId: "source-assurance",
			safetyClass: "R0",
		});
		expect(
			resolveStoredScanSafetyBoundary({
				profile: "removed-unmapped-profile",
				metadata: {},
			}),
		).toBeNull();
	});
});
