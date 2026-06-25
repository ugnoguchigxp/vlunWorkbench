import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
	blob,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const EMBEDDING_DIMENSIONS = 1536;

const nowMs = sql`(unixepoch() * 1000)`;
const id = (name = "id") =>
	text(name)
		.primaryKey()
		.$defaultFn(() => randomUUID());
const jsonObject = (name: string) =>
	text(name, { mode: "json" })
		.$type<Record<string, unknown>>()
		.default(sql`'{}'`)
		.notNull();
const jsonArray = (name: string) =>
	text(name, { mode: "json" }).$type<string[]>().default(sql`'[]'`).notNull();
const timestampMs = (name: string) =>
	integer(name, { mode: "timestamp_ms" })
		.default(nowMs)
		.$defaultFn(() => new Date())
		.notNull();

export const users = sqliteTable(
	"users",
	{
		id: id(),
		email: text("email").notNull().unique(),
		passwordHash: text("password_hash").notNull(),
		displayName: text("display_name").notNull(),
		role: text("role").notNull().default("member"),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		emailIdx: uniqueIndex("users_email_idx").on(table.email),
		roleIdx: index("users_role_idx").on(table.role),
		isActiveIdx: index("users_is_active_idx").on(table.isActive),
	}),
);

export const refreshTokens = sqliteTable(
	"refresh_tokens",
	{
		id: id(),
		token: text("token").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		tokenIdx: uniqueIndex("refresh_tokens_token_idx").on(table.token),
		userIdIdx: index("refresh_tokens_user_id_idx").on(table.userId),
		expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
	}),
);

export const sources = sqliteTable(
	"sources",
	{
		id: id(),
		sourceKind: text("source_kind").notNull(),
		category: text("category").default("tech").notNull(),
		uri: text("uri").notNull(),
		title: text("title"),
		body: text("body").notNull(),
		contentHash: text("content_hash").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
		lastIndexedAt: integer("last_indexed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		uriUniqueIdx: uniqueIndex("sources_uri_idx").on(table.uri),
		sourceKindIdx: index("sources_source_kind_idx").on(table.sourceKind),
		sourceKindCategoryIdx: index("sources_source_kind_category_idx").on(
			table.sourceKind,
			table.category,
		),
		contentHashIdx: index("sources_content_hash_idx").on(table.contentHash),
	}),
);

export const sourceFragments = sqliteTable(
	"source_fragments",
	{
		id: id(),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		locator: text("locator").notNull(),
		heading: text("heading"),
		content: text("content").notNull(),
		embedding: blob("embedding", { mode: "buffer" }),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		sourceIdx: index("source_fragments_source_id_idx").on(table.sourceId),
		sourceLocatorIdx: uniqueIndex("source_fragments_source_locator_idx").on(
			table.sourceId,
			table.locator,
		),
	}),
);

export const conversations = sqliteTable(
	"conversations",
	{
		id: id(),
		userId: text("user_id").references(() => users.id, {
			onDelete: "cascade",
		}),
		title: text("title"),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		userIdx: index("conversations_user_id_idx").on(table.userId),
	}),
);

export const messages = sqliteTable(
	"messages",
	{
		id: id(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		content: text("content").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		conversationIdx: index("messages_conversation_id_idx").on(
			table.conversationId,
		),
	}),
);

export const artifacts = sqliteTable(
	"artifacts",
	{
		id: id(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		messageId: text("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		title: text("title"),
		content: text("content", { mode: "json" }).$type<unknown>().notNull(),
		version: integer("version").default(1).notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		conversationIdx: index("artifacts_conversation_id_idx").on(
			table.conversationId,
		),
		messageIdx: index("artifacts_message_id_idx").on(table.messageId),
	}),
);

export const retrievalLogs = sqliteTable(
	"retrieval_logs",
	{
		id: id(),
		conversationId: text("conversation_id").references(() => conversations.id, {
			onDelete: "set null",
		}),
		messageId: text("message_id").references(() => messages.id, {
			onDelete: "set null",
		}),
		query: text("query").notNull(),
		fragmentIds: jsonArray("fragment_ids"),
		scores: jsonObject("scores"),
		context: jsonObject("context"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		conversationIdx: index("retrieval_logs_conversation_id_idx").on(
			table.conversationId,
		),
		messageIdx: index("retrieval_logs_message_id_idx").on(table.messageId),
	}),
);

export const userSettings = sqliteTable("user_settings", {
	userId: text("user_id").primaryKey(),
	systemContext: text("system_context").default("").notNull(),
	createdAt: timestampMs("created_at"),
	updatedAt: timestampMs("updated_at"),
});

export const projects = sqliteTable(
	"projects",
	{
		id: id(),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		repoPath: text("repo_path").notNull(),
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
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("scan_runs_project_id_idx").on(table.projectId),
		statusIdx: index("scan_runs_status_idx").on(table.status),
	}),
);

export const scanEvents = sqliteTable(
	"scan_events",
	{
		id: id(),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		level: text("level").notNull(), // debug, info, warn, error
		eventType: text("event_type").notNull(), // scan.started, etc.
		message: text("message").notNull(),
		data: jsonObject("data"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_events_scan_run_id_idx").on(table.scanRunId),
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
		status: text("status").notNull(), // running, completed, failed
		errorMessage: text("error_message"),
		generatedByUserId: text("generated_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdIdx: index("scan_reports_scan_run_id_idx").on(table.scanRunId),
		artifactIdIdx: index("scan_reports_artifact_id_idx").on(table.artifactId),
		statusIdx: index("scan_reports_status_idx").on(table.status),
	}),
);

export const reproductionRuns = sqliteTable(
	"reproduction_runs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		findingId: text("finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		profileId: text("profile_id").notNull(),
		status: text("status").notNull(), // queued, running, completed, failed, timed_out, cancelled
		outcome: text("outcome"), // reproduced, not_reproduced, inconclusive, error
		runner: text("runner").notNull(), // docker
		commandJson: text("command_json", { mode: "json" }).$type<string[]>(),
		exitCode: integer("exit_code"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		summary: text("summary"),
		errorMessage: text("error_message"),
		metadata: jsonObject("metadata"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("reproduction_runs_project_id_idx").on(table.projectId),
		scanRunIdIdx: index("reproduction_runs_scan_run_id_idx").on(
			table.scanRunId,
		),
		findingIdIdx: index("reproduction_runs_finding_id_idx").on(table.findingId),
		statusIdx: index("reproduction_runs_status_idx").on(table.status),
		outcomeIdx: index("reproduction_runs_outcome_idx").on(table.outcome),
	}),
);

export const reproductionArtifacts = sqliteTable(
	"reproduction_artifacts",
	{
		id: id(),
		reproductionRunId: text("reproduction_run_id")
			.notNull()
			.references(() => reproductionRuns.id, { onDelete: "cascade" }),
		findingId: text("finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(), // raw_result, stdout, stderr, log, summary
		format: text("format").notNull(), // json, sarif, text, markdown
		path: text("path").notNull(),
		sha256: text("sha256").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		reproductionRunIdIdx: index(
			"reproduction_artifacts_reproduction_run_id_idx",
		).on(table.reproductionRunId),
		findingIdIdx: index("reproduction_artifacts_finding_id_idx").on(
			table.findingId,
		),
	}),
);

export const reproductionEvidence = sqliteTable(
	"reproduction_evidence",
	{
		id: id(),
		reproductionRunId: text("reproduction_run_id")
			.notNull()
			.references(() => reproductionRuns.id, { onDelete: "cascade" }),
		findingId: text("finding_id")
			.notNull()
			.references(() => findings.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(), // reproduction-result, reproduction-log, tool-output
		title: text("title").notNull(),
		artifactId: text("artifact_id").references(() => reproductionArtifacts.id, {
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
		reproductionRunIdIdx: index(
			"reproduction_evidence_reproduction_run_id_idx",
		).on(table.reproductionRunId),
		findingIdIdx: index("reproduction_evidence_finding_id_idx").on(
			table.findingId,
		),
	}),
);

export const dynamicProfileConfigs = sqliteTable(
	"dynamic_profile_configs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		profileId: text("profile_id").notNull(),
		dynamicKind: text("dynamic_kind").notNull(), // test, sanitizer, fuzz
		displayName: text("display_name").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		commandJson: text("command_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		workingDirectory: text("working_directory").notNull().default(""),
		timeoutSec: integer("timeout_sec").notNull().default(120),
		network: text("network").notNull().default("none"),
		memory: text("memory"),
		cpus: text("cpus"),
		writableWorkdir: integer("writable_workdir", { mode: "boolean" })
			.notNull()
			.default(false),
		allowProjectScripts: integer("allow_project_scripts", { mode: "boolean" })
			.notNull()
			.default(false),
		expectedArtifactsJson: text("expected_artifacts_json", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`)
			.notNull(),
		metadata: jsonObject("metadata"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectProfileUniqueIdx: uniqueIndex(
			"dynamic_profile_configs_project_profile_idx",
		).on(table.projectId, table.profileId),
		projectIdIdx: index("dynamic_profile_configs_project_id_idx").on(
			table.projectId,
		),
		dynamicKindIdx: index("dynamic_profile_configs_dynamic_kind_idx").on(
			table.dynamicKind,
		),
		enabledIdx: index("dynamic_profile_configs_enabled_idx").on(table.enabled),
	}),
);

export const dynamicRuns = sqliteTable(
	"dynamic_runs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id").references(() => scanRuns.id, {
			onDelete: "set null",
		}),
		findingId: text("finding_id").references(() => findings.id, {
			onDelete: "set null",
		}),
		profileConfigId: text("profile_config_id")
			.notNull()
			.references(() => dynamicProfileConfigs.id, { onDelete: "cascade" }),
		profileId: text("profile_id").notNull(),
		dynamicKind: text("dynamic_kind").notNull(), // test, sanitizer, fuzz
		status: text("status").notNull(), // queued, running, completed, failed, timed_out, cancelled
		outcome: text("outcome"), // passed, failed, crashed, timed_out, inconclusive, error
		runner: text("runner").notNull().default("docker"),
		commandJson: text("command_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		exitCode: integer("exit_code"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		summary: text("summary"),
		errorMessage: text("error_message"),
		metadata: jsonObject("metadata"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("dynamic_runs_project_id_idx").on(table.projectId),
		scanRunIdIdx: index("dynamic_runs_scan_run_id_idx").on(table.scanRunId),
		findingIdIdx: index("dynamic_runs_finding_id_idx").on(table.findingId),
		profileConfigIdIdx: index("dynamic_runs_profile_config_id_idx").on(
			table.profileConfigId,
		),
		statusIdx: index("dynamic_runs_status_idx").on(table.status),
		outcomeIdx: index("dynamic_runs_outcome_idx").on(table.outcome),
		dynamicKindIdx: index("dynamic_runs_dynamic_kind_idx").on(
			table.dynamicKind,
		),
	}),
);

export const dynamicArtifacts = sqliteTable(
	"dynamic_artifacts",
	{
		id: id(),
		dynamicRunId: text("dynamic_run_id")
			.notNull()
			.references(() => dynamicRuns.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		findingId: text("finding_id").references(() => findings.id, {
			onDelete: "cascade",
		}),
		kind: text("kind").notNull(), // stdout, stderr, log, crash, summary, coverage, raw_result
		format: text("format").notNull(), // json, text, xml, etc.
		path: text("path").notNull(),
		sha256: text("sha256").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		dynamicRunIdIdx: index("dynamic_artifacts_dynamic_run_id_idx").on(
			table.dynamicRunId,
		),
		projectIdIdx: index("dynamic_artifacts_project_id_idx").on(table.projectId),
		findingIdIdx: index("dynamic_artifacts_finding_id_idx").on(table.findingId),
	}),
);

export const dynamicEvidence = sqliteTable(
	"dynamic_evidence",
	{
		id: id(),
		dynamicRunId: text("dynamic_run_id")
			.notNull()
			.references(() => dynamicRuns.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		findingId: text("finding_id").references(() => findings.id, {
			onDelete: "set null",
		}),
		kind: text("kind").notNull(), // dynamic-test-log, sanitizer-finding, fuzz-crash, dynamic-result
		title: text("title").notNull(),
		artifactId: text("artifact_id").references(() => dynamicArtifacts.id, {
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
		dynamicRunIdIdx: index("dynamic_evidence_dynamic_run_id_idx").on(
			table.dynamicRunId,
		),
		projectIdIdx: index("dynamic_evidence_project_id_idx").on(table.projectId),
		findingIdIdx: index("dynamic_evidence_finding_id_idx").on(table.findingId),
	}),
);
