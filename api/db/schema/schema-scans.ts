import { sql } from "drizzle-orm";
import {
	index,
	integer,
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

/**
 * Audit record for every authenticated, project-authorized canonical launch
 * request. Rejected requests intentionally have no scan run.
 */
export const scanLaunchAttempts = sqliteTable(
	"scan_launch_attempts",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		requestedProfileId: text("requested_profile_id").notNull(),
		canonicalProfileId: text("canonical_profile_id"),
		profileVariantId: text("profile_variant_id"),
		engineId: text("engine_id"),
		status: text("status").notNull(), // received, rejected, admitted
		readinessStatus: text("readiness_status"),
		reasonCodes: jsonArray("reason_codes").notNull().default([]),
		sanitizedInputSummary: jsonObject("sanitized_input_summary")
			.notNull()
			.default({}),
		catalogEntryHash: text("catalog_entry_hash"),
		readinessHash: text("readiness_hash"),
		planHash: text("plan_hash"),
		dependencyQualificationHash: text("dependency_qualification_hash"),
		scanRunId: text("scan_run_id").references(() => scanRuns.id, {
			onDelete: "set null",
		}),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
		admittedAt: integer("admitted_at", { mode: "timestamp_ms" }),
		rejectedAt: integer("rejected_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		projectCreatedIdx: index("scan_launch_attempts_project_created_idx").on(
			table.projectId,
			table.createdAt,
		),
		statusCreatedIdx: index("scan_launch_attempts_status_created_idx").on(
			table.status,
			table.createdAt,
		),
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

/**
 * Durable ownership records for scan-created resources (containers, targets,
 * and external sessions). Reapers use this table after a timeout or crash.
 */
export const scanResourceLeases = sqliteTable(
	"scan_resource_leases",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		stepId: text("step_id").notNull(),
		resourceType: text("resource_type").notNull(),
		provider: text("provider").notNull(),
		externalId: text("external_id").notNull(),
		state: text("state").notNull(),
		receipt: jsonObject("receipt"),
		leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
		releasedAt: integer("released_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdx: index("scan_resource_leases_scan_run_idx").on(table.scanRunId),
		activeIdx: index("scan_resource_leases_active_idx").on(
			table.state,
			table.leaseExpiresAt,
		),
		resourceUniqueIdx: uniqueIndex(
			"scan_resource_leases_resource_unique_idx",
		).on(table.provider, table.externalId),
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
		semanticDecisionHash: text("semantic_decision_hash").notNull().default(""),
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
		scanRunIdx: index("finding_grouping_runs_scan_run_idx").on(table.scanRunId),
		completedLookupIdx: index("finding_grouping_runs_completed_lookup_idx").on(
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
		groupIdx: index("finding_issue_group_members_group_idx").on(table.groupId),
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
