import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
	type StaticIntelligenceExportV1,
	staticIntelligenceExportV1Schema,
} from "../../../shared/schemas/static-intelligence.schema";
import {
	type CodeStructureSnapshot,
	codeStructureSnapshotSchema,
} from "../../../shared/schemas/static-intelligence-code-structure.schema";
import type { AppDatabase } from "../../db";
import { scanArtifacts, scanRuns } from "../../db/schema";
import {
	type ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import {
	buildSnapshotRef,
	buildSourceStateHash,
	buildSourceTreeHash,
	buildStaticIntelligenceExportHash,
	isStaticIntelligenceDerivedArtifact,
	STATIC_INTELLIGENCE_DERIVED_ARTIFACT_KINDS,
	type StaticIntelligenceArtifactMetadata,
	type StaticIntelligenceSourceRevision,
	sha256Text,
	staticIntelligenceArtifactMetadataSchema,
	uniqueSorted,
} from "./generation-types";
import { StaticIntelligenceRepository } from "./repository";
import type { StaticIntelligenceSourceBundle } from "./types";

const STRUCTURE_KIND = "code_structure_snapshot";
const EXPORT_KIND = "static_intelligence_export";

export class StaticIntelligenceGenerationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StaticIntelligenceGenerationValidationError";
	}
}

export type PersistStaticIntelligenceGenerationInput = {
	scanRunId: string;
	snapshot: CodeStructureSnapshot;
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
	export: {
		artifact: typeof scanArtifacts.$inferSelect;
		metadata: StaticIntelligenceArtifactMetadata;
		payload: StaticIntelligenceExportV1;
	};
};

export class StaticIntelligenceGenerationRepository {
	constructor(
		private readonly db: AppDatabase,
		private readonly artifactStorage = new ArtifactStorage(),
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
		const exportPayload = staticIntelligenceExportV1Schema.parse(
			input.exportPayload,
		);
		this.assertPayloadOwnership({ bundle, snapshot, exportPayload });

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
		const exportHash = buildStaticIntelligenceExportHash(exportPayload);
		const degradedReasons = uniqueSorted([
			...snapshot.degradedReasons,
			...exportPayload.scanSummary.degradedReasons,
		]);
		const status =
			snapshot.status === "partial" || degradedReasons.length > 0
				? "degraded"
				: "available";
		const generatedAt = exportPayload.generatedAt;
		const sourceRevision = input.sourceRevision ?? {
			kind: "tree_hash_only" as const,
			value: sourceTreeHash,
		};
		const existingGeneration = await this.generationCandidates(
			input.scanRunId,
			generationId,
		);
		if (existingGeneration.length > 0) {
			throw new StaticIntelligenceGenerationValidationError(
				`Generation already exists: ${generationId}`,
			);
		}
		const directory = `derived/static-intelligence/${generationId}`;
		const structureContent = JSON.stringify(snapshot);
		const exportContent = JSON.stringify(exportPayload);
		const savedArtifacts =
			await this.artifactStorage.saveTextArtifactsAtomically(input.scanRunId, [
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

		const [structureSaved, exportSaved] = savedArtifacts;
		if (!structureSaved || !exportSaved) {
			await this.artifactStorage.removeArtifacts(
				savedArtifacts.map((artifact) => artifact.path),
			);
			throw new StaticIntelligenceGenerationValidationError(
				"Generation persistence did not produce both artifact files.",
			);
		}

		try {
			const structureMetadata = this.buildMetadata({
				generationId,
				projectId: bundle.project.id,
				scanRunId: input.scanRunId,
				artifactRole: "structure",
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
			const rows = await this.db.transaction(async (tx) =>
				tx
					.insert(scanArtifacts)
					.values([
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
					.returning(),
			);
			const [structureArtifact, exportArtifact] = rows;
			if (!structureArtifact || !exportArtifact) {
				throw new StaticIntelligenceGenerationValidationError(
					"Generation persistence did not create both artifact rows.",
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

	async loadLatestValidGeneration(
		scanRunId: string,
	): Promise<PersistedStaticIntelligenceGeneration | null> {
		const candidates = await this.generationCandidates(scanRunId);
		for (const candidate of candidates) {
			const loaded = await this.loadCandidate(scanRunId, candidate);
			if (loaded) return loaded;
		}
		return null;
	}

	async loadGeneration(
		scanRunId: string,
		generationId: string,
	): Promise<PersistedStaticIntelligenceGeneration | null> {
		const candidates = await this.generationCandidates(scanRunId, generationId);
		const [candidate] = candidates;
		if (!candidate) return null;
		const loaded = await this.loadCandidate(scanRunId, candidate);
		if (!loaded) {
			throw new StaticIntelligenceGenerationValidationError(
				`Generation is incomplete or invalid: ${generationId}`,
			);
		}
		return loaded;
	}

	async listLatestValidGenerationsByRootRef(input: {
		rootRef: string;
		projectId?: string;
		limit: number;
	}): Promise<PersistedStaticIntelligenceGeneration[]> {
		const predicates = [
			inArray(scanArtifacts.kind, [
				...STATIC_INTELLIGENCE_DERIVED_ARTIFACT_KINDS,
			]),
			sql`json_extract(${scanArtifacts.metadata}, '$.rootRef') = ${input.rootRef}`,
		];
		if (input.projectId) {
			predicates.push(
				sql`json_extract(${scanArtifacts.metadata}, '$.projectId') = ${input.projectId}`,
			);
		}
		const rows = await this.db
			.select()
			.from(scanArtifacts)
			.where(and(...predicates));
		const candidateGroups = new Map<
			string,
			{
				scanRunId: string;
				generationId: string;
				artifacts: Array<typeof scanArtifacts.$inferSelect>;
			}
		>();
		for (const row of rows) {
			const parsed = staticIntelligenceArtifactMetadataSchema.safeParse(
				row.metadata,
			);
			if (
				!parsed.success ||
				parsed.data.rootRef !== input.rootRef ||
				(input.projectId !== undefined &&
					parsed.data.projectId !== input.projectId) ||
				parsed.data.scanRunId !== row.scanRunId
			) {
				continue;
			}
			const key = JSON.stringify([row.scanRunId, parsed.data.generationId]);
			const group = candidateGroups.get(key) ?? {
				scanRunId: row.scanRunId,
				generationId: parsed.data.generationId,
				artifacts: [],
			};
			group.artifacts.push(row);
			candidateGroups.set(key, group);
		}
		const generations: PersistedStaticIntelligenceGeneration[] = [];
		for (const candidate of candidateGroups.values()) {
			const generation = await this.loadCandidate(
				candidate.scanRunId,
				candidate,
			);
			if (
				generation &&
				generation.structure.metadata.rootRef === input.rootRef &&
				(input.projectId === undefined ||
					generation.projectId === input.projectId)
			) {
				generations.push(generation);
			}
		}
		return generations
			.sort(
				(left, right) =>
					right.structure.metadata.generatedAt.localeCompare(
						left.structure.metadata.generatedAt,
					) || left.generationId.localeCompare(right.generationId),
			)
			.slice(0, input.limit);
	}

	async hasDerivedArtifacts(scanRunId: string): Promise<boolean> {
		const [row] = await this.db
			.select({ id: scanArtifacts.id })
			.from(scanArtifacts)
			.where(
				and(
					eq(scanArtifacts.scanRunId, scanRunId),
					inArray(scanArtifacts.kind, [
						...STATIC_INTELLIGENCE_DERIVED_ARTIFACT_KINDS,
					]),
				),
			)
			.limit(1);
		return Boolean(row);
	}

	private async generationCandidates(scanRunId: string, generationId?: string) {
		const rows = await this.db
			.select()
			.from(scanArtifacts)
			.where(
				and(
					eq(scanArtifacts.scanRunId, scanRunId),
					inArray(scanArtifacts.kind, [
						...STATIC_INTELLIGENCE_DERIVED_ARTIFACT_KINDS,
					]),
				),
			);
		const groups = new Map<string, typeof rows>();
		for (const row of rows) {
			const parsed = staticIntelligenceArtifactMetadataSchema.safeParse(
				row.metadata,
			);
			if (!parsed.success) continue;
			if (generationId && parsed.data.generationId !== generationId) continue;
			const group = groups.get(parsed.data.generationId) ?? [];
			group.push(row);
			groups.set(parsed.data.generationId, group);
		}
		return [...groups.entries()]
			.map(([id, artifacts]) => ({
				generationId: id,
				artifacts,
				generatedAt: this.latestGeneratedAt(artifacts),
			}))
			.sort(
				(left, right) =>
					right.generatedAt.localeCompare(left.generatedAt) ||
					left.generationId.localeCompare(right.generationId),
			);
	}

	private latestGeneratedAt(
		artifacts: Array<typeof scanArtifacts.$inferSelect>,
	): string {
		return (
			artifacts
				.map((artifact) =>
					staticIntelligenceArtifactMetadataSchema.safeParse(artifact.metadata),
				)
				.filter((result) => result.success)
				.map(
					(result) =>
						(result as { data: StaticIntelligenceArtifactMetadata }).data
							.generatedAt,
				)
				.sort((left, right) => right.localeCompare(left))[0] ?? ""
		);
	}

	private async loadCandidate(
		scanRunId: string,
		candidate: {
			generationId: string;
			artifacts: Array<typeof scanArtifacts.$inferSelect>;
		},
	): Promise<PersistedStaticIntelligenceGeneration | null> {
		const structureArtifacts = candidate.artifacts.filter(
			(artifact) => artifact.kind === STRUCTURE_KIND,
		);
		const exportArtifacts = candidate.artifacts.filter(
			(artifact) => artifact.kind === EXPORT_KIND,
		);
		const [structureArtifact] = structureArtifacts;
		const [exportArtifact] = exportArtifacts;
		if (
			structureArtifacts.length !== 1 ||
			exportArtifacts.length !== 1 ||
			!structureArtifact ||
			!exportArtifact
		) {
			return null;
		}
		const structureMetadata =
			staticIntelligenceArtifactMetadataSchema.safeParse(
				structureArtifact.metadata,
			);
		const exportMetadata = staticIntelligenceArtifactMetadataSchema.safeParse(
			exportArtifact.metadata,
		);
		if (!structureMetadata.success || !exportMetadata.success) return null;
		const projectId = await this.projectIdForScan(scanRunId);
		if (
			!projectId ||
			structureMetadata.data.projectId !== projectId ||
			exportMetadata.data.projectId !== projectId
		) {
			return null;
		}

		try {
			const [structureContent, exportContent] = await Promise.all([
				this.artifactStorage.readTextArtifact(structureArtifact.path),
				this.artifactStorage.readTextArtifact(exportArtifact.path),
			]);
			if (
				sha256Text(structureContent) !== structureArtifact.sha256 ||
				sha256Text(exportContent) !== exportArtifact.sha256 ||
				sha256Text(structureContent) !== structureMetadata.data.contentHash ||
				sha256Text(exportContent) !== exportMetadata.data.contentHash
			) {
				return null;
			}
			const snapshot = codeStructureSnapshotSchema.parse(
				JSON.parse(structureContent),
			);
			const payload = staticIntelligenceExportV1Schema.parse(
				JSON.parse(exportContent),
			);
			this.assertLoadedPair({
				scanRunId,
				generationId: candidate.generationId,
				structureArtifact,
				exportArtifact,
				structureMetadata: structureMetadata.data,
				exportMetadata: exportMetadata.data,
				snapshot,
				payload,
			});
			return {
				generationId: candidate.generationId,
				projectId: structureMetadata.data.projectId,
				scanRunId: structureMetadata.data.scanRunId,
				status:
					structureMetadata.data.status === "degraded" ||
					exportMetadata.data.status === "degraded"
						? "degraded"
						: "available",
				structure: {
					artifact: structureArtifact,
					metadata: structureMetadata.data,
					snapshot,
				},
				export: {
					artifact: exportArtifact,
					metadata: exportMetadata.data,
					payload,
				},
			};
		} catch {
			return null;
		}
	}

	private buildMetadata(
		metadata: StaticIntelligenceArtifactMetadata,
	): StaticIntelligenceArtifactMetadata {
		return staticIntelligenceArtifactMetadataSchema.parse(metadata);
	}

	private artifactRow(params: {
		scanRunId: string;
		kind: typeof STRUCTURE_KIND | typeof EXPORT_KIND;
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
		exportPayload: StaticIntelligenceExportV1;
	}) {
		const { bundle, snapshot, exportPayload } = params;
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
			exportPayload.project.id !== bundle.project.id ||
			exportPayload.scan.id !== bundle.scanRun.id
		) {
			throw new StaticIntelligenceGenerationValidationError(
				"Static Intelligence export does not match scan project.",
			);
		}
	}

	private assertLoadedPair(params: {
		scanRunId: string;
		generationId: string;
		structureArtifact: typeof scanArtifacts.$inferSelect;
		exportArtifact: typeof scanArtifacts.$inferSelect;
		structureMetadata: StaticIntelligenceArtifactMetadata;
		exportMetadata: StaticIntelligenceArtifactMetadata;
		snapshot: CodeStructureSnapshot;
		payload: StaticIntelligenceExportV1;
	}) {
		const {
			scanRunId,
			generationId,
			structureArtifact,
			exportArtifact,
			structureMetadata,
			exportMetadata,
			snapshot,
			payload,
		} = params;
		if (
			!isStaticIntelligenceDerivedArtifact(structureArtifact.kind) ||
			!isStaticIntelligenceDerivedArtifact(exportArtifact.kind) ||
			structureArtifact.scanRunId !== scanRunId ||
			exportArtifact.scanRunId !== scanRunId ||
			structureMetadata.generationId !== generationId ||
			exportMetadata.generationId !== generationId ||
			structureMetadata.artifactRole !== "structure" ||
			exportMetadata.artifactRole !== "export" ||
			structureMetadata.projectId !== exportMetadata.projectId ||
			structureMetadata.scanRunId !== exportMetadata.scanRunId ||
			structureMetadata.scanRunId !== scanRunId ||
			structureMetadata.generatedAt !== exportMetadata.generatedAt ||
			structureMetadata.status !== exportMetadata.status ||
			JSON.stringify(structureMetadata.sourceRevision) !==
				JSON.stringify(exportMetadata.sourceRevision) ||
			JSON.stringify(structureMetadata.degradedReasons) !==
				JSON.stringify(exportMetadata.degradedReasons) ||
			structureMetadata.rootRef !== exportMetadata.rootRef ||
			structureMetadata.sourceTreeHash !== exportMetadata.sourceTreeHash ||
			structureMetadata.sourceStateHash !== exportMetadata.sourceStateHash ||
			snapshot.project.rootRef !== structureMetadata.rootRef ||
			(snapshot.project.id !== undefined &&
				snapshot.project.id !== structureMetadata.projectId) ||
			payload.project.id !== structureMetadata.projectId ||
			payload.scan.id !== structureMetadata.scanRunId ||
			structureMetadata.snapshotRef !==
				buildSnapshotRef({
					rootRef: structureMetadata.rootRef,
					sourceTreeHash: structureMetadata.sourceTreeHash,
				}) ||
			exportMetadata.exportHash !== buildStaticIntelligenceExportHash(payload)
		) {
			throw new StaticIntelligenceGenerationValidationError(
				"Persisted generation pair failed validation.",
			);
		}
	}

	private async projectIdForScan(scanRunId: string): Promise<string | null> {
		const [row] = await this.db
			.select({ projectId: scanRuns.projectId })
			.from(scanRuns)
			.where(eq(scanRuns.id, scanRunId))
			.limit(1);
		return row?.projectId ?? null;
	}
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
}
