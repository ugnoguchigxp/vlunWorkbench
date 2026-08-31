import { describe, expect, test } from "vitest";
import { scanProfileDefinitionSchema } from "./scan-profile-definition.schema";

const validDefinition = {
	id: "dependency-supply-chain",
	availability: "stable",
	safetyClass: "R0",
	engineId: "supply-artifact",
	variants: [
		{
			id: "offline-attestation",
			stepIds: ["attestation:cosign"],
			qualificationFixture:
				"scripts/scan-profile-qualification/fixtures/dependency-supply-chain.json",
			dependencyIds: ["scanner.cosign"],
		},
	],
	dependencyIds: ["scanner.cosign"],
} as const;

describe("scan profile definition schema", () => {
	test("requires variant dependencies to be declared by the profile", () => {
		expect(scanProfileDefinitionSchema.safeParse(validDefinition).success).toBe(
			true,
		);
		expect(
			scanProfileDefinitionSchema.safeParse({
				...validDefinition,
				variants: [
					{
						...validDefinition.variants[0],
						dependencyIds: ["scanner.slsa-verifier"],
					},
				],
			}).success,
		).toBe(false);
	});
});
