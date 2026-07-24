import { createHash } from "node:crypto";
import { buildProjectInventory } from "./project-structure/inventory";

const FINGERPRINT_VERSION = "project-source-v2";
const SCAN_PROFILE_VERSION = "structure-only-v2";
const STATIC_INTELLIGENCE_SCHEMA_VERSION = "project-structure-v2";
const GENERATION_BUILDER_VERSION = "phase-45-v2";

export type ProjectSourceFingerprint = {
	value: string;
	fileCount: number;
	version: typeof FINGERPRINT_VERSION;
};

export async function computeProjectSourceFingerprint(
	projectPath: string,
): Promise<ProjectSourceFingerprint> {
	const inventory = await buildProjectInventory({
		projectPath,
		maxFiles: 20_000,
	});
	const hash = createHash("sha256");
	hash.update(
		JSON.stringify({
			version: FINGERPRINT_VERSION,
			scanProfile: SCAN_PROFILE_VERSION,
			schema: STATIC_INTELLIGENCE_SCHEMA_VERSION,
			builder: GENERATION_BUILDER_VERSION,
			structureInputHash: inventory.structureInputHash,
		}),
	);
	return {
		value: hash.digest("hex"),
		fileCount: inventory.coverage.includedFileCount,
		version: FINGERPRINT_VERSION,
	};
}
