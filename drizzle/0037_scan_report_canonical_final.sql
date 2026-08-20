ALTER TABLE `scan_reports`
	ADD `stage` text NOT NULL DEFAULT 'preliminary';
--> statement-breakpoint
ALTER TABLE `scan_reports`
	ADD `supersedes_report_id` text REFERENCES `scan_reports`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `scan_reports_stage_scan_run_idx`
	ON `scan_reports` (`stage`, `scan_run_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_reports_canonical_final_unique_idx`
	ON `scan_reports` (`scan_run_id`)
	WHERE `stage` = 'canonical_final';
