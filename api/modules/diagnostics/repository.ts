import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	attackSurfaceItems,
	diagnosticReports,
	securityCheckResults,
	securityChecks,
} from "../../db/schema";
import type {
	AttackSurfaceItemInput,
	DiagnosticReportInput,
	SecurityCheckDefinition,
	SecurityCheckResultInput,
} from "./types";

export class AttackSurfaceRepository {
	constructor(private readonly db: AppDatabase) {}

	async replaceForScan(params: {
		projectId: string;
		scanRunId: string;
		items: AttackSurfaceItemInput[];
	}) {
		await this.db
			.delete(attackSurfaceItems)
			.where(
				and(
					eq(attackSurfaceItems.projectId, params.projectId),
					eq(attackSurfaceItems.scanRunId, params.scanRunId),
				),
			);
		if (params.items.length === 0) return [];
		const now = new Date();
		return await this.db
			.insert(attackSurfaceItems)
			.values(
				params.items.map((item) => ({
					projectId: item.projectId,
					scanRunId: item.scanRunId ?? null,
					category: item.category,
					name: item.name,
					kind: item.kind,
					locationJson: item.location,
					boundaryJson: item.boundary,
					evidenceRefsJson: item.evidenceRefs,
					confidence: item.confidence,
					metadata: item.metadata ?? {},
					createdAt: now,
					updatedAt: now,
				})),
			)
			.returning();
	}

	async listForScan(projectId: string, scanRunId: string) {
		return await this.db
			.select()
			.from(attackSurfaceItems)
			.where(
				and(
					eq(attackSurfaceItems.projectId, projectId),
					eq(attackSurfaceItems.scanRunId, scanRunId),
				),
			)
			.orderBy(asc(attackSurfaceItems.category), asc(attackSurfaceItems.name));
	}
}

export class SecurityCheckRepository {
	constructor(private readonly db: AppDatabase) {}

	async upsertDefinitions(definitions: SecurityCheckDefinition[]) {
		const now = new Date();
		for (const definition of definitions) {
			const [existing] = await this.db
				.select()
				.from(securityChecks)
				.where(eq(securityChecks.checkId, definition.checkId))
				.limit(1);
			if (existing) {
				await this.db
					.update(securityChecks)
					.set({
						title: definition.title,
						category: definition.category,
						severityHint: definition.severityHint,
						description: definition.description,
						inputKindsJson: definition.inputKinds,
						enabled: true,
						updatedAt: now,
					})
					.where(eq(securityChecks.checkId, definition.checkId));
				continue;
			}
			await this.db.insert(securityChecks).values({
				checkId: definition.checkId,
				title: definition.title,
				category: definition.category,
				severityHint: definition.severityHint,
				description: definition.description,
				inputKindsJson: definition.inputKinds,
				enabled: true,
				metadata: {},
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	async replaceResultsForScan(params: {
		projectId: string;
		scanRunId: string;
		results: SecurityCheckResultInput[];
		checkIds?: string[];
	}) {
		const deleteFilter = and(
			eq(securityCheckResults.projectId, params.projectId),
			eq(securityCheckResults.scanRunId, params.scanRunId),
		);
		if (params.checkIds !== undefined) {
			for (const checkId of params.checkIds) {
				await this.db
					.delete(securityCheckResults)
					.where(and(deleteFilter, eq(securityCheckResults.checkId, checkId)));
			}
		} else {
			await this.db.delete(securityCheckResults).where(deleteFilter);
		}
		if (params.results.length === 0) return [];
		const now = new Date();
		return await this.db
			.insert(securityCheckResults)
			.values(
				params.results.map((result) => ({
					projectId: result.projectId,
					scanRunId: result.scanRunId ?? null,
					checkId: result.checkId,
					attackSurfaceItemId: result.attackSurfaceItemId ?? null,
					status: result.status,
					outcome: result.outcome ?? null,
					title: result.title,
					summary: result.summary,
					evidenceRefsJson: result.evidenceRefs,
					remediationHint: result.remediationHint ?? null,
					coverageGap: result.coverageGap ?? null,
					metadata: result.metadata ?? {},
					createdAt: now,
					updatedAt: now,
				})),
			)
			.returning();
	}

	async listResultsForScan(projectId: string, scanRunId: string) {
		return await this.db
			.select()
			.from(securityCheckResults)
			.where(
				and(
					eq(securityCheckResults.projectId, projectId),
					eq(securityCheckResults.scanRunId, scanRunId),
				),
			)
			.orderBy(
				asc(securityCheckResults.checkId),
				asc(securityCheckResults.status),
			);
	}
}

export class DiagnosticReportRepository {
	constructor(private readonly db: AppDatabase) {}

	async createReport(input: DiagnosticReportInput) {
		const now = new Date();
		const [created] = await this.db
			.insert(diagnosticReports)
			.values({
				projectId: input.projectId,
				scanRunId: input.scanRunId,
				reportKind: input.reportKind,
				status: input.status,
				summary: input.summary ?? null,
				checkedCategoriesJson: input.checkedCategories,
				coverageGapsJson: input.coverageGaps,
				residualRisksJson: input.residualRisks,
				recommendedNextActionsJson: input.recommendedNextActions,
				artifactId: input.artifactId ?? null,
				metadata: input.metadata ?? {},
				errorMessage: input.errorMessage ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateReport(
		id: string,
		input: Partial<
			Pick<
				DiagnosticReportInput,
				| "status"
				| "summary"
				| "checkedCategories"
				| "coverageGaps"
				| "residualRisks"
				| "recommendedNextActions"
				| "artifactId"
				| "metadata"
				| "errorMessage"
			>
		>,
	) {
		const updateValues: Record<string, unknown> = {
			updatedAt: new Date(),
		};
		if (input.status !== undefined) updateValues.status = input.status;
		if (input.summary !== undefined) updateValues.summary = input.summary;
		if (input.checkedCategories !== undefined) {
			updateValues.checkedCategoriesJson = input.checkedCategories;
		}
		if (input.coverageGaps !== undefined) {
			updateValues.coverageGapsJson = input.coverageGaps;
		}
		if (input.residualRisks !== undefined) {
			updateValues.residualRisksJson = input.residualRisks;
		}
		if (input.recommendedNextActions !== undefined) {
			updateValues.recommendedNextActionsJson = input.recommendedNextActions;
		}
		if (input.artifactId !== undefined)
			updateValues.artifactId = input.artifactId;
		if (input.metadata !== undefined) updateValues.metadata = input.metadata;
		if (input.errorMessage !== undefined) {
			updateValues.errorMessage = input.errorMessage;
		}
		const [updated] = await this.db
			.update(diagnosticReports)
			.set(updateValues)
			.where(eq(diagnosticReports.id, id))
			.returning();
		return updated ?? null;
	}

	async findById(id: string) {
		const [report] = await this.db
			.select()
			.from(diagnosticReports)
			.where(eq(diagnosticReports.id, id))
			.limit(1);
		return report ?? null;
	}

	async listForScan(projectId: string, scanRunId: string) {
		return await this.db
			.select()
			.from(diagnosticReports)
			.where(
				and(
					eq(diagnosticReports.projectId, projectId),
					eq(diagnosticReports.scanRunId, scanRunId),
				),
			)
			.orderBy(desc(diagnosticReports.createdAt));
	}
}
