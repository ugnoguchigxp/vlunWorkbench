ALTER TABLE `scan_runs` ADD `last_event_seq` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scan_events` ADD `seq` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `scan_events`
SET `seq` = (
	SELECT COUNT(*)
	FROM `scan_events` AS `ordered`
	WHERE `ordered`.`scan_run_id` = `scan_events`.`scan_run_id`
		AND (
			`ordered`.`created_at` < `scan_events`.`created_at`
			OR (
				`ordered`.`created_at` = `scan_events`.`created_at`
				AND `ordered`.`id` <= `scan_events`.`id`
			)
		)
);
--> statement-breakpoint
UPDATE `scan_runs`
SET `last_event_seq` = (
	SELECT COUNT(*)
	FROM `scan_events`
	WHERE `scan_events`.`scan_run_id` = `scan_runs`.`id`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_events_scan_run_seq_unique_idx`
	ON `scan_events` (`scan_run_id`, `seq`);
--> statement-breakpoint
CREATE TRIGGER `scan_events_assign_seq`
AFTER INSERT ON `scan_events`
WHEN NEW.`seq` = 0
BEGIN
	UPDATE `scan_runs`
	SET `last_event_seq` = `last_event_seq` + 1
	WHERE `id` = NEW.`scan_run_id`;
	UPDATE `scan_events`
	SET `seq` = (
		SELECT `last_event_seq`
		FROM `scan_runs`
		WHERE `id` = NEW.`scan_run_id`
	)
	WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
ALTER TABLE `scan_reports` ADD `attempt_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `scan_reports` ADD `error_code` text;
--> statement-breakpoint
ALTER TABLE `scan_reports` ADD `retryable` integer;
--> statement-breakpoint
ALTER TABLE `scan_reports` ADD `started_at` integer;
--> statement-breakpoint
ALTER TABLE `scan_reports` ADD `completed_at` integer;
--> statement-breakpoint
UPDATE `scan_reports`
SET `started_at` = `created_at`
WHERE `status` = 'running' AND `started_at` IS NULL;
--> statement-breakpoint
UPDATE `scan_reports`
SET `completed_at` = `updated_at`
WHERE `status` IN ('completed', 'failed') AND `completed_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `integration_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`allowed_roots_json` text DEFAULT '[]' NOT NULL,
	`rate_limit_policy_json` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_clients_token_prefix_unique_idx`
	ON `integration_clients` (`token_prefix`);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_clients_token_hash_unique_idx`
	ON `integration_clients` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `integration_clients_owner_user_id_idx`
	ON `integration_clients` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `integration_clients_active_idx`
	ON `integration_clients` (`active`);
--> statement-breakpoint
CREATE TABLE `integration_resource_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_client_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`integration_client_id`) REFERENCES `integration_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_resource_bindings_resource_unique_idx`
	ON `integration_resource_bindings` (`resource_type`, `resource_id`);
--> statement-breakpoint
CREATE INDEX `integration_resource_bindings_client_resource_idx`
	ON `integration_resource_bindings` (`integration_client_id`, `resource_type`, `resource_id`);
--> statement-breakpoint
CREATE INDEX `integration_resource_bindings_project_idx`
	ON `integration_resource_bindings` (`project_id`);
--> statement-breakpoint
CREATE TABLE `integration_idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_client_id` text NOT NULL,
	`operation` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`integration_client_id`) REFERENCES `integration_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_idempotency_client_operation_key_unique_idx`
	ON `integration_idempotency_keys` (`integration_client_id`, `operation`, `idempotency_key`);
--> statement-breakpoint
CREATE INDEX `integration_idempotency_resource_idx`
	ON `integration_idempotency_keys` (`resource_type`, `resource_id`);
--> statement-breakpoint
CREATE INDEX `integration_idempotency_expires_at_idx`
	ON `integration_idempotency_keys` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `integration_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_client_id` text NOT NULL,
	`project_id` text NOT NULL,
	`selection_json` text DEFAULT '{}' NOT NULL,
	`target_kind` text NOT NULL,
	`resolved_profile_ref` text NOT NULL,
	`target_digest` text NOT NULL,
	`source_revision` text,
	`file_count` integer,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`integration_client_id`) REFERENCES `integration_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `integration_previews_client_project_idx`
	ON `integration_previews` (`integration_client_id`, `project_id`);
--> statement-breakpoint
CREATE INDEX `integration_previews_expires_at_idx`
	ON `integration_previews` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `integration_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_client_id` text,
	`owner_user_id` text,
	`scope` text,
	`operation` text NOT NULL,
	`request_id` text NOT NULL,
	`project_ref` text,
	`path_hash` text,
	`idempotency_key_hash` text,
	`resource_ref` text,
	`outcome` text NOT NULL,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`integration_client_id`) REFERENCES `integration_clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `integration_audit_logs_client_created_at_idx`
	ON `integration_audit_logs` (`integration_client_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `integration_audit_logs_request_id_idx`
	ON `integration_audit_logs` (`request_id`);
