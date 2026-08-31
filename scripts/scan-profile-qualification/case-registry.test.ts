import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCAN_PROFILE_QUALIFICATION_CASE_REGISTRY } from "./case-registry";

describe("scan profile qualification case registry", () => {
	it("binds every profile to one policy and an exact checked-in fixture manifest", async () => {
		expect(Object.keys(SCAN_PROFILE_QUALIFICATION_CASE_REGISTRY)).toHaveLength(6);
		for (const [profileId, entry] of Object.entries(SCAN_PROFILE_QUALIFICATION_CASE_REGISTRY)) {
			const paths = new Set(entry.cases.map((item) => item.fixtureManifest));
			expect(paths.size).toBe(1);
			const fixturePath = path.resolve([...paths][0]);
			const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
			expect(fixture).toMatchObject({ schemaVersion: 1, profileId, policyId: entry.policyId });
			expect([...fixture.caseIds].sort()).toEqual(entry.cases.map((item) => item.caseId).sort());
		}
	});
});
