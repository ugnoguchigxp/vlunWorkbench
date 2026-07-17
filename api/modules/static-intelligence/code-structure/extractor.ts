import type { CodeStructureSnapshot } from "../../../../shared/schemas/static-intelligence-code-structure.schema";
import {
	buildProjectStructureSnapshot,
	buildProjectStructureSnapshotFromInventory,
} from "../project-structure/builder";
import type { ProjectInventory } from "../project-structure/inventory";
import { projectStructureV2ToCodeStructureV1 } from "../project-structure/v1-projector";

export type BuildCodeStructureSnapshotInput = {
	projectPath: string;
	projectId?: string;
	generatedAt?: Date;
	includeRootPath?: boolean;
	maxFiles?: number;
	maxParsedFileBytes?: number;
	maxTotalParsedBytes?: number;
};

/**
 * Backward-compatible v1 facade. Project Structure v2 is the sole scanner;
 * legacy consumers receive its deterministic compatibility projection.
 */
export async function buildCodeStructureSnapshot(
	input: BuildCodeStructureSnapshotInput,
): Promise<CodeStructureSnapshot> {
	return projectStructureV2ToCodeStructureV1(
		await buildProjectStructureSnapshot(input),
	);
}

export async function buildCodeStructureSnapshotFromInventory(
	input: BuildCodeStructureSnapshotInput,
	inventory: ProjectInventory,
): Promise<CodeStructureSnapshot> {
	return projectStructureV2ToCodeStructureV1(
		await buildProjectStructureSnapshotFromInventory(input, inventory),
	);
}
