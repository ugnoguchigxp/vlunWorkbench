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
import { id, jsonArray, jsonObject, timestampMs } from "./schema-helpers";
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
		profileOutcome: text("profile_outcome").notNull().default("pending"),
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

/** Immutable execution decision captured immediately after preflight. */
export const scanExecutionPlans = sqliteTable(
	"scan_execution_plans",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		profileId: text("profile_id").notNull(),
		strictness: text("strictness").notNull(),
		planHash: text("plan_hash").notNull(),
		plan: jsonObject("plan"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		scanRunUniqueIdx: uniqueIndex(
			"scan_execution_plans_scan_run_unique_idx",
		).on(table.scanRunId),
		projectIdx: index("scan_execution_plans_project_id_idx").on(
			table.projectId,
		),
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
		// Canonical storage identity. New writes use an owner-scoped path and
		// must never share this key with another artifact row.
		storageKey: text("storage_key"),
		sha256: text("sha256").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_artifacts_scan_run_id_idx").on(table.scanRunId),
		toolRunIdIdx: index("scan_artifacts_tool_run_id_idx").on(table.toolRunId),
		storageKeyUniqueIdx: uniqueIndex("scan_artifacts_storage_key_unique_idx")
			.on(table.storageKey)
			.where(sql`${table.storageKey} IS NOT NULL`),
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

/** Immutable deterministic (or shadow semantic) grouping snapshots for one scan. */
export const findingGroupingRuns = sqliteTable(
	"finding_grouping_runs",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		status: text("status").notNull(), // running, completed, failed
		mode: text("mode").notNull(), // deterministic, semantic
		algorithmVersion: text("algorithm_version").notNull(),
		findingSetHash: text("finding_set_hash").notNull(),
		semanticDecisionHash: text("semantic_decision_hash")
			.notNull()
			.default(""),
		snapshotHash: text("snapshot_hash"),
		rawFindingCount: integer("raw_finding_count").notNull().default(0),
		issueCount: integer("issue_count").notNull().default(0),
		suppressedCount: integer("suppressed_count").notNull().default(0),
		ambiguousCount: integer("ambiguous_count").notNull().default(0),
		provider: text("provider"),
		model: text("model"),
		promptSequenceHash: text("prompt_sequence_hash"),
		limitations: jsonArray("limitations_json"),
		error: text("error"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdx: index("finding_grouping_runs_scan_run_idx").on(
			table.scanRunId,
		),
		completedLookupIdx: index(
			"finding_grouping_runs_completed_lookup_idx",
		).on(
			table.scanRunId,
			table.mode,
			table.algorithmVersion,
			table.findingSetHash,
			table.completedAt,
		),
		activeUniqueIdx: uniqueIndex("finding_grouping_runs_active_unique_idx")
			.on(
				table.scanRunId,
				table.mode,
				table.algorithmVersion,
				table.findingSetHash,
			)
			.where(sql`${table.status} = 'running'`),
		completedUniqueIdx: uniqueIndex(
			"finding_grouping_runs_completed_unique_idx",
		)
			.on(
				table.scanRunId,
				table.mode,
				table.algorithmVersion,
				table.findingSetHash,
				table.semanticDecisionHash,
			)
			.where(sql`${table.status} = 'completed'`),
	}),
);

export const findingIssueGroups = sqliteTable(
	"finding_issue_groups",
	{
		id: id(),
		groupingRunId: text("grouping_run_id")
			.notNull()
			.references(() => findingGroupingRuns.id, { onDelete: "cascade" }),
		stableKey: text("stable_key").notNull(),
		representativeFindingId: text("representative_finding_id").references(
			() => findings.id,
			{ onDelete: "set null" },
		),
		issueKind: text("issue_kind").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull(),
		severity: text("severity").notNull(),
		primaryLocation: jsonObject("primary_location_json"),
		matchConfidence: text("match_confidence").notNull(),
		sourceTools: jsonArray("source_tools_json"),
		reasonCodes: jsonArray("reason_codes_json"),
		metadata: jsonObject("metadata_json"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		runStableKeyUniqueIdx: uniqueIndex(
			"finding_issue_groups_run_stable_key_unique_idx",
		).on(table.groupingRunId, table.stableKey),
		runIdx: index("finding_issue_groups_run_idx").on(table.groupingRunId),
	}),
);

export const findingIssueGroupMembers = sqliteTable(
	"finding_issue_group_members",
	{
		id: id(),
		groupId: text("group_id")
			.notNull()
			.references(() => findingIssueGroups.id, { onDelete: "cascade" }),
		groupingRunId: text("grouping_run_id")
			.notNull()
			.references(() => findingGroupingRuns.id, { onDelete: "cascade" }),
		findingId: text("finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		role: text("role").notNull(), // representative, supporting
		matchMethod: text("match_method").notNull(), // deterministic, singleton, semantic
		matchConfidence: text("match_confidence").notNull(),
		reasonCodes: jsonArray("reason_codes_json"),
		comparisonHash: text("comparison_hash"),
		identity: jsonObject("identity_json"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		runFindingUniqueIdx: uniqueIndex(
			"finding_issue_group_members_run_finding_unique_idx",
		).on(table.groupingRunId, table.findingId),
		groupIdx: index("finding_issue_group_members_group_idx").on(
			table.groupId,
		),
	}),
);

export const findingGroupingPairDecisions = sqliteTable(
	"finding_grouping_pair_decisions",
	{
		id: id(),
		groupingRunId: text("grouping_run_id")
			.notNull()
			.references(() => findingGroupingRuns.id, { onDelete: "cascade" }),
		leftFindingId: text("left_finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		rightFindingId: text("right_finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		verdict: text("verdict").notNull(),
		confidence: text("confidence").notNull(),
		method: text("method").notNull(),
		reasonCodes: jsonArray("reason_codes_json"),
		rationale: text("rationale"),
		comparisonHash: text("comparison_hash").notNull(),
		provider: text("provider"),
		model: text("model"),
		promptSequenceHash: text("prompt_sequence_hash"),
		responseContentSha256: text("response_content_sha256"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		runPairUniqueIdx: uniqueIndex(
			"finding_grouping_pair_decisions_run_pair_unique_idx",
		).on(table.groupingRunId, table.leftFindingId, table.rightFindingId),
		semanticCacheIdx: index("finding_grouping_pair_decisions_cache_idx").on(
			table.comparisonHash,
			table.method,
			table.provider,
			table.model,
			table.promptSequenceHash,
			table.createdAt,
		),
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
