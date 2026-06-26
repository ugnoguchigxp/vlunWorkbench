CREATE TABLE `scan_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`risk_overview` text,
	`priority_notes_json` text DEFAULT '[]' NOT NULL,
	`coverage_notes_json` text DEFAULT '[]' NOT NULL,
	`false_positive_hotspots_json` text DEFAULT '[]' NOT NULL,
	`recommended_next_actions_json` text DEFAULT '[]' NOT NULL,
	`finding_triage_hints_json` text DEFAULT '[]' NOT NULL,
	`confidence_notes_json` text DEFAULT '[]' NOT NULL,
	`input_bundle` text DEFAULT '{}' NOT NULL,
	`output` text DEFAULT '{}' NOT NULL,
	`error_message` text,
	`created_by_user_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scan_reviews_scan_run_id_idx` ON `scan_reviews` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `scan_reviews_project_id_idx` ON `scan_reviews` (`project_id`);
--> statement-breakpoint
CREATE INDEX `scan_reviews_status_idx` ON `scan_reviews` (`status`);
