CREATE TABLE `scan_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`artifact_id` text,
	`format` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`options` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`generated_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `scan_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`generated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scan_reports_scan_run_id_idx` ON `scan_reports` (`scan_run_id`);--> statement-breakpoint
CREATE INDEX `scan_reports_artifact_id_idx` ON `scan_reports` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `scan_reports_status_idx` ON `scan_reports` (`status`);