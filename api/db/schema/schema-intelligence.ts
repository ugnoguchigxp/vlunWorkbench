import { sql } from "drizzle-orm";
import {
	blob,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { id, jsonArray, jsonObject, timestampMs } from "./schema-helpers";
import { projects, scanArtifacts, scanRuns } from "./schema-scans";
export const staticIntelligenceEmbeddings = sqliteTable(
	"static_intelligence_embeddings",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		scanRunId: text("scan_run_id")
			.notNull()
			.references(() => scanRuns.id, { onDelete: "cascade" }),
		sourceKind: text("source_kind").notNull(),
		sourceId: text("source_id").notNull(),
		sourceRef: text("source_ref").notNull(),
		title: text("title").notNull(),
		content: text("content").notNull(),
		contentHash: text("content_hash").notNull(),
		embedding: blob("embedding", { mode: "buffer" }),
		embeddingModel: text("embedding_model").notNull(),
		embeddingDim: integer("embedding_dim").notNull(),
		metadata: jsonObject("metadata"),
		indexedAt: timestampMs("indexed_at"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		scanRunIdx: index("static_intel_embed_scan_run_idx").on(table.scanRunId),
		projectIdx: index("static_intel_embed_project_idx").on(table.projectId),
		sourceIdx: index("static_intel_embed_source_idx").on(
			table.sourceKind,
			table.sourceId,
		),
		contentHashIdx: index("static_intel_embed_hash_idx").on(table.contentHash),
		uniqueSourceIdx: uniqueIndex("static_intel_embed_source_unique_idx").on(
			table.scanRunId,
			table.sourceKind,
			table.sourceId,
		),
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
