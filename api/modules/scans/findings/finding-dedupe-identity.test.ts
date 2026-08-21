import { describe, expect, it } from "vitest";
import { projectFindingDedupeIdentity } from "./finding-dedupe-identity";

describe("projectFindingDedupeIdentity", () => {
	it("normalizes advisory aliases, a project path, and package occurrence", () => {
		const identity = projectFindingDedupeIdentity({
			sourceTool: "osv",
			ruleId: "GHSA-abcd-1234-efgh",
			primaryLocation: { path: "./package-lock.json" },
			metadata: {
				ecosystem: "npm",
				packageName: "Lodash",
				packageVersion: "4.17.20",
				manifestPath: "./package-lock.json",
				advisoryId: "ghsa-abcd-1234-efgh",
				aliases: ["CVE-2020-8203", "GHSA-ABCD-1234-EFGH"],
			},
		});

		expect(identity).toMatchObject({
			issueKind: "dependency",
			assetKey: "npm:lodash@4.17.20:package-lock.json",
			packageKey: "npm:lodash@4.17.20",
			advisoryIds: ["CVE-2020-8203", "GHSA-ABCD-1234-EFGH"],
		});
	});

	it("removes URL credentials, query values, and fragments", () => {
		const identity = projectFindingDedupeIdentity({
			sourceTool: "zap",
			ruleId: "40012",
			primaryLocation: {
				url: "https://alice:secret@example.test/account?token=private#fragment",
				method: "get",
				parameter: "id",
			},
			metadata: { cwe: "CWE-79" },
		});

		expect(identity).toMatchObject({
			issueKind: "web",
			assetKey: "https://example.test/account",
			location: {
				path: "https://example.test/account",
				method: "GET",
				parameter: "id",
			},
		});
		expect(JSON.stringify(identity)).not.toContain("secret");
		expect(JSON.stringify(identity)).not.toContain("token");
	});

	it("does not project a secret body or anchor", () => {
		const identity = projectFindingDedupeIdentity({
			sourceTool: "gitleaks",
			ruleId: "generic-api-key",
			primaryLocation: { path: "src/.env", startLine: 3, startCol: 5, endCol: 30 },
			metadata: {
				detectorFamily: "generic-api-key",
				anchor: "AIza-this-must-not-be-derived",
			},
		});

		expect(identity.issueKind).toBe("secret");
		expect(identity.anchor).toBeNull();
		expect(JSON.stringify(identity)).not.toContain("AIza");
	});

	it("fails safe to a non-mergeable identity when input is malformed", () => {
		const identity = projectFindingDedupeIdentity({
			sourceTool: "",
			ruleId: "",
			primaryLocation: null,
			metadata: null,
		});

		expect(identity.issueKind).toBe("unknown");
		expect(identity.assetKey).toBeNull();
	});
});
