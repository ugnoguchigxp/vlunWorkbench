CREATE TABLE `scan_launch_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `requested_profile_id` text NOT NULL,
  `canonical_profile_id` text,
  `profile_variant_id` text,
  `engine_id` text,
  `status` text NOT NULL,
  `readiness_status` text,
  `reason_codes` text NOT NULL DEFAULT '[]',
  `sanitized_input_summary` text NOT NULL DEFAULT '{}',
  `catalog_entry_hash` text,
  `readiness_hash` text,
  `plan_hash` text,
  `dependency_qualification_hash` text,
  `scan_run_id` text REFERENCES `scan_runs`(`id`) ON DELETE SET NULL,
  `created_by_user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `resolved_at` integer,
  `admitted_at` integer,
  `rejected_at` integer,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX `scan_launch_attempts_project_created_idx` ON `scan_launch_attempts` (`project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `scan_launch_attempts_status_created_idx` ON `scan_launch_attempts` (`status`, `created_at`);
