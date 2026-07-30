CREATE TABLE `scan_diagnostic_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL,
	`input_snapshot_hash` text NOT NULL,
	`scanner_provenance_hash` text NOT NULL,
	`pipeline_version` text NOT NULL,
	`status` text NOT NULL,
	`readiness` text,
	`scan_review_id` text,
	`scan_report_id` text,
	`limitation_codes_json` text DEFAULT '[]' NOT NULL,
	`error_message` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_review_id`) REFERENCES `scan_reviews`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`scan_report_id`) REFERENCES `scan_reports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scan_diagnostic_runs_scan_run_id_idx`
	ON `scan_diagnostic_runs` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `scan_diagnostic_runs_status_idx`
	ON `scan_diagnostic_runs` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_diagnostic_runs_snapshot_unique_idx`
	ON `scan_diagnostic_runs` (`scan_run_id`, `input_snapshot_hash`, `pipeline_version`);
