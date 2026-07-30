CREATE TABLE `active_assessment_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`target_config_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`finding_count` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`result_json` text DEFAULT '{}' NOT NULL,
	`error_message` text,
	`created_by_user_id` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`engagement_id`) REFERENCES `assessment_engagements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `active_assessment_runs_project_id_idx` ON `active_assessment_runs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `active_assessment_runs_scan_run_id_idx` ON `active_assessment_runs` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `active_assessment_runs_engagement_id_idx` ON `active_assessment_runs` (`engagement_id`);
--> statement-breakpoint
CREATE TABLE `active_assessment_evidences` (
	`id` text PRIMARY KEY NOT NULL,
	`active_assessment_run_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status_code` integer,
	`identity_role` text,
	`stage` text NOT NULL,
	`request_sha256` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`active_assessment_run_id`) REFERENCES `active_assessment_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `active_assessment_evidences_run_id_idx` ON `active_assessment_evidences` (`active_assessment_run_id`);
