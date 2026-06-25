CREATE TABLE `reproduction_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`reproduction_run_id` text NOT NULL,
	`finding_id` text NOT NULL,
	`kind` text NOT NULL,
	`format` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`reproduction_run_id`) REFERENCES `reproduction_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reproduction_artifacts_reproduction_run_id_idx` ON `reproduction_artifacts` (`reproduction_run_id`);--> statement-breakpoint
CREATE INDEX `reproduction_artifacts_finding_id_idx` ON `reproduction_artifacts` (`finding_id`);--> statement-breakpoint
CREATE TABLE `reproduction_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`reproduction_run_id` text NOT NULL,
	`finding_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`artifact_id` text,
	`location` text,
	`snippet` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`reproduction_run_id`) REFERENCES `reproduction_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `reproduction_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reproduction_evidence_reproduction_run_id_idx` ON `reproduction_evidence` (`reproduction_run_id`);--> statement-breakpoint
CREATE INDEX `reproduction_evidence_finding_id_idx` ON `reproduction_evidence` (`finding_id`);--> statement-breakpoint
CREATE TABLE `reproduction_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`finding_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`runner` text NOT NULL,
	`command_json` text,
	`exit_code` integer,
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
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reproduction_runs_project_id_idx` ON `reproduction_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `reproduction_runs_scan_run_id_idx` ON `reproduction_runs` (`scan_run_id`);--> statement-breakpoint
CREATE INDEX `reproduction_runs_finding_id_idx` ON `reproduction_runs` (`finding_id`);--> statement-breakpoint
CREATE INDEX `reproduction_runs_status_idx` ON `reproduction_runs` (`status`);--> statement-breakpoint
CREATE INDEX `reproduction_runs_outcome_idx` ON `reproduction_runs` (`outcome`);