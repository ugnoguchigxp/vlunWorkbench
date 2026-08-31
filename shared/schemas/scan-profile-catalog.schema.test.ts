import { describe, expect, test } from "vitest";
import { scanProfileCatalogEntrySchema } from "./scan-profile-catalog.schema";

describe("scan profile catalog schema", () => {
	test("rejects unknown fields and malformed catalog identifiers", () => {
		const valid = {
			schemaVersion: 1,
			id: "source-assurance",
			catalogVersion: 1,
			displayOrder: 1,
			displayName: "Source assurance",
			description: "A source scan.",
			experienceKind: "scanner_preset",
			availability: "stable",
			safetyClass: "R0",
			launchMode: "profile_orchestrator",
			launchDestination: "scan_workspace",
			strictness: "strict",
			defaultResultPolicy: "advisory",
			allowedResultPolicies: ["advisory", "gate"],
			gateSeverityThreshold: "high",
			supportedTargets: ["full"],
			requiredInputs: [],
			capabilityRequirements: [],
		executionVariants: [
			{
				id: "source",
				executionProfileRef: "source-assurance",
				requiredInputKinds: [],
				forbiddenInputKinds: [],
			},
		],
			environmentRequirementCodes: [],
			limitationCodes: [],
			replacementProfileId: null,
		};
		expect(scanProfileCatalogEntrySchema.safeParse(valid).success).toBe(true);
		expect(
			scanProfileCatalogEntrySchema.safeParse({ ...valid, id: "Source Assurance" })
				.success,
		).toBe(false);
		expect(
			scanProfileCatalogEntrySchema.safeParse({ ...valid, unknown: true }).success,
		).toBe(false);
		expect(
			scanProfileCatalogEntrySchema.safeParse({
				...valid,
				experienceKind: "campaign",
			}).success,
		).toBe(false);
	});

	test("rejects contradictory and undeclared variant inputs", () => {
		const base = {
			schemaVersion: 1,
			id: "source-assurance",
			catalogVersion: 1,
			displayOrder: 1,
			displayName: "Source assurance",
			description: "A source scan.",
			experienceKind: "scanner_preset",
			availability: "stable",
			safetyClass: "R0",
			launchMode: "profile_orchestrator",
			launchDestination: "scan_workspace",
			strictness: "strict",
			defaultResultPolicy: "advisory",
			allowedResultPolicies: ["advisory", "gate"],
			gateSeverityThreshold: "high",
			supportedTargets: ["full"],
			requiredInputs: [{ kind: "source_target", requirement: "required" }],
			capabilityRequirements: [],
			environmentRequirementCodes: [],
			limitationCodes: [],
			replacementProfileId: null,
		};
		expect(
			scanProfileCatalogEntrySchema.safeParse({
				...base,
				executionVariants: [
					{
						id: "source",
						executionProfileRef: "source-assurance",
						requiredInputKinds: ["source_target"],
						forbiddenInputKinds: ["source_target"],
					},
				],
			}).success,
		).toBe(false);
		expect(
			scanProfileCatalogEntrySchema.safeParse({
				...base,
				executionVariants: [
					{
						id: "source",
						executionProfileRef: "source-assurance",
						requiredInputKinds: ["source_target", "image_ref"],
						forbiddenInputKinds: [],
					},
				],
			}).success,
		).toBe(false);
	});
});
