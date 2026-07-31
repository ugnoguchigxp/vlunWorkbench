import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import {
	type ProjectStructureSnapshotV2,
	projectStructureSnapshotV2Schema,
} from "../../../shared/schemas/project-structure.schema";
import {
	type StaticIntelligenceExportV1,
	staticIntelligenceExportV1Schema,
} from "../../../shared/schemas/static-intelligence.schema";
import {
	type CodeStructureSnapshot,
	codeStructureSnapshotSchema,
} from "../../../shared/schemas/static-intelligence-code-structure.schema";
import type { AppDatabase } from "../../db";
import { scanArtifacts } from "../../db/schema";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import {
	type PersistedStaticIntelligenceGeneration,
	type PersistStaticIntelligenceGenerationInput,
	StaticIntelligenceGenerationValidationError,
} from "./generation-repository-types";
import {
	buildProjectStructureSnapshotRef,
	buildSnapshotRef,
	buildSourceStateHash,
	buildSourceTreeHash,
	buildStaticIntelligenceExportHash,
	type StaticIntelligenceArtifactMetadata,
	staticIntelligenceArtifactMetadataSchema,
	uniqueSorted,
} from "./generation-types";
import { StaticIntelligenceRepository } from "./repository";
import type { StaticIntelligenceSourceBundle } from "./types";

const STRUCTURE_KIND = "code_structure_snapshot";
const PROJECT_STRUCTURE_KIND = "project_structure_snapshot";
const EXPORT_KIND = "static_intelligence_export";

export class StaticIntelligenceGenerationPersister {
	constructor(
		private readonly db: AppDatabase,
		private readonly artifactStorage: ArtifactStorage,
		private readonly generationExists: (
			scanRunId: string,
			generationId: string,
		) => Promise<boolean>,
	) {}

	async persistGeneration(
		input: PersistStaticIntelligenceGenerationInput,
	): Promise<PersistedStaticIntelligenceGeneration> {
		const sourceRepository = new StaticIntelligenceRepository(this.db);
		const bundle = await sourceRepository.loadSourceBundle(input.scanRunId);
		if (!bundle) {
			throw new StaticIntelligenceGenerationValidationError(
				`Scan run not found: ${input.scanRunId}`,
			);
		}

		const snapshot = codeStructureSnapshotSchema.parse(input.snapshot);
		const projectStructureSnapshot = projectStructureSnapshotV2Schema.parse(
			input.projectStructureSnapshot,
		);
		const exportPayload = staticIntelligenceExportV1Schema.parse(
			input.exportPayload,
		);
		this.assertPayloadOwnership({
			bundle,
			snapshot,
			projectStructureSnapshot,
			exportPayload,
		});

		const generationId = input.generationId ?? randomUUID();
		if (!isUuid(generationId)) {
			throw new StaticIntelligenceGenerationValidationError(
				"generationId must be a UUID.",
			);
		}
		const sourceTreeHash = buildSourceTreeHash(snapshot);
		const sourceStateHash = buildSourceStateHash(bundle);
		if (
			input.expectedSourceStateHash !== undefined &&
			input.expectedSourceStateHash !== sourceStateHash
		) {
			throw new StaticIntelligenceGenerationValidationError(
				"Scan source state changed before generation persistence.",
			);
		}
		const snapshotRef = buildSnapshotRef({
			rootRef: snapshot.project.rootRef,
			sourceTreeHash,
		});
		const projectStructureSnapshotRef = buildProjectStructureSnapshotRef({
			rootRef: projectStructureSnapshot.project.rootRef,
			structureInputHash: projectStructureSnapshot.structureInputHash,
		});
		const exportHash = buildStaticIntelligenceExportHash(exportPayload);
		const degradedReasons = uniqueSorted([
			...snapshot.degradedReasons,
			...projectStructureSnapshot.diagnostics
				.filter((diagnostic) => diagnostic.impact !== "none")
				.map((diagnostic) => diagnostic.code),
			...exportPayload.scanSummary.degradedReasons,
		]);
		const status =
			snapshot.status === "partial" ||
			projectStructureSnapshot.status === "partial" ||
			degradedReasons.length > 0
				? "degraded"
				: "available";
		const generatedAt = exportPayload.generatedAt;
		const sourceRevision = input.sourceRevision ?? {
			kind: "tree_hash_only" as const,
			value: sourceTreeHash,
		};
		if (await this.generationExists(input.scanRunId, generationId)) {
			throw new StaticIntelligenceGenerationValidationError(
				`Generation already exists: ${generationId}`,
			);
		}
		const directory = `derived/static-intelligence/${generationId}`;
		const structureContent = JSON.stringify(snapshot);
		const projectStructureContent = JSON.stringify(projectStructureSnapshot);
		const exportContent = JSON.stringify(exportPayload);
		const savedArtifacts =
			await this.artifactStorage.saveTextArtifactsAtomically(input.scanRunId, [
				{
					subDir: directory,
					filename: "project-structure.json",
					content: projectStructureContent,
				},
				{
					subDir: directory,
					filename: "code-structure.json",
					content: structureContent,
				},
				{
					subDir: directory,
					filename: "static-intelligence.json",
					content: exportContent,
				},
			]);

		const [projectStructureSaved, structureSaved, exportSaved] = savedArtifacts;
		if (!structureSaved || !exportSaved || !projectStructureSaved) {
			await this.artifactStorage.removeArtifacts(
				savedArtifacts.map((artifact) => artifact.path),
			);
			throw new StaticIntelligenceGenerationValidationError(
				"Generation persistence did not produce the complete artifact set.",
			);
		}

		try {
			const projectStructureMetadata = this.buildMetadata({
				generationId,
				projectId: bundle.project.id,
				scanRunId: input.scanRunId,
				artifactRole: "project_structure",
				generationFormat: "project_structure_v2",
				schemaVersion: "project-structure-v2",
				status,
				generatedAt,
				sourceTreeHash,
				sourceStateHash,
				sourceRevision,
				rootRef: projectStructureSnapshot.project.rootRef,
				structureInputHash: projectStructureSnapshot.structureInputHash,
				snapshotRef: projectStructureSnapshotRef,
				contentHash: projectStructureSaved.sha256,
				degradedReasons,
				summary: {
					fileCount: projectStructureSnapshot.summary.fileCount,
					resolvedReferenceCount:
						projectStructureSnapshot.summary.resolvedReferenceCount,
				},
			});
			const structureMetadata = this.buildMetadata({
				generationId,
				projectId: bundle.project.id,
				scanRunId: input.scanRunId,
				artifactRole: "structure",
				generationFormat: "project_structure_v2",
				schemaVersion: "code-structure-v1",
				status,
				generatedAt,
				sourceTreeHash,
				sourceStateHash,
				sourceRevision,
				rootRef: snapshot.project.rootRef,
				snapshotRef,
				contentHash: structureSaved.sha256,
				degradedReasons,
				summary: {
					fileCount: snapshot.summary.fileCount,
					parsedFileCount: snapshot.summary.parsedFileCount,
				},
			});
			const exportMetadata = this.buildMetadata({
				generationId,
				projectId: bundle.project.id,
				scanRunId: input.scanRunId,
				artifactRole: "export",
				generationFormat: "project_structure_v2",
				schemaVersion: "static-intelligence-export-v1",
				status,
				generatedAt,
				sourceTreeHash,
				sourceStateHash,
				sourceRevision,
				rootRef: snapshot.project.rootRef,
				exportHash,
				contentHash: exportSaved.sha256,
				degradedReasons,
				summary: {
					findingCount: exportPayload.scan.findingCount,
					artifactCount: exportPayload.scan.artifactCount,
				},
			});

			const createdAt = new Date();
			const rows = await this.db
				.insert(scanArtifacts)
				.values([
					this.artifactRow({
						scanRunId: input.scanRunId,
						kind: PROJECT_STRUCTURE_KIND,
						saved: projectStructureSaved,
						metadata: projectStructureMetadata,
						createdAt,
					}),
					this.artifactRow({
						scanRunId: input.scanRunId,
						kind: STRUCTURE_KIND,
						saved: structureSaved,
						metadata: structureMetadata,
						createdAt,
					}),
					this.artifactRow({
						scanRunId: input.scanRunId,
						kind: EXPORT_KIND,
						saved: exportSaved,
						metadata: exportMetadata,
						createdAt,
					}),
				])
				.returning();
			const projectStructureArtifact = rows.find(
				(artifact) => artifact.kind === PROJECT_STRUCTURE_KIND,
			);
			const structureArtifact = rows.find(
				(artifact) => artifact.kind === STRUCTURE_KIND,
			);
			const exportArtifact = rows.find(
				(artifact) => artifact.kind === EXPORT_KIND,
			);
			if (!projectStructureArtifact || !structureArtifact || !exportArtifact) {
				throw new StaticIntelligenceGenerationValidationError(
					"Generation persistence did not create the complete artifact set.",
				);
			}
			return {
				generationId,
				projectId: bundle.project.id,
				scanRunId: input.scanRunId,
				status,
				structure: {
					artifact: structureArtifact,
					metadata: structureMetadata,
					snapshot,
				},
				projectStructure: {
					artifact: projectStructureArtifact,
					metadata: projectStructureMetadata,
					snapshot: projectStructureSnapshot,
				},
				export: {
					artifact: exportArtifact,
					metadata: exportMetadata,
					payload: exportPayload,
				},
			};
		} catch (error) {
			await this.artifactStorage
				.removeArtifacts(savedArtifacts.map((artifact) => artifact.path))
				.catch(() => undefined);
			throw error;
		}
	}

	private buildMetadata(
		metadata: StaticIntelligenceArtifactMetadata,
	): StaticIntelligenceArtifactMetadata {
		return staticIntelligenceArtifactMetadataSchema.parse(metadata);
	}

	private artifactRow(params: {
		scanRunId: string;
		kind:
			| typeof PROJECT_STRUCTURE_KIND
			| typeof STRUCTURE_KIND
			| typeof EXPORT_KIND;
		saved: ArtifactSaveResult;
		metadata: StaticIntelligenceArtifactMetadata;
		createdAt: Date;
	}) {
		return {
			scanRunId: params.scanRunId,
			kind: params.kind,
			format: "json",
			path: params.saved.path,
			sha256: params.saved.sha256,
			sizeBytes: params.saved.sizeBytes,
			metadata: params.metadata,
			createdAt: params.createdAt,
		};
	}

	private assertPayloadOwnership(params: {
		bundle: StaticIntelligenceSourceBundle;
		snapshot: CodeStructureSnapshot;
		projectStructureSnapshot?: ProjectStructureSnapshotV2;
		exportPayload: StaticIntelligenceExportV1;
	}) {
		const { bundle, snapshot, projectStructureSnapshot, exportPayload } =
			params;
		if (!bundle) {
			throw new StaticIntelligenceGenerationValidationError(
				"Static Intelligence source bundle is required.",
			);
		}
		if (snapshot.project.id && snapshot.project.id !== bundle.project.id) {
			throw new StaticIntelligenceGenerationValidationError(
				"Code structure snapshot project id does not match scan project.",
			);
		}
		let realProjectPath: string;
		try {
			realProjectPath = fs.realpathSync(bundle.project.repoPath);
		} catch {
			throw new StaticIntelligenceGenerationValidationError(
				"Code structure snapshot project root could not be verified.",
			);
		}
		const expectedRootRef = createHash("sha256")
			.update(realProjectPath)
			.digest("hex");
		if (snapshot.project.rootRef !== expectedRootRef) {
			throw new StaticIntelligenceGenerationValidationError(
				"Code structure snapshot rootRef does not match scan project.",
			);
		}
		if (
			projectStructureSnapshot?.project.id &&
			projectStructureSnapshot.project.id !== bundle.project.id
		) {
			throw new StaticIntelligenceGenerationValidationError(
				"Project structure snapshot project id does not match scan project.",
			);
		}
		if (
			projectStructureSnapshot &&
			projectStructureSnapshot.project.rootRef !== expectedRootRef
		) {
			throw new StaticIntelligenceGenerationValidationError(
				"Project structure snapshot rootRef does not match scan project.",
			);
		}
		if (
			exportPayload.project.id !== bundle.project.id ||
			exportPayload.scan.id !== bundle.scanRun.id
		) {
			throw new StaticIntelligenceGenerationValidationError(
				"Static Intelligence export does not match scan project.",
			);
		}
	}
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
}
