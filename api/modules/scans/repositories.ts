import { eq, and } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	projects,
	scanRuns,
	scanEvents,
	toolRuns,
	scanArtifacts,
	findings,
	findingEvidences,
} from "../../db/schema";

export class ProjectRepository {
	constructor(private readonly db: AppDatabase) {}

	async createProject(params: {
		ownerUserId: string;
		name: string;
		repoPath: string;
		defaultBranch?: string;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(projects)
			.values({
				ownerUserId: params.ownerUserId,
				name: params.name,
				repoPath: params.repoPath,
				defaultBranch: params.defaultBranch ?? "main",
				metadata: params.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async findById(id: string) {
		return (
			(await this.db.query.projects.findFirst({
				where: eq(projects.id, id),
			})) ?? null
		);
	}

	async findByRepoPath(ownerUserId: string, repoPath: string) {
		return (
			(await this.db.query.projects.findFirst({
				where: and(
					eq(projects.ownerUserId, ownerUserId),
					eq(projects.repoPath, repoPath),
				),
			})) ?? null
		);
	}

	async findAnyByRepoPath(repoPath: string) {
		return (
			(await this.db.query.projects.findFirst({
				where: eq(projects.repoPath, repoPath),
			})) ?? null
		);
	}

	async listProjects(ownerUserId: string) {
		return await this.db.query.projects.findMany({
			where: eq(projects.ownerUserId, ownerUserId),
		});
	}
}

export class ScanRepository {
	constructor(private readonly db: AppDatabase) {}

	async createScanRun(params: {
		projectId: string;
		profile: string;
		status: string;
		createdByUserId?: string | null;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanRuns)
			.values({
				projectId: params.projectId,
				profile: params.profile,
				status: params.status,
				createdByUserId: params.createdByUserId ?? null,
				startedAt: now,
				metadata: params.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateScanRunStatus(
		id: string,
		status: string,
		options?: {
			summary?: string | null;
			completedAt?: Date | null;
			metadata?: Record<string, unknown>;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: now,
		};
		if (options?.summary !== undefined) {
			updateValues.summary = options.summary;
		}
		if (options?.completedAt !== undefined) {
			updateValues.completedAt = options.completedAt;
		} else if (
			status === "completed" ||
			status === "failed" ||
			status === "cancelled"
		) {
			updateValues.completedAt = now;
		}
		if (options?.metadata !== undefined) {
			updateValues.metadata = options.metadata;
		}

		const [updated] = await this.db
			.update(scanRuns)
			.set(updateValues)
			.where(eq(scanRuns.id, id))
			.returning();
		return updated || null;
	}

	async findById(id: string) {
		return (
			(await this.db.query.scanRuns.findFirst({
				where: eq(scanRuns.id, id),
			})) ?? null
		);
	}

	async listScanRuns(projectId: string) {
		return await this.db.query.scanRuns.findMany({
			where: eq(scanRuns.projectId, projectId),
		});
	}

	async listScanRunsByProject(projectId: string) {
		return await this.db.query.scanRuns.findMany({
			where: eq(scanRuns.projectId, projectId),
		});
	}

	async createScanEvent(params: {
		scanRunId: string;
		level: "debug" | "info" | "warn" | "error";
		eventType: string;
		message: string;
		data?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanEvents)
			.values({
				scanRunId: params.scanRunId,
				level: params.level,
				eventType: params.eventType,
				message: params.message,
				data: params.data ?? {},
				createdAt: now,
			})
			.returning();
		return created;
	}

	async listScanEvents(scanRunId: string) {
		return await this.db.query.scanEvents.findMany({
			where: eq(scanEvents.scanRunId, scanRunId),
		});
	}

	async createToolRun(params: {
		scanRunId: string;
		toolName: string;
		toolVersion?: string | null;
		command?: string | null;
		status: string;
		exitCode?: number | null;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(toolRuns)
			.values({
				scanRunId: params.scanRunId,
				toolName: params.toolName,
				toolVersion: params.toolVersion ?? null,
				command: params.command ?? null,
				status: params.status,
				exitCode: params.exitCode ?? null,
				startedAt: now,
				metadata: params.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateToolRunStatus(
		id: string,
		status: string,
		options?: {
			exitCode?: number | null;
			metadata?: Record<string, unknown>;
			completedAt?: Date | null;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: now,
		};
		if (options?.exitCode !== undefined) {
			updateValues.exitCode = options.exitCode;
		}
		if (options?.metadata !== undefined) {
			updateValues.metadata = options.metadata;
		}
		if (options?.completedAt !== undefined) {
			updateValues.completedAt = options.completedAt;
		} else if (status === "completed" || status === "failed") {
			updateValues.completedAt = now;
		}

		const [updated] = await this.db
			.update(toolRuns)
			.set(updateValues)
			.where(eq(toolRuns.id, id))
			.returning();
		return updated || null;
	}
}

export class ArtifactRepository {
	constructor(private readonly db: AppDatabase) {}

	async createArtifact(params: {
		scanRunId: string;
		toolRunId: string | null;
		kind: string;
		format: string;
		path: string;
		sha256: string;
		sizeBytes: number;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanArtifacts)
			.values({
				scanRunId: params.scanRunId,
				toolRunId: params.toolRunId ?? null,
				kind: params.kind,
				format: params.format,
				path: params.path,
				sha256: params.sha256,
				sizeBytes: params.sizeBytes,
				metadata: params.metadata ?? {},
				createdAt: now,
			})
			.returning();
		return created;
	}

	async listArtifacts(scanRunId: string) {
		return await this.db.query.scanArtifacts.findMany({
			where: eq(scanArtifacts.scanRunId, scanRunId),
		});
	}
}

export class FindingRepository {
	constructor(private readonly db: AppDatabase) {}

	async createFinding(params: {
		scanRunId: string;
		projectId: string;
		sourceTool: string;
		ruleId: string;
		title: string;
		description: string;
		severity: string;
		confidence: string;
		status: string;
		primaryLocation: Record<string, unknown> | null;
		fingerprint: string;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(findings)
			.values({
				scanRunId: params.scanRunId,
				projectId: params.projectId,
				sourceTool: params.sourceTool,
				ruleId: params.ruleId,
				title: params.title,
				description: params.description,
				severity: params.severity,
				confidence: params.confidence,
				status: params.status,
				primaryLocation: params.primaryLocation,
				fingerprint: params.fingerprint,
				metadata: params.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async createEvidence(params: {
		findingId: string;
		kind: string;
		title: string;
		artifactId: string | null;
		location: Record<string, unknown> | null;
		snippet?: string | null;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(findingEvidences)
			.values({
				findingId: params.findingId,
				kind: params.kind,
				title: params.title,
				artifactId: params.artifactId,
				location: params.location,
				snippet: params.snippet ?? null,
				metadata: params.metadata ?? {},
				createdAt: now,
			})
			.returning();
		return created;
	}

	async findById(id: string) {
		return (
			(await this.db.query.findings.findFirst({
				where: eq(findings.id, id),
			})) ?? null
		);
	}

	async listFindings(scanRunId: string) {
		return await this.db.query.findings.findMany({
			where: eq(findings.scanRunId, scanRunId),
		});
	}

	async listEvidence(findingId: string) {
		return await this.db.query.findingEvidences.findMany({
			where: eq(findingEvidences.findingId, findingId),
		});
	}
}
