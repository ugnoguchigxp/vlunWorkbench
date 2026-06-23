CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`repo_path` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_owner_user_id_idx` ON `projects` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_owner_repo_path_unique_idx` ON `projects` (`owner_user_id`,`repo_path`);--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile` text DEFAULT 'baseline' NOT NULL,
	`status` text NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_by_user_id` text,
	`summary` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scan_runs_project_id_idx` ON `scan_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `scan_runs_status_idx` ON `scan_runs` (`status`);--> statement-breakpoint
CREATE TABLE `scan_events` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`level` text NOT NULL,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_events_scan_run_id_idx` ON `scan_events` (`scan_run_id`);--> statement-breakpoint
CREATE TABLE `tool_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_version` text,
	`command` text,
	`status` text NOT NULL,
	`exit_code` integer,
	`started_at` integer,
	`completed_at` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tool_runs_scan_run_id_idx` ON `tool_runs` (`scan_run_id`);--> statement-breakpoint
CREATE TABLE `scan_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`tool_run_id` text,
	`kind` text NOT NULL,
	`format` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_run_id`) REFERENCES `tool_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scan_artifacts_scan_run_id_idx` ON `scan_artifacts` (`scan_run_id`);--> statement-breakpoint
CREATE INDEX `scan_artifacts_tool_run_id_idx` ON `scan_artifacts` (`tool_run_id`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_tool` text NOT NULL,
	`rule_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`severity` text NOT NULL,
	`confidence` text DEFAULT 'static' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`primary_location` text,
	`fingerprint` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_scan_run_id_idx` ON `findings` (`scan_run_id`);--> statement-breakpoint
CREATE INDEX `findings_project_id_idx` ON `findings` (`project_id`);--> statement-breakpoint
CREATE INDEX `findings_fingerprint_idx` ON `findings` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `finding_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`artifact_id` text,
	`location` text,
	`snippet` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `scan_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `finding_evidence_finding_id_idx` ON `finding_evidence` (`finding_id`);
