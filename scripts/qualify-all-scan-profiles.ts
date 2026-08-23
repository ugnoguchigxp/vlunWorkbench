import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SCAN_PROFILE_DEFINITIONS } from "../api/modules/scans/profile-definitions";

type FixtureManifest = {
	schemaVersion: number;
	profileId: string;
	policyId: string;
	caseIds: string[];
};

const failures: string[] = [];
for (const definition of SCAN_PROFILE_DEFINITIONS) {
	const fixtures = new Set(
		definition.variants.map((variant) => variant.qualificationFixture),
	);
	for (const fixture of fixtures) {
		try {
			const parsed = JSON.parse(
				await readFile(resolve(process.cwd(), fixture), "utf8"),
			) as FixtureManifest;
			if (
				parsed.schemaVersion !== 1 ||
				parsed.profileId !== definition.id ||
				parsed.caseIds.length === 0
			) {
				failures.push(`Invalid fixture manifest: ${fixture}`);
			}
		} catch {
			failures.push(`Unreadable fixture manifest: ${fixture}`);
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(failure);
	process.exit(1);
}

console.log(
	`Qualification inventory is complete for ${SCAN_PROFILE_DEFINITIONS.length} profiles.`,
);
