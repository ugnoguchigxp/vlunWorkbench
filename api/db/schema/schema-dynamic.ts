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
import { findings, projects, scanRuns } from "./schema-scans";
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
