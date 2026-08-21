import { describe, expect, test } from "bun:test";
import { SCAN_PROFILE_LEGACY_ASSOCIATIONS } from "./profile-catalog";
import {
	hashProfileResolution,
	normalizeProfileResolutionInput,
	ProfileResolutionError,
	resolveProfileSelection,
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
});
