CREATE TABLE `dynamic_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`dynamic_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`finding_id` text,
	`kind` text NOT NULL,
	`format` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`dynamic_run_id`) REFERENCES `dynamic_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dynamic_artifacts_dynamic_run_id_idx` ON `dynamic_artifacts` (`dynamic_run_id`);--> statement-breakpoint
CREATE INDEX `dynamic_artifacts_project_id_idx` ON `dynamic_artifacts` (`project_id`);--> statement-breakpoint
CREATE INDEX `dynamic_artifacts_finding_id_idx` ON `dynamic_artifacts` (`finding_id`);--> statement-breakpoint
CREATE TABLE `dynamic_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`dynamic_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`finding_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`artifact_id` text,
	`location` text,
	`snippet` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`dynamic_run_id`) REFERENCES `dynamic_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`artifact_id`) REFERENCES `dynamic_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dynamic_evidence_dynamic_run_id_idx` ON `dynamic_evidence` (`dynamic_run_id`);--> statement-breakpoint
CREATE INDEX `dynamic_evidence_project_id_idx` ON `dynamic_evidence` (`project_id`);--> statement-breakpoint
CREATE INDEX `dynamic_evidence_finding_id_idx` ON `dynamic_evidence` (`finding_id`);--> statement-breakpoint
CREATE TABLE `dynamic_profile_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`dynamic_kind` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`command_json` text NOT NULL,
	`working_directory` text DEFAULT '' NOT NULL,
	`timeout_sec` integer DEFAULT 120 NOT NULL,
	`network` text DEFAULT 'none' NOT NULL,
	`memory` text,
	`cpus` text,
	`writable_workdir` integer DEFAULT false NOT NULL,
	`allow_project_scripts` integer DEFAULT false NOT NULL,
	`expected_artifacts_json` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dynamic_profile_configs_project_profile_idx` ON `dynamic_profile_configs` (`project_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `dynamic_profile_configs_project_id_idx` ON `dynamic_profile_configs` (`project_id`);--> statement-breakpoint
CREATE INDEX `dynamic_profile_configs_dynamic_kind_idx` ON `dynamic_profile_configs` (`dynamic_kind`);--> statement-breakpoint
CREATE INDEX `dynamic_profile_configs_enabled_idx` ON `dynamic_profile_configs` (`enabled`);--> statement-breakpoint
CREATE TABLE `dynamic_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text,
	`finding_id` text,
	`profile_config_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`dynamic_kind` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`runner` text DEFAULT 'docker' NOT NULL,
	`command_json` text NOT NULL,
	`exit_code` integer,
	`started_at` integer,
	`completed_at` integer,
	`summary` text,
	`error_message` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`profile_config_id`) REFERENCES `dynamic_profile_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dynamic_runs_project_id_idx` ON `dynamic_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `dynamic_runs_scan_run_id_idx` ON `dynamic_runs` (`scan_run_id`);--> statement-breakpoint
CREATE INDEX `dynamic_runs_finding_id_idx` ON `dynamic_runs` (`finding_id`);--> statement-breakpoint
CREATE INDEX `dynamic_runs_profile_config_id_idx` ON `dynamic_runs` (`profile_config_id`);--> statement-breakpoint
CREATE INDEX `dynamic_runs_status_idx` ON `dynamic_runs` (`status`);--> statement-breakpoint
CREATE INDEX `dynamic_runs_outcome_idx` ON `dynamic_runs` (`outcome`);--> statement-breakpoint
CREATE INDEX `dynamic_runs_dynamic_kind_idx` ON `dynamic_runs` (`dynamic_kind`);