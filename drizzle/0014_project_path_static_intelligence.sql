ALTER TABLE `projects` ADD `canonical_repo_path` text;
--> statement-breakpoint
UPDATE `projects` SET `canonical_repo_path` = `repo_path` WHERE `canonical_repo_path` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_canonical_repo_path_unique_idx` ON `projects` (`canonical_repo_path`);
--> statement-breakpoint
CREATE TABLE `static_intelligence_prepare_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`canonical_project_path` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`scan_run_id` text,
	`generation_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message_redacted` text,
	`retryable` integer,
	`lease_expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `static_intel_prepare_project_idx` ON `static_intelligence_prepare_jobs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `static_intel_prepare_source_idx` ON `static_intelligence_prepare_jobs` (`project_id`, `source_fingerprint`);
--> statement-breakpoint
CREATE INDEX `static_intel_prepare_status_idx` ON `static_intelligence_prepare_jobs` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `static_intel_prepare_active_unique_idx`
	ON `static_intelligence_prepare_jobs` (`project_id`, `source_fingerprint`)
	WHERE `status` IN ('requested', 'queued', 'running');
