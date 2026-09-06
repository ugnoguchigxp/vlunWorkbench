import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./schema-core";
import { id, jsonObject, timestampMs } from "./schema-helpers";
import { projects, scanArtifacts, scanRuns } from "./schema-scans";

export const scanReports = sqliteTable(
	"scan_reports",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		artifactId: text("artifact_id").references(() => scanArtifacts.id, {
			onDelete: "set null",
		}),
		format: text("format").notNull(), // markdown
		/** preliminary reports are historical; one canonical_final is current per scan. */
		stage: text("stage").notNull().default("preliminary"),
		title: text("title").notNull(),
		summary: text("summary"),
		options: jsonObject("options"),
		status: text("status").notNull(), // queued, running, completed, failed
		attemptCount: integer("attempt_count").notNull().default(0),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		retryable: integer("retryable", { mode: "boolean" }),
		generatedByUserId: text("generated_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		// Self-reference is enforced by the migration. Keeping the column plain
		// avoids a circular Drizzle table initializer while preserving the FK in SQL.
		supersedesReportId: text("supersedes_report_id"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_reports_scan_run_id_idx").on(table.scanRunId),
		artifactIdIdx: index("scan_reports_artifact_id_idx").on(table.artifactId),
		statusIdx: index("scan_reports_status_idx").on(table.status),
		stageScanRunIdx: index("scan_reports_stage_scan_run_idx").on(
			table.stage,
			table.scanRunId,
		),
	}),
);

export type ProjectArtifactCleanupManifest = {
	scanRunIds: string[];
	dastRunIds: string[];
	dynamicRunIds: string[];
	reproductionRunIds: string[];
};

/**
 * Durable server-owned artifact cleanup ledger.
 * The legacy table name is retained because project and scan deletion share the
 * same idempotent manifest runner and recovery lifecycle.
 */
export const projectDeletionCleanupJobs = sqliteTable(
	"project_deletion_cleanup_jobs",
	{
		id: id(),
		ownerUserId: text("owner_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		// These remain audit values even after the owning project or scan is deleted.
		projectId: text("project_id").notNull(),
		projectName: text("project_name").notNull(),
		manifest: text("manifest_json", { mode: "json" })
			.$type<ProjectArtifactCleanupManifest>()
			.notNull(),
		status: text("status").notNull().default("pending"),
		attemptCount: integer("attempt_count").notNull().default(0),
		lastError: text("last_error"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		statusCreatedIdx: index(
			"project_deletion_cleanup_jobs_status_created_idx",
		).on(table.status, table.createdAt),
	}),
);

export const scanReportUserViews = sqliteTable(
	"scan_report_user_views",
	{
		reportId: text("report_id")
			.notNull()
			.references(() => scanReports.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		llmCommentSeenAt: integer("llm_comment_seen_at", {
			mode: "timestamp_ms",
		}),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.reportId, table.userId] }),
		userUpdatedIdx: index("scan_report_user_views_user_updated_idx").on(
			table.userId,
			table.updatedAt,
		),
	}),
);

export const scanReviews = sqliteTable(
	"scan_reviews",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		status: text("status").notNull(),
		summary: text("summary"),
		riskOverview: text("risk_overview"),
		priorityNotes: text("priority_notes_json", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`)
			.notNull(),
		coverageNotes: text("coverage_notes_json", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`)
			.notNull(),
		falsePositiveHotspots: text("false_positive_hotspots_json", {
			mode: "json",
		})
			.$type<string[]>()
			.default(sql`'[]'`)
			.notNull(),
		recommendedNextActions: text("recommended_next_actions_json", {
			mode: "json",
		})
			.$type<string[]>()
			.default(sql`'[]'`)
			.notNull(),
		findingTriageHints: text("finding_triage_hints_json", { mode: "json" })
			.$type<Array<Record<string, unknown>>>()
			.default(sql`'[]'`)
			.notNull(),
		confidenceNotes: text("confidence_notes_json", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`)
			.notNull(),
		inputBundle: jsonObject("input_bundle"),
		output: jsonObject("output"),
		errorMessage: text("error_message"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_reviews_scan_run_id_idx").on(table.scanRunId),
		projectIdIdx: index("scan_reviews_project_id_idx").on(table.projectId),
		statusIdx: index("scan_reviews_status_idx").on(table.status),
	}),
);

export const scanDiagnosticRuns = sqliteTable(
	"scan_diagnostic_runs",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		inputSnapshotHash: text("input_snapshot_hash").notNull(),
		scannerProvenanceHash: text("scanner_provenance_hash").notNull(),
		pipelineVersion: text("pipeline_version").notNull(),
		status: text("status").notNull(),
		readiness: text("readiness"),
		scanReviewId: text("scan_review_id").references(() => scanReviews.id, {
			onDelete: "set null",
		}),
		scanReportId: text("scan_report_id").references(() => scanReports.id, {
			onDelete: "set null",
		}),
		limitationCodes: text("limitation_codes_json", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`)
			.notNull(),
		errorMessage: text("error_message"),
		attemptCount: integer("attempt_count").notNull().default(0),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_diagnostic_runs_scan_run_id_idx").on(
			table.scanRunId,
		),
		statusIdx: index("scan_diagnostic_runs_status_idx").on(table.status),
		snapshotUniqueIdx: uniqueIndex(
			"scan_diagnostic_runs_snapshot_unique_idx",
		).on(table.scanRunId, table.inputSnapshotHash, table.pipelineVersion),
	}),
);
