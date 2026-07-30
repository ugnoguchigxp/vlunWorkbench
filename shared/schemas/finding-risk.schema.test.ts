import { describe, expect, it } from "vitest";
import { findingRiskContextSchema } from "./finding-risk.schema";

describe("finding risk context", () => {
	it("keeps scanner risk inputs separate from derived priority", () => {
		const parsed = findingRiskContextSchema.parse({
			cweIds: ["CWE-89"],
			advisoryAliases: ["CVE-2026-1000"],
			cvss: [
				{
					version: "3.1",
					vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
					baseScore: 9.8,
					source: "vendor",
				},
			],
			references: ["https://example.test/advisory"],
			package: {
				ecosystem: "npm",
				name: "example",
				version: "1.0.0",
				purl: "pkg:npm/example@1.0.0",
			},
			fixedVersions: ["1.0.1"],
			rule: { source: "owned", version: "1" },
			reachability: "unknown",
			reachabilityEvidenceRefs: [],
			vex: null,
			kev: null,
			epss: null,
			derivedPriority: "p1",
			priorityReasons: ["scanner severity is critical"],
		});
		expect(parsed.derivedPriority).toBe("p1");
		expect(parsed.cvss[0].baseScore).toBe(9.8);
	});
});
