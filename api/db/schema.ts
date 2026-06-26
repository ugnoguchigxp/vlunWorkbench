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

export const llmProviderEndpoints = sqliteTable(
	"llm_provider_endpoints",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		kind: text("kind").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		apiKey: text("api_key"),
		baseUrl: text("base_url"),
		endpoint: text("endpoint"),
		apiVersion: text("api_version"),
		region: text("region"),
		models: jsonArray("models"),
		modelDisplayNames: text("model_display_names", { mode: "json" })
			.$type<Record<string, string>>()
			.default(sql`'{}'`)
			.notNull(),
		defaultModelCapability: text("default_model_capability", { mode: "json" })
			.$type<Record<string, unknown> | null>()
			.default(sql`null`),
		modelCapabilities: text("model_capabilities", { mode: "json" })
			.$type<Record<string, Record<string, unknown>>>()
			.default(sql`'{}'`)
			.notNull(),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		kindIdx: index("llm_provider_endpoints_kind_idx").on(table.kind),
		enabledIdx: index("llm_provider_endpoints_enabled_idx").on(table.enabled),
	}),
);

export const llmTaskRoutes = sqliteTable("llm_task_routes", {
	task: text("task").primaryKey(),
	primaryProviderEndpointId: text("primary_provider_endpoint_id").references(
		() => llmProviderEndpoints.id,
		{ onDelete: "set null" },
	),
	primaryModel: text("primary_model"),
	primaryThinkingDepth: text("primary_thinking_depth"),
	fallbackTargets: text("fallback_targets", { mode: "json" })
		.$type<
			Array<{
				providerEndpointId: string;
				model: string;
				thinkingDepth?: string;
			}>
		>()
		.default(sql`'[]'`)
		.notNull(),
	policy: jsonObject("policy"),
	createdAt: timestampMs("created_at"),
	updatedAt: timestampMs("updated_at"),
});

export const llmProviderHealthChecks = sqliteTable(
	"llm_provider_health_checks",
	{
		id: id(),
		providerEndpointId: text("provider_endpoint_id")
			.notNull()
			.references(() => llmProviderEndpoints.id, { onDelete: "cascade" }),
		ok: integer("ok", { mode: "boolean" }).notNull(),
		reachable: integer("reachable", { mode: "boolean" }).notNull(),
		status: text("status").notNull(),
		url: text("url"),
		message: text("message"),
		durationMs: integer("duration_ms").notNull(),
		checkedAt: timestampMs("checked_at"),
	},
	(table) => ({
		providerEndpointIdIdx: index("llm_provider_health_checks_endpoint_idx").on(
			table.providerEndpointId,
		),
		checkedAtIdx: index("llm_provider_health_checks_checked_at_idx").on(
			table.checkedAt,
		),
	}),
);

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

export const attackSurfaceItems = sqliteTable(
	"attack_surface_items",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id").references(() => scanRuns.id, {
			onDelete: "cascade",
		}),
		category: text("category").notNull(),
		name: text("name").notNull(),
		kind: text("kind").notNull(),
		locationJson: jsonObject("location_json"),
		boundaryJson: jsonObject("boundary_json"),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" })
			.$type<Array<Record<string, unknown>>>()
			.default(sql`'[]'`)
			.notNull(),
		confidence: text("confidence").notNull().default("medium"),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("attack_surface_items_project_id_idx").on(
			table.projectId,
		),
		scanRunIdIdx: index("attack_surface_items_scan_run_id_idx").on(
			table.scanRunId,
		),
		categoryIdx: index("attack_surface_items_category_idx").on(table.category),
		kindIdx: index("attack_surface_items_kind_idx").on(table.kind),
	}),
);

export const securityChecks = sqliteTable(
	"security_checks",
	{
		id: id(),
		checkId: text("check_id").notNull(),
		title: text("title").notNull(),
		category: text("category").notNull(),
		severityHint: text("severity_hint").notNull().default("info"),
		description: text("description").notNull(),
		inputKindsJson: jsonArray("input_kinds_json"),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		checkIdIdx: uniqueIndex("security_checks_check_id_idx").on(table.checkId),
		categoryIdx: index("security_checks_category_idx").on(table.category),
		enabledIdx: index("security_checks_enabled_idx").on(table.enabled),
	}),
);

export const securityCheckResults = sqliteTable(
	"security_check_results",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id").references(() => scanRuns.id, {
			onDelete: "cascade",
		}),
		checkId: text("check_id").notNull(),
		attackSurfaceItemId: text("attack_surface_item_id").references(
			() => attackSurfaceItems.id,
			{ onDelete: "set null" },
		),
		status: text("status").notNull(),
		outcome: text("outcome"),
		title: text("title").notNull(),
		summary: text("summary").notNull(),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" })
			.$type<Array<Record<string, unknown>>>()
			.default(sql`'[]'`)
			.notNull(),
		remediationHint: text("remediation_hint"),
		coverageGap: text("coverage_gap"),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("security_check_results_project_id_idx").on(
			table.projectId,
		),
		scanRunIdIdx: index("security_check_results_scan_run_id_idx").on(
			table.scanRunId,
		),
		checkIdIdx: index("security_check_results_check_id_idx").on(table.checkId),
		statusIdx: index("security_check_results_status_idx").on(table.status),
		attackSurfaceItemIdIdx: index(
			"security_check_results_attack_surface_item_id_idx",
		).on(table.attackSurfaceItemId),
	}),
);

export const diagnosticReports = sqliteTable(
	"diagnostic_reports",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		reportKind: text("report_kind").notNull(),
		status: text("status").notNull(),
		summary: text("summary"),
		checkedCategoriesJson: text("checked_categories_json", { mode: "json" })
			.$type<Array<Record<string, unknown>>>()
			.default(sql`'[]'`)
			.notNull(),
		coverageGapsJson: text("coverage_gaps_json", { mode: "json" })
			.$type<Array<Record<string, unknown>>>()
			.default(sql`'[]'`)
			.notNull(),
		residualRisksJson: text("residual_risks_json", { mode: "json" })
			.$type<Array<Record<string, unknown>>>()
			.default(sql`'[]'`)
			.notNull(),
		recommendedNextActionsJson: text("recommended_next_actions_json", {
			mode: "json",
		})
			.$type<Array<Record<string, unknown>>>()
			.default(sql`'[]'`)
			.notNull(),
		artifactId: text("artifact_id").references(() => scanArtifacts.id, {
			onDelete: "set null",
		}),
		metadata: jsonObject("metadata"),
		errorMessage: text("error_message"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("diagnostic_reports_project_id_idx").on(
			table.projectId,
		),
		scanRunIdIdx: index("diagnostic_reports_scan_run_id_idx").on(
			table.scanRunId,
		),
		reportKindIdx: index("diagnostic_reports_report_kind_idx").on(
			table.reportKind,
		),
		statusIdx: index("diagnostic_reports_status_idx").on(table.status),
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

export const dastTargetConfigs = sqliteTable(
	"dast_target_configs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		origin: text("origin").notNull(),
		normalizedOrigin: text("normalized_origin").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		allowLoopback: integer("allow_loopback", { mode: "boolean" })
			.notNull()
			.default(true),
		allowPrivateNetwork: integer("allow_private_network", { mode: "boolean" })
			.notNull()
			.default(false),
		allowedPathsJson: jsonArray("allowed_paths_json"),
		excludedPathsJson: jsonArray("excluded_paths_json"),
		defaultHeadersJson: text("default_headers_json", { mode: "json" })
			.$type<Record<string, string>>()
			.default(sql`'{}'`)
			.notNull(),
		maxDepth: integer("max_depth").notNull().default(0),
		maxRequests: integer("max_requests").notNull().default(20),
		rateLimitPerSec: integer("rate_limit_per_sec").notNull().default(2),
		timeoutSec: integer("timeout_sec").notNull().default(120),
		metadata: jsonObject("metadata"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("dast_target_configs_project_id_idx").on(
			table.projectId,
		),
		projectNameUniqueIdx: uniqueIndex(
			"dast_target_configs_project_name_idx",
		).on(table.projectId, table.name),
		enabledIdx: index("dast_target_configs_enabled_idx").on(table.enabled),
	}),
);

export const dastProfileConfigs = sqliteTable(
	"dast_profile_configs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		targetConfigId: text("target_config_id")
			.notNull()
			.references(() => dastTargetConfigs.id, { onDelete: "cascade" }),
		profileId: text("profile_id").notNull(),
		displayName: text("display_name").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		routePathsJson: jsonArray("route_paths_json"),
		formSelectorsJson: jsonArray("form_selectors_json"),
		checkOptionsJson: jsonObject("check_options_json"),
		timeoutSec: integer("timeout_sec"),
		maxRequests: integer("max_requests"),
		metadata: jsonObject("metadata"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdIdx: index("dast_profile_configs_project_id_idx").on(
			table.projectId,
		),
		targetConfigIdIdx: index("dast_profile_configs_target_config_id_idx").on(
			table.targetConfigId,
		),
		projectProfileUniqueIdx: uniqueIndex(
			"dast_profile_configs_project_profile_idx",
		).on(table.projectId, table.profileId),
		enabledIdx: index("dast_profile_configs_enabled_idx").on(table.enabled),
	}),
);

export const dastRuns = sqliteTable(
	"dast_runs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		targetConfigId: text("target_config_id")
			.notNull()
			.references(() => dastTargetConfigs.id, { onDelete: "cascade" }),
		profileConfigId: text("profile_config_id").references(
			() => dastProfileConfigs.id,
			{ onDelete: "set null" },
		),
		profileId: text("profile_id").notNull(),
		dastKind: text("dast_kind").notNull(),
		targetOrigin: text("target_origin").notNull(),
		runnerOrigin: text("runner_origin").notNull(),
		status: text("status").notNull(),
		outcome: text("outcome"),
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
		projectIdIdx: index("dast_runs_project_id_idx").on(table.projectId),
		scanRunIdIdx: index("dast_runs_scan_run_id_idx").on(table.scanRunId),
		targetConfigIdIdx: index("dast_runs_target_config_id_idx").on(
			table.targetConfigId,
		),
		profileConfigIdIdx: index("dast_runs_profile_config_id_idx").on(
			table.profileConfigId,
		),
		statusIdx: index("dast_runs_status_idx").on(table.status),
		outcomeIdx: index("dast_runs_outcome_idx").on(table.outcome),
		dastKindIdx: index("dast_runs_dast_kind_idx").on(table.dastKind),
	}),
);

export const dastArtifacts = sqliteTable(
	"dast_artifacts",
	{
		id: id(),
		dastRunId: text("dast_run_id")
			.notNull()
			.references(() => dastRuns.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(),
		format: text("format").notNull(),
		path: text("path").notNull(),
		sha256: text("sha256").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		dastRunIdIdx: index("dast_artifacts_dast_run_id_idx").on(table.dastRunId),
		projectIdIdx: index("dast_artifacts_project_id_idx").on(table.projectId),
		scanRunIdIdx: index("dast_artifacts_scan_run_id_idx").on(table.scanRunId),
	}),
);

export const dastEvidence = sqliteTable(
	"dast_evidence",
	{
		id: id(),
		dastRunId: text("dast_run_id")
			.notNull()
			.references(() => dastRuns.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		findingId: text("finding_id").references(() => findings.id, {
			onDelete: "set null",
		}),
		kind: text("kind").notNull(),
		title: text("title").notNull(),
		artifactId: text("artifact_id").references(() => dastArtifacts.id, {
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
		dastRunIdIdx: index("dast_evidence_dast_run_id_idx").on(table.dastRunId),
		projectIdIdx: index("dast_evidence_project_id_idx").on(table.projectId),
		scanRunIdIdx: index("dast_evidence_scan_run_id_idx").on(table.scanRunId),
		findingIdIdx: index("dast_evidence_finding_id_idx").on(table.findingId),
	}),
);
