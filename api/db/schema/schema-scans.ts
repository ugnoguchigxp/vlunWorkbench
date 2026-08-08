import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./schema-core";
import { id, jsonObject, timestampMs } from "./schema-helpers";
export const projects = sqliteTable(
	"projects",
	{
		id: id(),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		repoPath: text("repo_path").notNull(),
		canonicalRepoPath: text("canonical_repo_path"),
		defaultBranch: text("default_branch").notNull().default("main"),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		ownerUserIdIdx: index("projects_owner_user_id_idx").on(table.ownerUserId),
		ownerRepoPathUniqueIdx: uniqueIndex(
			"projects_owner_repo_path_unique_idx",
		).on(table.ownerUserId, table.repoPath),
		canonicalRepoPathUniqueIdx: uniqueIndex(
			"projects_canonical_repo_path_unique_idx",
		).on(table.canonicalRepoPath),
	}),
);

export const scanRuns = sqliteTable(
	"scan_runs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		profile: text("profile").notNull().default("baseline"),
		status: text("status").notNull(), // queued, running, completed, failed, cancelled
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		summary: text("summary"),
		lastEventSeq: integer("last_event_seq").notNull().default(0),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("scan_runs_project_id_idx").on(table.projectId),
		statusIdx: index("scan_runs_status_idx").on(table.status),
	}),
);

export const staticIntelligencePrepareJobs = sqliteTable(
	"static_intelligence_prepare_jobs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		canonicalProjectPath: text("canonical_project_path").notNull(),
		sourceFingerprint: text("source_fingerprint").notNull(),
		status: text("status").notNull(),
		stage: text("stage").notNull(),
		scanRunId: text("scan_run_id").references(() => scanRuns.id, {
			onDelete: "set null",
		}),
		generationId: text("generation_id"),
		attemptCount: integer("attempt_count").notNull().default(0),
		errorCode: text("error_code"),
		errorMessageRedacted: text("error_message_redacted"),
		retryable: integer("retryable", { mode: "boolean" }),
		leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		projectIdIdx: index("static_intel_prepare_project_idx").on(table.projectId),
		sourceFingerprintIdx: index("static_intel_prepare_source_idx").on(
			table.projectId,
			table.sourceFingerprint,
		),
		statusIdx: index("static_intel_prepare_status_idx").on(table.status),
	}),
);

export const scanEvents = sqliteTable(
	"scan_events",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull().default(0),
		level: text("level").notNull(), // debug, info, warn, error
		eventType: text("event_type").notNull(), // scan.started, etc.
		message: text("message").notNull(),
		data: jsonObject("data"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_events_scan_run_id_idx").on(table.scanRunId),
		scanRunSeqUniqueIdx: uniqueIndex("scan_events_scan_run_seq_unique_idx").on(
			table.scanRunId,
			table.seq,
		),
	}),
);

export const toolRuns = sqliteTable(
	"tool_runs",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		toolName: text("tool_name").notNull(),
		toolVersion: text("tool_version"),
		command: text("command"),
		status: text("status").notNull(),
		exitCode: integer("exit_code"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdIdx: index("tool_runs_scan_run_id_idx").on(table.scanRunId),
	}),
);

export const scanArtifacts = sqliteTable(
	"scan_artifacts",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		toolRunId: text("tool_run_id").references(() => toolRuns.id, {
			onDelete: "set null",
		}),
		kind: text("kind").notNull(), // raw_result, stdout, stderr, log, normalized_result, source_snippet, report
		format: text("format").notNull(), // json, sarif, text, markdown
		path: text("path").notNull(),
		sha256: text("sha256").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_artifacts_scan_run_id_idx").on(table.scanRunId),
		toolRunIdIdx: index("scan_artifacts_tool_run_id_idx").on(table.toolRunId),
	}),
);

export const findings = sqliteTable(
	"findings",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sourceTool: text("source_tool").notNull(),
		ruleId: text("rule_id").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull(),
		severity: text("severity").notNull(), // info, low, medium, high, critical, unknown
		confidence: text("confidence").notNull().default("static"),
		status: text("status").notNull().default("open"),
		primaryLocation: text("primary_location", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		fingerprint: text("fingerprint").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdIdx: index("findings_scan_run_id_idx").on(table.scanRunId),
		scanRunCreatedIdIdx: index("findings_scan_run_created_id_idx").on(
			table.scanRunId,
			table.createdAt,
			table.id,
		),
		projectIdIdx: index("findings_project_id_idx").on(table.projectId),
		fingerprintIdx: index("findings_fingerprint_idx").on(table.fingerprint),
	}),
);

export const findingEvidences = sqliteTable(
	"finding_evidence",
	{
		id: id(),
		findingId: text("finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(), // tool-output, source-location, scan-log
		title: text("title").notNull(),
		artifactId: text("artifact_id").references(() => scanArtifacts.id, {
			onDelete: "set null",
		}),
		location: text("location", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		snippet: text("snippet"),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		findingIdIdx: index("finding_evidence_finding_id_idx").on(table.findingId),
	}),
);

export const findingReviews = sqliteTable(
	"finding_reviews",
	{
		id: id(),
		findingId: text("finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		status: text("status").notNull(), // running, completed, failed
		summary: text("summary"),
		likelyImpact: text("likely_impact"),
		falsePositiveAssessment: text("false_positive_assessment", {
			mode: "json",
		}).$type<{
			level: "low" | "medium" | "high" | "unknown";
			reasoning: string;
		}>(),
		evidenceStrength: text("evidence_strength", { mode: "json" }).$type<{
			level: "weak" | "moderate" | "strong" | "unknown";
			reasoning: string;
		}>(),
		remediationDirection: text("remediation_direction"),
		reviewerNotes: text("reviewer_notes", { mode: "json" }).$type<string[]>(),
		confidenceAdjustment: text("confidence_adjustment").notNull(), // unchanged, increase, decrease, unknown
		inputBundle: text("input_bundle", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		output: text("output", { mode: "json" }).$type<Record<string, unknown>>(),
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
		findingIdIdx: index("finding_reviews_finding_id_idx").on(table.findingId),
		statusIdx: index("finding_reviews_status_idx").on(table.status),
	}),
);

export const findingDecisions = sqliteTable(
	"finding_decisions",
	{
		id: id(),
		findingId: text("finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		decision: text("decision").notNull(), // accepted, false_positive, deferred, needs_fix
		reason: text("reason").notNull(), // confirmed_by_evidence, confirmed_by_review, etc.
		comment: text("comment"),
		linkedReviewId: text("linked_review_id").references(
			() => findingReviews.id,
			{
				onDelete: "set null",
			},
		),
		decidedByUserId: text("decided_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		findingIdIdx: index("finding_decisions_finding_id_idx").on(table.findingId),
		linkedReviewIdIdx: index("finding_decisions_linked_review_id_idx").on(
			table.linkedReviewId,
		),
	}),
);

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
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_reports_scan_run_id_idx").on(table.scanRunId),
		artifactIdIdx: index("scan_reports_artifact_id_idx").on(table.artifactId),
		statusIdx: index("scan_reports_status_idx").on(table.status),
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
