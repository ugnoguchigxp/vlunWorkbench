CREATE TABLE `dast_target_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`normalized_origin` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`allow_loopback` integer DEFAULT true NOT NULL,
	`allow_private_network` integer DEFAULT false NOT NULL,
	`allowed_paths_json` text DEFAULT '[]' NOT NULL,
	`excluded_paths_json` text DEFAULT '[]' NOT NULL,
	`default_headers_json` text DEFAULT '{}' NOT NULL,
	`max_depth` integer DEFAULT 0 NOT NULL,
	`max_requests` integer DEFAULT 20 NOT NULL,
	`rate_limit_per_sec` integer DEFAULT 2 NOT NULL,
	`timeout_sec` integer DEFAULT 120 NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dast_target_configs_project_id_idx` ON `dast_target_configs` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dast_target_configs_project_name_idx` ON `dast_target_configs` (`project_id`,`name`);
--> statement-breakpoint
CREATE INDEX `dast_target_configs_enabled_idx` ON `dast_target_configs` (`enabled`);
--> statement-breakpoint
CREATE TABLE `dast_profile_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_config_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`route_paths_json` text DEFAULT '[]' NOT NULL,
	`form_selectors_json` text DEFAULT '[]' NOT NULL,
	`check_options_json` text DEFAULT '{}' NOT NULL,
	`timeout_sec` integer,
	`max_requests` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_config_id`) REFERENCES `dast_target_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dast_profile_configs_project_id_idx` ON `dast_profile_configs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `dast_profile_configs_target_config_id_idx` ON `dast_profile_configs` (`target_config_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dast_profile_configs_project_profile_idx` ON `dast_profile_configs` (`project_id`,`profile_id`);
--> statement-breakpoint
CREATE INDEX `dast_profile_configs_enabled_idx` ON `dast_profile_configs` (`enabled`);
--> statement-breakpoint
CREATE TABLE `dast_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`target_config_id` text NOT NULL,
	`profile_config_id` text,
	`profile_id` text NOT NULL,
	`dast_kind` text NOT NULL,
	`target_origin` text NOT NULL,
	`runner_origin` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`started_at` integer,
	`completed_at` integer,
	`summary` text,
	`error_message` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_config_id`) REFERENCES `dast_target_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_config_id`) REFERENCES `dast_profile_configs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dast_runs_project_id_idx` ON `dast_runs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `dast_runs_scan_run_id_idx` ON `dast_runs` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `dast_runs_target_config_id_idx` ON `dast_runs` (`target_config_id`);
--> statement-breakpoint
CREATE INDEX `dast_runs_profile_config_id_idx` ON `dast_runs` (`profile_config_id`);
--> statement-breakpoint
CREATE INDEX `dast_runs_status_idx` ON `dast_runs` (`status`);
--> statement-breakpoint
CREATE INDEX `dast_runs_outcome_idx` ON `dast_runs` (`outcome`);
--> statement-breakpoint
CREATE INDEX `dast_runs_dast_kind_idx` ON `dast_runs` (`dast_kind`);
--> statement-breakpoint
CREATE TABLE `dast_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`dast_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`kind` text NOT NULL,
	`format` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`dast_run_id`) REFERENCES `dast_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dast_artifacts_dast_run_id_idx` ON `dast_artifacts` (`dast_run_id`);
--> statement-breakpoint
CREATE INDEX `dast_artifacts_project_id_idx` ON `dast_artifacts` (`project_id`);
--> statement-breakpoint
CREATE INDEX `dast_artifacts_scan_run_id_idx` ON `dast_artifacts` (`scan_run_id`);
--> statement-breakpoint
CREATE TABLE `dast_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`dast_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`finding_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`artifact_id` text,
	`location` text,
	`snippet` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`dast_run_id`) REFERENCES `dast_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`artifact_id`) REFERENCES `dast_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dast_evidence_dast_run_id_idx` ON `dast_evidence` (`dast_run_id`);
--> statement-breakpoint
CREATE INDEX `dast_evidence_project_id_idx` ON `dast_evidence` (`project_id`);
--> statement-breakpoint
CREATE INDEX `dast_evidence_scan_run_id_idx` ON `dast_evidence` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `dast_evidence_finding_id_idx` ON `dast_evidence` (`finding_id`);
