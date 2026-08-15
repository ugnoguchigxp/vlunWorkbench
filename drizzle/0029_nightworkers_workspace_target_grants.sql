CREATE TABLE `nightworkers_workspace_target_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_ref` text NOT NULL,
	`grant_digest` text NOT NULL,
	`integration_client_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_subject_ref` text NOT NULL,
	`canonical_workspace_path` text NOT NULL,
	`expected_git_common_dir_digest` text NOT NULL,
	`expected_head_sha` text NOT NULL,
	`provider_workspace_state_digest` text NOT NULL,
	`preview_ref` text,
	`preview_selection_json` text DEFAULT '{}' NOT NULL,
	`preview_target_digest` text,
	`preview_source_revision` text,
	`preview_workspace_state_digest` text,
	`preview_expires_at` integer,
	`consumed_request_hash` text,
	`consumed_scan_run_id` text,
	`consumed_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`integration_client_id`) REFERENCES `integration_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nightworkers_workspace_target_grants_ref_unique_idx`
	ON `nightworkers_workspace_target_grants` (`grant_ref`);
--> statement-breakpoint
CREATE UNIQUE INDEX `nightworkers_workspace_target_grants_digest_unique_idx`
	ON `nightworkers_workspace_target_grants` (`grant_digest`);
--> statement-breakpoint
CREATE INDEX `nightworkers_workspace_target_grants_client_project_idx`
	ON `nightworkers_workspace_target_grants` (`integration_client_id`, `project_id`);
--> statement-breakpoint
CREATE INDEX `nightworkers_workspace_target_grants_expires_at_idx`
	ON `nightworkers_workspace_target_grants` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `nightworkers_workspace_target_grants_consumed_scan_idx`
	ON `nightworkers_workspace_target_grants` (`consumed_scan_run_id`);
--> statement-breakpoint
CREATE TRIGGER `integration_idempotency_workspace_grant_consumption_guard`
	BEFORE INSERT ON `integration_idempotency_keys`
	WHEN NEW.`operation` = 'workspace_grant_consume'
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1
		FROM `nightworkers_workspace_target_grants`
		WHERE `grant_ref` = NEW.`idempotency_key`
			AND `integration_client_id` = NEW.`integration_client_id`
			AND `consumed_scan_run_id` = NEW.`resource_id`
			AND `consumed_at` IS NOT NULL
	) THEN RAISE(ABORT, 'workspace_grant_consumption_invalid') END;
END;
