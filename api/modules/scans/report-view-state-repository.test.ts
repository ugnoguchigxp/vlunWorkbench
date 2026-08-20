import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	projects,
	scanReports,
	scanReportUserViews,
	scanRuns,
	users,
} from "../../db/schema";
import { ReportViewStateRepository } from "./report-view-state-repository";

describe("ReportViewStateRepository", () => {
	let connection: DbConnection;
	let userId: string;
	let reportId: string;
	let repository: ReportViewStateRepository;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const filename of readdirSync(path.resolve(process.cwd(), "drizzle"))
			.filter((file) => file.endsWith(".sql"))
			.sort((left, right) => left.localeCompare(right))) {
			connection.sqlite.exec(
				readFileSync(path.resolve(process.cwd(), "drizzle", filename), "utf8"),
			);
		}
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "report-viewer@example.com",
				passwordHash: "hash",
				displayName: "Report Viewer",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		if (!user) throw new Error("test user was not created");
		userId = user.id;
		const [project] = await connection.db
			.insert(projects)
			.values({
				id: "project-1",
				ownerUserId: userId,
				name: "Code",
				repoPath: "/tmp/code",
				defaultBranch: "main",
				metadata: {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		if (!project) throw new Error("test project was not created");
		const [scan] = await connection.db
			.insert(scanRuns)
			.values({ projectId: "project-1", profile: "baseline", status: "completed", createdAt: now, updatedAt: now })
			.returning();
		if (!scan) throw new Error("test scan was not created");
		const [report] = await connection.db
			.insert(scanReports)
			.values({ scanRunId: scan.id, format: "markdown", title: "Report", options: {}, status: "completed", createdAt: now, updatedAt: now })
			.returning();
		if (!report) throw new Error("test report was not created");
		reportId = report.id;
		repository = new ReportViewStateRepository(connection.db);
	});

	afterEach(() => connection.sqlite.close());

	it("keeps the first LLM acknowledgement timestamp", async () => {
		expect(await repository.get(reportId, userId)).toBeNull();
		const first = await repository.markLlmCommentSeen(reportId, userId);
		const second = await repository.markLlmCommentSeen(reportId, userId);
		expect(first.llmCommentSeenAt).toBeInstanceOf(Date);
		expect(second.llmCommentSeenAt?.getTime()).toBe(
			first.llmCommentSeenAt?.getTime(),
		);
	});

	it("returns a persisted timestamp when concurrent acknowledgements update a legacy unseen row", async () => {
		const now = new Date();
		await connection.db.insert(scanReportUserViews).values({
			reportId,
			userId,
			llmCommentSeenAt: null,
			createdAt: now,
			updatedAt: now,
		});

		const acknowledgements = await Promise.all([
			repository.markLlmCommentSeen(reportId, userId),
			repository.markLlmCommentSeen(reportId, userId),
		]);

		for (const acknowledgement of acknowledgements) {
			expect(acknowledgement.llmCommentSeenAt).toBeInstanceOf(Date);
		}
	});
});
