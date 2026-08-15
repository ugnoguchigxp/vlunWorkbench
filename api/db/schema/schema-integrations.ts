import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./schema-core";
import { projects } from "./schema-scans";
import { id, jsonArray, jsonObject, timestampMs } from "./schema-helpers";

export const integrationClients = sqliteTable(
	"integration_clients",
	{
		id: id(),
		name: text("name").notNull(),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenPrefix: text("token_prefix").notNull(),
		tokenHash: text("token_hash").notNull(),
		scopes: jsonArray("scopes_json"),
		allowedRoots: jsonArray("allowed_roots_json"),
		rateLimitPolicy: jsonObject("rate_limit_policy_json"),
		active: integer("active", { mode: "boolean" }).notNull().default(true),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		tokenPrefixUniqueIdx: uniqueIndex(
			"integration_clients_token_prefix_unique_idx",
		).on(table.tokenPrefix),
		tokenHashUniqueIdx: uniqueIndex(
			"integration_clients_token_hash_unique_idx",
		).on(table.tokenHash),
		ownerUserIdIdx: index("integration_clients_owner_user_id_idx").on(
			table.ownerUserId,
		),
		activeIdx: index("integration_clients_active_idx").on(table.active),
	}),
);

export const integrationResourceBindings = sqliteTable(
	"integration_resource_bindings",
	{
		id: id(),
		integrationClientId: text("integration_client_id")
			.notNull()
			.references(() => integrationClients.id, { onDelete: "cascade" }),
		resourceType: text("resource_type").notNull(),
		resourceId: text("resource_id").notNull(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		resourceUniqueIdx: uniqueIndex(
			"integration_resource_bindings_resource_unique_idx",
		).on(table.resourceType, table.resourceId),
		clientResourceIdx: index(
			"integration_resource_bindings_client_resource_idx",
		).on(table.integrationClientId, table.resourceType, table.resourceId),
		projectIdx: index("integration_resource_bindings_project_idx").on(
			table.projectId,
		),
	}),
);

export const integrationIdempotencyKeys = sqliteTable(
	"integration_idempotency_keys",
	{
		id: id(),
		integrationClientId: text("integration_client_id")
			.notNull()
			.references(() => integrationClients.id, { onDelete: "cascade" }),
		operation: text("operation").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		requestHash: text("request_hash").notNull(),
		resourceType: text("resource_type").notNull(),
		resourceId: text("resource_id").notNull(),
		createdAt: timestampMs("created_at"),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		clientOperationKeyUniqueIdx: uniqueIndex(
			"integration_idempotency_client_operation_key_unique_idx",
		).on(table.integrationClientId, table.operation, table.idempotencyKey),
		resourceIdx: index("integration_idempotency_resource_idx").on(
			table.resourceType,
			table.resourceId,
		),
		expiresAtIdx: index("integration_idempotency_expires_at_idx").on(
			table.expiresAt,
		),
	}),
);

export const integrationPreviews = sqliteTable(
	"integration_previews",
	{
		id: id(),
		integrationClientId: text("integration_client_id")
			.notNull()
			.references(() => integrationClients.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		selection: jsonObject("selection_json"),
		targetKind: text("target_kind").notNull(),
		resolvedProfileRef: text("resolved_profile_ref").notNull(),
		targetDigest: text("target_digest").notNull(),
		sourceRevision: text("source_revision"),
		fileCount: integer("file_count"),
		warnings: jsonArray("warnings_json"),
		createdAt: timestampMs("created_at"),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => ({
		clientProjectIdx: index("integration_previews_client_project_idx").on(
			table.integrationClientId,
			table.projectId,
		),
		expiresAtIdx: index("integration_previews_expires_at_idx").on(
			table.expiresAt,
		),
	}),
);

export const integrationAuditLogs = sqliteTable(
	"integration_audit_logs",
	{
		id: id(),
		integrationClientId: text("integration_client_id").references(
			() => integrationClients.id,
			{ onDelete: "set null" },
		),
		ownerUserId: text("owner_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		scope: text("scope"),
		operation: text("operation").notNull(),
		requestId: text("request_id").notNull(),
		projectRef: text("project_ref"),
		pathHash: text("path_hash"),
		idempotencyKeyHash: text("idempotency_key_hash"),
		resourceRef: text("resource_ref"),
		outcome: text("outcome").notNull(),
		errorCode: text("error_code"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		clientCreatedAtIdx: index(
			"integration_audit_logs_client_created_at_idx",
		).on(table.integrationClientId, table.createdAt),
		requestIdIdx: index("integration_audit_logs_request_id_idx").on(
			table.requestId,
		),
	}),
);
export const nightworkersWorkspaceTargetGrants = sqliteTable(
	"nightworkers_workspace_target_grants",
	{
		id: id(),
		grantRef: text("grant_ref").notNull(),
		grantDigest: text("grant_digest").notNull(),
		integrationClientId: text("integration_client_id")
			.notNull()
			.references(() => integrationClients.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		workspaceSubjectRef: text("workspace_subject_ref").notNull(),
		canonicalWorkspacePath: text("canonical_workspace_path").notNull(),
		expectedGitCommonDirDigest: text(
			"expected_git_common_dir_digest",
		).notNull(),
		expectedHeadSha: text("expected_head_sha").notNull(),
		providerWorkspaceStateDigest: text(
			"provider_workspace_state_digest",
		).notNull(),
		previewRef: text("preview_ref"),
		previewSelection: jsonObject("preview_selection_json"),
		previewTargetDigest: text("preview_target_digest"),
		previewSourceRevision: text("preview_source_revision"),
		previewWorkspaceStateDigest: text("preview_workspace_state_digest"),
		previewExpiresAt: integer("preview_expires_at", { mode: "timestamp_ms" }),
		consumedRequestHash: text("consumed_request_hash"),
		consumedScanRunId: text("consumed_scan_run_id"),
		consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
		revision: integer("revision").notNull().default(1),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		grantRefUniqueIdx: uniqueIndex(
			"nightworkers_workspace_target_grants_ref_unique_idx",
		).on(table.grantRef),
		grantDigestUniqueIdx: uniqueIndex(
			"nightworkers_workspace_target_grants_digest_unique_idx",
		).on(table.grantDigest),
		clientProjectIdx: index(
			"nightworkers_workspace_target_grants_client_project_idx",
		).on(table.integrationClientId, table.projectId),
		expiresAtIdx: index(
			"nightworkers_workspace_target_grants_expires_at_idx",
		).on(table.expiresAt),
		consumedScanIdx: index(
			"nightworkers_workspace_target_grants_consumed_scan_idx",
		).on(table.consumedScanRunId),
	}),
);
