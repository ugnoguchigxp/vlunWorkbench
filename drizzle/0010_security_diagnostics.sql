CREATE TABLE `attack_surface_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`location_json` text DEFAULT '{}' NOT NULL,
	`boundary_json` text DEFAULT '{}' NOT NULL,
	`evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`confidence` text NOT NULL DEFAULT 'medium',
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attack_surface_items_project_id_idx` ON `attack_surface_items` (`project_id`);
--> statement-breakpoint
CREATE INDEX `attack_surface_items_scan_run_id_idx` ON `attack_surface_items` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `attack_surface_items_category_idx` ON `attack_surface_items` (`category`);
--> statement-breakpoint
CREATE INDEX `attack_surface_items_kind_idx` ON `attack_surface_items` (`kind`);
--> statement-breakpoint
CREATE TABLE `security_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`severity_hint` text NOT NULL DEFAULT 'info',
	`description` text NOT NULL,
	`input_kinds_json` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_checks_check_id_idx` ON `security_checks` (`check_id`);
--> statement-breakpoint
CREATE INDEX `security_checks_category_idx` ON `security_checks` (`category`);
--> statement-breakpoint
CREATE INDEX `security_checks_enabled_idx` ON `security_checks` (`enabled`);
--> statement-breakpoint
CREATE TABLE `security_check_results` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text,
	`check_id` text NOT NULL,
	`attack_surface_item_id` text,
	`status` text NOT NULL,
	`outcome` text,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`remediation_hint` text,
	`coverage_gap` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attack_surface_item_id`) REFERENCES `attack_surface_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `security_check_results_project_id_idx` ON `security_check_results` (`project_id`);
--> statement-breakpoint
CREATE INDEX `security_check_results_scan_run_id_idx` ON `security_check_results` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `security_check_results_check_id_idx` ON `security_check_results` (`check_id`);
--> statement-breakpoint
CREATE INDEX `security_check_results_status_idx` ON `security_check_results` (`status`);
--> statement-breakpoint
CREATE INDEX `security_check_results_attack_surface_item_id_idx` ON `security_check_results` (`attack_surface_item_id`);
--> statement-breakpoint
CREATE TABLE `diagnostic_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`report_kind` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`checked_categories_json` text DEFAULT '[]' NOT NULL,
	`coverage_gaps_json` text DEFAULT '[]' NOT NULL,
	`residual_risks_json` text DEFAULT '[]' NOT NULL,
	`recommended_next_actions_json` text DEFAULT '[]' NOT NULL,
	`artifact_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `scan_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `diagnostic_reports_project_id_idx` ON `diagnostic_reports` (`project_id`);
--> statement-breakpoint
CREATE INDEX `diagnostic_reports_scan_run_id_idx` ON `diagnostic_reports` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `diagnostic_reports_report_kind_idx` ON `diagnostic_reports` (`report_kind`);
--> statement-breakpoint
CREATE INDEX `diagnostic_reports_status_idx` ON `diagnostic_reports` (`status`);
