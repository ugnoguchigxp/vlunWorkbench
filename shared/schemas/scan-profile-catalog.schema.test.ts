import { describe, expect, test } from "bun:test";
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
			executionVariants: [],
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
	});
});
