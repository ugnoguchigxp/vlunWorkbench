import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanProfile } from "../../../../shared/schemas/scan-profile.schema";
import type { ScannerDataManifest } from "../tools/scanner-provenance";
import {
	runScanPreflight,
	type ScanPreflightDependencies,
} from "./scan-preflight";

const DIGEST = `sha256:${"a".repeat(64)}`;
const profile: ScanProfile = {
	id: "attestation-input-test",
	name: "Attestation input test",
	description: "Attestation input test",
	category: "focused",
	enabled: true,
	strictness: "strict",
	defaultTimeoutSec: 60,
	tools: [],
	steps: [
		{
			kind: "attestation_verify",
			adapter: "cosign",
			displayName: "Cosign",
			required: true,
			failurePolicy: "fail_profile",
			target: { mode: "repository_relative_files" },
		},
	],
};

const artifactProfile: ScanProfile = {
	...profile,
	id: "artifact-input-test",
	name: "Artifact input test",
	description: "Artifact input test",
	scope: {
		intent: "artifact",
		includeGlobs: ["dist/**"],
		excludeGlobs: [],
		includeGenerated: true,
		includeInstalledDependencies: false,
		includeVendoredDependencies: false,
	},
	steps: [],
};

const slsaProfile: ScanProfile = {
	...profile,
	id: "slsa-input-test",
	name: "SLSA input test",
	description: "SLSA input test",
	steps: [
		{
			kind: "attestation_verify",
			adapter: "slsa-verifier",
			displayName: "slsa-verifier",
			required: true,
			failurePolicy: "fail_profile",
			target: { mode: "repository_relative_files" },
		},
	],
};

describe("scan profile input preflight", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-profile-input-"));
		await fs.mkdir(path.join(root, "inputs"));
		await Promise.all([
			fs.writeFile(path.join(root, "inputs", "subject-a.bin"), "a"),
			fs.writeFile(path.join(root, "inputs", "subject-b.bin"), "b"),
			fs.writeFile(path.join(root, "inputs", "bundle.json"), "{}"),
			fs.writeFile(path.join(root, "inputs", "cosign.pub"), "public-key"),
			fs.writeFile(path.join(root, "inputs", "artifact.intoto.jsonl"), "{}"),
			fs.writeFile(
				path.join(root, "inputs", "slsa-policy.json"),
				JSON.stringify({
					schemaVersion: 1,
					sourceUri: "github.com/example/project",
					builderId: "https://github.com/example/project/.github/workflows/release.yml@refs/heads/main",
					sourceRef: { kind: "tag", value: "v1.0.0" },
				}),
			),
		]);
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("validates contained files and binds their selected paths", async () => {
		const first = await preflight("inputs/subject-a.bin");
		const second = await preflight("inputs/subject-b.bin");

		expect(first.status).toBe("ready");
		expect(first.checks).toContainEqual(
			expect.objectContaining({
				kind: "profile_input",
				status: "ready",
			}),
		);
		expect(first.binding.profileInputsHash).toMatch(
			/^sha256:[a-f0-9]{64}$/,
		);
		expect(first.binding.profileInputsHash).not.toBe(
			second.binding.profileInputsHash,
		);
	});

	it("changes the binding when a selected input changes in place", async () => {
		const first = await preflight("inputs/subject-a.bin");
		await fs.writeFile(path.join(root, "inputs", "subject-a.bin"), "changed");
		const second = await preflight("inputs/subject-a.bin");

		expect(first.status).toBe("ready");
		expect(second.status).toBe("ready");
		expect(first.binding.profileInputsHash).not.toBe(
			second.binding.profileInputsHash,
		);
	});

	it("blocks repository traversal and mutable image tags", async () => {
		const result = await preflight("../outside.bin", "registry/app:latest");

		expect(result.status).toBe("blocked");
		expect(result.limitationCodes).toEqual(
			expect.arrayContaining([
				"attestation_input_outside_repository",
				"image_digest_required",
			]),
		);
	});

	it("blocks Cosign versions with known bundle verification bypasses", async () => {
		const result = await runScanPreflight({
			profile,
			steps: profile.steps ?? [],
			repoPath: root,
			execution: { runner: "host" },
			attestationSubject: "inputs/subject-a.bin",
			attestationBundle: "inputs/bundle.json",
			trustPolicy: "inputs/cosign.pub",
			dependencies: {
				...dependencies(),
				probeScannerVersion: async () => "GitVersion: v3.1.2",
			},
		});

		expect(result.status).toBe("blocked");
		expect(result.limitationCodes).toContain("scanner_version_vulnerable");
	});

	it("checks Cosign in the selected core toolbox image", async () => {
		const probeScannerVersion = vi.fn(async () => "GitVersion: v3.1.3");
		const result = await runScanPreflight({
			profile,
			steps: profile.steps ?? [],
			repoPath: root,
			execution: {
				runner: "docker",
				docker: { image: "vuln-workbench-toolbox:test" },
			},
			attestationSubject: "inputs/subject-a.bin",
			attestationBundle: "inputs/bundle.json",
			trustPolicy: "inputs/cosign.pub",
			dependencies: {
				...dependencies(),
				probeScannerVersion,
			},
		});

		expect(result.status).toBe("ready");
		expect(probeScannerVersion).toHaveBeenCalledWith(
			"cosign",
			expect.objectContaining({
				runner: "docker",
				docker: expect.objectContaining({
					image: "vuln-workbench-toolbox:test",
				}),
			}),
		);
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				kind: "binary_version",
				scannerId: "cosign",
				observedVersion: "3.1.3",
			}),
		);
	});

	it("blocks Docker SLSA verification until Sigstore trust-root network is explicit", async () => {
		const result = await runScanPreflight({
			profile: slsaProfile,
			steps: slsaProfile.steps ?? [],
			repoPath: root,
			execution: {
				runner: "docker",
				docker: { image: "vuln-workbench-toolbox:test", networkMode: "none" },
			},
			attestationSubject: "inputs/subject-a.bin",
			slsaProvenance: "inputs/artifact.intoto.jsonl",
			slsaPolicy: "inputs/slsa-policy.json",
			dependencies: {
				...dependencies(),
				probeScannerVersion: async () => "GitVersion: v2.7.1",
			},
		});

		expect(result.status).toBe("blocked");
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				reasonCode: "slsa_trust_root_network_required",
				action: "allow_slsa_trust_root_network",
			}),
		);
	});

	it("accepts local SLSA inputs in Docker with the explicit trust-root network", async () => {
		const result = await runScanPreflight({
			profile: slsaProfile,
			steps: slsaProfile.steps ?? [],
			repoPath: root,
			execution: {
				runner: "docker",
				docker: { image: "vuln-workbench-toolbox:test", networkMode: "default" },
			},
			attestationSubject: "inputs/subject-a.bin",
			slsaProvenance: "inputs/artifact.intoto.jsonl",
			slsaPolicy: "inputs/slsa-policy.json",
			dependencies: {
				...dependencies(),
				probeScannerVersion: async () => "GitVersion: v2.7.1",
			},
		});
		expect(result.status).toBe("ready");
	});

	it("blocks a filesystem artifact profile when no build output exists", async () => {
		const result = await runScanPreflight({
			profile: artifactProfile,
			steps: [],
			repoPath: root,
			execution: { runner: "host" },
			dependencies: dependencies(),
		});

		expect(result.status).toBe("blocked");
		expect(result.limitationCodes).toContain("artifact_input_missing");
	});

	async function preflight(subject: string, imageRef?: string) {
		return await runScanPreflight({
			profile,
			steps: profile.steps ?? [],
			repoPath: root,
			execution: { runner: "host" },
			attestationSubject: subject,
			attestationBundle: "inputs/bundle.json",
			trustPolicy: "inputs/cosign.pub",
			imageRef,
			dependencies: dependencies(),
		});
	}
});

function dependencies(): ScanPreflightDependencies {
	const manifest: ScannerDataManifest = {
		version: 2,
		snapshotDate: "2026-08-21",
		manifestHash: DIGEST,
		legacyManifest: false,
		tools: {
			cosign: {
				version: "3.1.3",
				dataKind: "add-on",
				state: "ready",
				path: "sigstore-trusted-root.json",
				runtimePath:
					"/opt/vuln-workbench/scanner-data/sigstore-trusted-root.json",
				digest: DIGEST,
				generatedAt: "2026-08-21T00:00:00.000Z",
				maxAgeHours: 8760,
				coverage: ["rekor-transparency-log"],
			},
		},
	};
	return {
		loadManifest: async () => manifest,
		probeScannerVersion: async () => "GitVersion: v3.1.3",
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
		inferTargetPlan: async () => {
			throw new Error("not expected");
		},
		discoverRepositorySchema: async () => false,
		probeBrowser: async () => null,
		resolveSourceRevision: async () => "c".repeat(40),
		resolveSourceState: async () => "clean",
		loadQualification: async () => null,
		loadQualificationContractHash: async () => DIGEST,
		now: () => new Date("2026-08-21T00:00:00.000Z"),
	};
}
