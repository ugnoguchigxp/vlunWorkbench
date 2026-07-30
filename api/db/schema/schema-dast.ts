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
import { findings, projects, scanRuns } from "./schema-scans";
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
