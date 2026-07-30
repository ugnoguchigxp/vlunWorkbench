CREATE TABLE `assessment_engagements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`purpose` text NOT NULL,
	`environment` text NOT NULL,
	`scope_json` text NOT NULL,
	`rules_of_engagement_json` text,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assessment_engagements_project_id_idx` ON `assessment_engagements` (`project_id`);
--> statement-breakpoint
CREATE INDEX `assessment_engagements_owner_idx` ON `assessment_engagements` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `assessment_engagements_status_idx` ON `assessment_engagements` (`status`);
--> statement-breakpoint
CREATE TABLE `scan_coverage_results` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`engagement_id` text,
	`control_id` text NOT NULL,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`reason_code` text NOT NULL,
	`evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`snapshot_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`engagement_id`) REFERENCES `assessment_engagements`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scan_coverage_results_scan_run_idx` ON `scan_coverage_results` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `scan_coverage_results_control_idx` ON `scan_coverage_results` (`control_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_coverage_results_scan_control_unique_idx` ON `scan_coverage_results` (`scan_run_id`, `control_id`);
