import { describe, expect, it } from "vitest";
import { executeAttestationStep } from "./execute-attestation-step";
import type { ExecuteProfileStepsParams } from "./profile-step-orchestrator-types";

const hostScope = {
	execution: { runner: "host" },
	scanPreflight: { checks: [] },
} as unknown as ExecuteProfileStepsParams;

const dockerScope = {
	execution: { runner: "docker", docker: { networkMode: "none" } },
	attestationSubject: "image",
	slsaProvenance: "prov",
	slsaPolicy: "policy",
	scanPreflight: { checks: [] },
} as unknown as ExecuteProfileStepsParams;

describe("executeAttestationStep", () => {
	it("rejects unsupported steps and missing attestation inputs", async () => {
		await expect(
			executeAttestationStep({
				step: { kind: "static_tool" } as never,
				stepId: "static",
				failureFailsProfile: true,
				resolvedTimeout: 30,
				scope: hostScope,
			}),
		).rejects.toThrow("Unsupported profile step: static");
		await expect(
			executeAttestationStep({
				step: {
					kind: "attestation_verify",
					adapter: "cosign",
					required: true,
					displayName: "cosign",
					failurePolicy: "fail_profile",
					target: { mode: "repository_relative_files" },
				},
				stepId: "cosign",
				failureFailsProfile: true,
				resolvedTimeout: 30,
				scope: hostScope,
			}),
		).rejects.toThrow("attestation_input_missing");
		await expect(
			executeAttestationStep({
				step: {
					kind: "attestation_verify",
					adapter: "slsa-verifier",
					required: true,
					displayName: "slsa",
					failurePolicy: "fail_profile",
					target: { mode: "repository_relative_files" },
				},
				stepId: "slsa",
				failureFailsProfile: true,
				resolvedTimeout: 30,
				scope: hostScope,
			}),
		).rejects.toThrow("attestation_input_missing");
		await expect(
			executeAttestationStep({
				step: {
					kind: "attestation_verify",
					adapter: "slsa-verifier",
					required: true,
					displayName: "slsa",
					failurePolicy: "fail_profile",
					target: { mode: "repository_relative_files" },
				},
				stepId: "slsa",
				failureFailsProfile: true,
				resolvedTimeout: 30,
				scope: dockerScope,
			}),
		).rejects.toThrow("slsa_trust_root_network_required");
	});
});
