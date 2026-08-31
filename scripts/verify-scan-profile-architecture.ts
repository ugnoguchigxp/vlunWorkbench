import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	assertScanProfileDefinitionIntegrity,
	SCAN_PROFILE_DEFINITIONS,
} from "../api/modules/scans/profile-definitions";

assertScanProfileDefinitionIntegrity();

for (const definition of SCAN_PROFILE_DEFINITIONS) {
	for (const variant of definition.variants) {
		const fixturePath = resolve(process.cwd(), variant.qualificationFixture);
		if (!existsSync(fixturePath)) {
			console.error(
				`Missing qualification fixture: ${variant.qualificationFixture}`,
			);
			process.exitCode = 1;
		}
	}
}

if (process.exitCode !== 1) {
	console.log(
		`Scan profile architecture verified: ${SCAN_PROFILE_DEFINITIONS.length} profiles.`,
	);
}
