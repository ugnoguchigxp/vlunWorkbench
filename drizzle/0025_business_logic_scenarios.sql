CREATE TABLE `business_logic_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`hypothesis_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`target_config_id` text NOT NULL,
	`control_id` text NOT NULL,
	`plan_hash` text NOT NULL,
	`scenario_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hypothesis_id`) REFERENCES `threat_hypotheses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`engagement_id`) REFERENCES `assessment_engagements`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `business_logic_scenarios_project_idx` ON `business_logic_scenarios` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_logic_scenarios_plan_hash_idx` ON `business_logic_scenarios` (`plan_hash`);
--> statement-breakpoint
CREATE TABLE `business_logic_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`finding_count` integer DEFAULT 0 NOT NULL,
	`cleanup_succeeded` integer,
	`baseline_hash` text,
	`result_json` text DEFAULT '{}' NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `business_logic_scenarios`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `business_logic_runs_project_idx` ON `business_logic_runs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `business_logic_runs_scenario_idx` ON `business_logic_runs` (`scenario_id`);
--> statement-breakpoint
CREATE TABLE `business_logic_evidences` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status_code` integer,
	`request_sha256` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`invariant_id` text,
	`invariant_observed` integer,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `business_logic_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `business_logic_evidences_run_idx` ON `business_logic_evidences` (`run_id`);
