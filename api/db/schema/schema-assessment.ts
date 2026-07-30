import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { z } from "zod";
import type {
	assessmentScopeSchema,
	rulesOfEngagementSchema,
} from "../../../shared/schemas/assessment.schema";
import { users } from "./schema-core";
import { id, timestampMs } from "./schema-helpers";
import { projects, scanRuns } from "./schema-scans";

export const assessmentEngagements = sqliteTable(
	"assessment_engagements",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		purpose: text("purpose").notNull(),
		environment: text("environment").notNull(),
		scope: text("scope_json", { mode: "json" })
			.$type<z.infer<typeof assessmentScopeSchema>>()
			.notNull(),
		rulesOfEngagement: text("rules_of_engagement_json", { mode: "json" })
			.$type<z.infer<typeof rulesOfEngagementSchema> | null>()
			.default(sql`NULL`),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		status: text("status").notNull().default("draft"),
		startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("assessment_engagements_project_id_idx").on(
			table.projectId,
		),
		ownerIdx: index("assessment_engagements_owner_idx").on(table.ownerUserId),
		statusIdx: index("assessment_engagements_status_idx").on(table.status),
	}),
);

export const scanCoverageResults = sqliteTable(
	"scan_coverage_results",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		engagementId: text("engagement_id").references(
			() => assessmentEngagements.id,
			{ onDelete: "set null" },
		),
		controlId: text("control_id").notNull(),
		status: text("status").notNull(),
		method: text("method").notNull(),
		reasonCode: text("reason_code").notNull(),
		evidenceRefs: text("evidence_refs_json", { mode: "json" })
			.$type<Array<{ kind: string; id: string }>>()
			.default(sql`'[]'`)
			.notNull(),
		snapshotHash: text("snapshot_hash").notNull(),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdx: index("scan_coverage_results_scan_run_idx").on(table.scanRunId),
		controlIdx: index("scan_coverage_results_control_idx").on(table.controlId),
		scanControlUniqueIdx: uniqueIndex(
			"scan_coverage_results_scan_control_unique_idx",
		).on(table.scanRunId, table.controlId),
	}),
);

export const activeAssessmentRuns = sqliteTable(
	"active_assessment_runs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		engagementId: text("engagement_id")
			.notNull()
			.references(() => assessmentEngagements.id, { onDelete: "restrict" }),
		targetConfigId: text("target_config_id").notNull(),
		kind: text("kind").notNull(),
		status: text("status").notNull(),
		requestCount: integer("request_count").notNull().default(0),
		findingCount: integer("finding_count").notNull().default(0),
		summary: text("summary"),
		result: text("result_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.default(sql`'{}'`)
			.notNull(),
		errorMessage: text("error_message"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("active_assessment_runs_project_id_idx").on(
			table.projectId,
		),
		scanRunIdIdx: index("active_assessment_runs_scan_run_id_idx").on(
			table.scanRunId,
		),
		engagementIdIdx: index("active_assessment_runs_engagement_id_idx").on(
			table.engagementId,
		),
	}),
);

export const activeAssessmentEvidences = sqliteTable(
	"active_assessment_evidences",
	{
		id: id(),
		activeAssessmentRunId: text("active_assessment_run_id")
			.notNull()
			.references(() => activeAssessmentRuns.id, { onDelete: "cascade" }),
		method: text("method").notNull(),
		path: text("path").notNull(),
		statusCode: integer("status_code"),
		identityRole: text("identity_role"),
		stage: text("stage").notNull(),
		requestSha256: text("request_sha256").notNull(),
		durationMs: integer("duration_ms").notNull(),
		errorCode: text("error_code"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		runIdIdx: index("active_assessment_evidences_run_id_idx").on(
			table.activeAssessmentRunId,
		),
	}),
);
