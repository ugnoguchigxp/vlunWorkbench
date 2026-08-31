import { and, asc, eq, gt, or } from "drizzle-orm";
import type { AppDatabase } from "../../../db";
import { findingEvidences, findings } from "../../../db/schema";

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

	async listFindingsPage(
		scanRunId: string,
		options: { limit: number; cursor?: string },
	) {
		const cursorFinding = options.cursor
			? await this.db.query.findings.findFirst({
					where: and(
						eq(findings.id, options.cursor),
						eq(findings.scanRunId, scanRunId),
					),
				})
			: null;
		if (options.cursor && !cursorFinding) {
			throw new Error("FINDING_CURSOR_INVALID");
		}
		const rows = await this.db.query.findings.findMany({
			where: cursorFinding
				? and(
						eq(findings.scanRunId, scanRunId),
						or(
							gt(findings.createdAt, cursorFinding.createdAt),
							and(
								eq(findings.createdAt, cursorFinding.createdAt),
								gt(findings.id, cursorFinding.id),
							),
						),
					)
				: eq(findings.scanRunId, scanRunId),
			orderBy: [asc(findings.createdAt), asc(findings.id)],
			limit: options.limit + 1,
		});
		const hasMore = rows.length > options.limit;
		const items = hasMore ? rows.slice(0, options.limit) : rows;
		return {
			items,
			nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
		};
	}

	async listEvidence(findingId: string) {
		return await this.db.query.findingEvidences.findMany({
			where: eq(findingEvidences.findingId, findingId),
		});
	}
}
