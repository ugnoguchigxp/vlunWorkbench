CREATE TABLE `scan_execution_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL REFERENCES `scan_runs`(`id`) ON DELETE CASCADE,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`profile_id` text NOT NULL,
	`strictness` text NOT NULL,
	`plan_hash` text NOT NULL,
	`plan` text NOT NULL DEFAULT '{}',
	`created_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_execution_plans_scan_run_unique_idx`
	ON `scan_execution_plans` (`scan_run_id`);
