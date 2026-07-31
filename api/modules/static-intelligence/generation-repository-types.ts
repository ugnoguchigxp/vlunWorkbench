import type { ProjectStructureSnapshotV2 } from "../../../shared/schemas/project-structure.schema";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import type { scanArtifacts } from "../../db/schema";
import type {
	StaticIntelligenceArtifactMetadata,
	StaticIntelligenceSourceRevision,
} from "./generation-types";

export class StaticIntelligenceGenerationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StaticIntelligenceGenerationValidationError";
	}
}

export type PersistStaticIntelligenceGenerationInput = {
	scanRunId: string;
	snapshot: CodeStructureSnapshot;
	projectStructureSnapshot: ProjectStructureSnapshotV2;
	exportPayload: StaticIntelligenceExportV1;
	generationId?: string;
	sourceRevision?: StaticIntelligenceSourceRevision;
	expectedSourceStateHash?: string;
};

export type PersistedStaticIntelligenceGeneration = {
	generationId: string;
	projectId: string;
	scanRunId: string;
	status: "available" | "degraded";
	structure: {
		artifact: typeof scanArtifacts.$inferSelect;
		metadata: StaticIntelligenceArtifactMetadata;
		snapshot: CodeStructureSnapshot;
	};
	projectStructure: {
		artifact: typeof scanArtifacts.$inferSelect;
		metadata: StaticIntelligenceArtifactMetadata;
		snapshot: ProjectStructureSnapshotV2;
	};
	export: {
		artifact: typeof scanArtifacts.$inferSelect;
		metadata: StaticIntelligenceArtifactMetadata;
		payload: StaticIntelligenceExportV1;
	};
};
