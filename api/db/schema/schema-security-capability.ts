import { sql } from "drizzle-orm";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ApplicationModel } from "../../../shared/schemas/application-model.schema";
import type { BusinessLogicScenario } from "../../../shared/schemas/business-logic.schema";
import type { ThreatHypothesis } from "../../../shared/schemas/threat-model.schema";
import { users } from "./schema-core";
import { id, timestampMs } from "./schema-helpers";
import { assessmentEngagements } from "./schema-assessment";
import { projects, scanArtifacts, scanRuns } from "./schema-scans";

export const securityCapabilityBenchmarkRuns = sqliteTable(
	"security_capability_benchmark_runs",
	{
		id: id(),
		corpusId: text("corpus_id").notNull(),
		corpusVersion: text("corpus_version").notNull(),
		corpusDigest: text("corpus_digest").notNull(),
		gitCommit: text("git_commit").notNull(),
		toolboxImageDigest: text("toolbox_image_digest").notNull(),
		scannerManifestHash: text("scanner_manifest_hash").notNull(),
		benchmarkPolicyVersion: text("benchmark_policy_version").notNull(),
		status: text("status").notNull().default("queued"),
		inputHash: text("input_hash").notNull(),
		outputHash: text("output_hash"),
		metricsArtifactId: text("metrics_artifact_id").references(
			() => scanArtifacts.id,
			{ onDelete: "set null" },
		),
		errorCode: text("error_code"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		corpusIdx: index("security_capability_benchmark_runs_corpus_idx").on(
			table.corpusId,
		),
		statusIdx: index("security_capability_benchmark_runs_status_idx").on(
			table.status,
		),
	}),
);

export const securityCapabilityBenchmarkMetrics = sqliteTable(
	"security_capability_benchmark_metrics",
	{
		id: id(),
		runId: text("run_id")
			.notNull()
			.references(() => securityCapabilityBenchmarkRuns.id, {
				onDelete: "cascade",
			}),
		category: text("category").notNull(),
		truePositive: integer("true_positive").notNull(),
		falseNegative: integer("false_negative").notNull(),
		trueNegative: integer("true_negative").notNull(),
		falsePositive: integer("false_positive").notNull(),
		recall: real("recall"),
		precision: real("precision"),
		falsePositiveRate: real("false_positive_rate"),
		score: real("score"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		runCategoryUniqueIdx: uniqueIndex(
			"security_capability_benchmark_metrics_run_category_idx",
		).on(table.runId, table.category),
	}),
);

export const applicationModelSnapshots = sqliteTable(
	"application_model_snapshots",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		sourceFingerprint: text("source_fingerprint").notNull(),
		snapshotHash: text("snapshot_hash").notNull(),
		model: text("model_json", { mode: "json" })
			.$type<ApplicationModel>()
			.notNull(),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		projectIdx: index("application_model_snapshots_project_idx").on(
			table.projectId,
		),
		projectFingerprintUniqueIdx: uniqueIndex(
			"application_model_snapshots_project_fingerprint_idx",
		).on(table.projectId, table.sourceFingerprint),
		hashUniqueIdx: uniqueIndex("application_model_snapshots_hash_idx").on(
			table.snapshotHash,
		),
	}),
);

export const threatModelRuns = sqliteTable(
	"threat_model_runs",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		modelSnapshotId: text("model_snapshot_id")
			.notNull()
			.references(() => applicationModelSnapshots.id, {
				onDelete: "restrict",
			}),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		status: text("status").notNull().default("queued"),
		llmAvailable: integer("llm_available", { mode: "boolean" })
			.notNull()
			.default(false),
		limitations: text("limitations_json", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		errorCode: text("error_code"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdx: index("threat_model_runs_project_idx").on(table.projectId),
	}),
);

export const threatHypotheses = sqliteTable(
	"threat_hypotheses",
	{
		id: id(),
		runId: text("run_id")
			.notNull()
			.references(() => threatModelRuns.id, { onDelete: "cascade" }),
		modelSnapshotId: text("model_snapshot_id")
			.notNull()
			.references(() => applicationModelSnapshots.id, {
				onDelete: "restrict",
			}),
		externalId: text("external_id").notNull(),
		category: text("category").notNull(),
		status: text("status").notNull(),
		validationKind: text("validation_kind").notNull(),
		hypothesis: text("hypothesis_json", { mode: "json" })
			.$type<ThreatHypothesis>()
			.notNull(),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		runExternalUniqueIdx: uniqueIndex("threat_hypotheses_run_external_idx").on(
			table.runId,
			table.externalId,
		),
	}),
);

export const threatModelEvidences = sqliteTable(
	"threat_model_evidences",
	{
		id: id(),
		runId: text("run_id")
			.notNull()
			.references(() => threatModelRuns.id, { onDelete: "cascade" }),
		hypothesisId: text("hypothesis_id").references(() => threatHypotheses.id, {
			onDelete: "cascade",
		}),
		kind: text("kind").notNull(),
		reference: text("reference").notNull(),
		evidenceHash: text("evidence_hash").notNull(),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		runIdx: index("threat_model_evidences_run_idx").on(table.runId),
	}),
);

export const businessLogicScenarios = sqliteTable(
	"business_logic_scenarios",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		hypothesisId: text("hypothesis_id")
			.notNull()
			.references(() => threatHypotheses.id, { onDelete: "restrict" }),
		engagementId: text("engagement_id")
			.notNull()
			.references(() => assessmentEngagements.id, {
				onDelete: "restrict",
			}),
		targetConfigId: text("target_config_id").notNull(),
		controlId: text("control_id").notNull(),
		planHash: text("plan_hash").notNull(),
		scenario: text("scenario_json", { mode: "json" })
			.$type<BusinessLogicScenario>()
			.notNull(),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		projectIdx: index("business_logic_scenarios_project_idx").on(
			table.projectId,
		),
		planHashUniqueIdx: uniqueIndex("business_logic_scenarios_plan_hash_idx").on(
			table.planHash,
		),
	}),
);

export const businessLogicRuns = sqliteTable(
	"business_logic_runs",
	{
		id: id(),
		scenarioId: text("scenario_id")
			.notNull()
			.references(() => businessLogicScenarios.id, { onDelete: "restrict" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		status: text("status").notNull().default("running"),
		requestCount: integer("request_count").notNull().default(0),
		findingCount: integer("finding_count").notNull().default(0),
		cleanupSucceeded: integer("cleanup_succeeded", { mode: "boolean" }),
		baselineHash: text("baseline_hash"),
		result: text("result_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'`),
		errorCode: text("error_code"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		projectIdx: index("business_logic_runs_project_idx").on(table.projectId),
		scenarioIdx: index("business_logic_runs_scenario_idx").on(table.scenarioId),
	}),
);

export const businessLogicEvidences = sqliteTable(
	"business_logic_evidences",
	{
		id: id(),
		runId: text("run_id")
			.notNull()
			.references(() => businessLogicRuns.id, { onDelete: "cascade" }),
		stage: text("stage").notNull(),
		method: text("method").notNull(),
		path: text("path").notNull(),
		statusCode: integer("status_code"),
		requestSha256: text("request_sha256").notNull(),
		durationMs: integer("duration_ms").notNull(),
		invariantId: text("invariant_id"),
		invariantObserved: integer("invariant_observed", { mode: "boolean" }),
		errorCode: text("error_code"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		runIdx: index("business_logic_evidences_run_idx").on(table.runId),
	}),
);
