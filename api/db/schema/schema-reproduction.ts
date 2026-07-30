import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./schema-core";
import { id, jsonObject, timestampMs } from "./schema-helpers";
import { findings, projects, scanRuns } from "./schema-scans";
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
		verificationKind: text("verification_kind")
			.notNull()
			.default("scanner_recheck"),
		evidenceStrength: text("evidence_strength")
			.notNull()
			.default("scanner_signal"),
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
		verificationKindIdx: index("reproduction_runs_verification_kind_idx").on(
			table.verificationKind,
		),
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
