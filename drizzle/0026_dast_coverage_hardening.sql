ALTER TABLE `dast_runs` ADD `verdict` text;
--> statement-breakpoint
ALTER TABLE `dast_runs` ADD `coverage_status` text;
--> statement-breakpoint
ALTER TABLE `dast_runs` ADD `coverage_summary_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `dast_runs` ADD `limitation_codes_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `dast_runs` ADD `policy_id` text;
--> statement-breakpoint
ALTER TABLE `dast_runs` ADD `policy_hash` text;
--> statement-breakpoint
ALTER TABLE `dast_auth_contexts` ADD `success_assertions_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
DROP INDEX `dast_profile_configs_project_profile_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `dast_profile_configs_project_target_profile_idx` ON `dast_profile_configs` (`project_id`,`target_config_id`,`profile_id`);
--> statement-breakpoint
CREATE TABLE `dast_route_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`dast_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`query_keys_json` text DEFAULT '[]' NOT NULL,
	`query_shape_hash` text NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`depth` integer NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`auth_mode` text NOT NULL,
	`state` text NOT NULL,
	`status_code` integer,
	`limitation_code` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`dast_run_id`) REFERENCES `dast_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dast_route_inventory_run_state_idx` ON `dast_route_inventory` (`dast_run_id`,`state`);
--> statement-breakpoint
CREATE INDEX `dast_route_inventory_run_source_idx` ON `dast_route_inventory` (`dast_run_id`,`sources_json`);
--> statement-breakpoint
CREATE INDEX `dast_route_inventory_project_created_idx` ON `dast_route_inventory` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dast_route_inventory_identity_idx` ON `dast_route_inventory` (`dast_run_id`,`method`,`path`,`query_shape_hash`,`auth_mode`);
