CREATE TABLE `scan_resource_leases` (
  `id` text PRIMARY KEY NOT NULL,
  `scan_run_id` text NOT NULL,
  `step_id` text NOT NULL,
  `resource_type` text NOT NULL,
  `provider` text NOT NULL,
  `external_id` text NOT NULL,
  `state` text NOT NULL,
  `receipt` text DEFAULT '{}',
  `lease_expires_at` integer,
  `released_at` integer,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_resource_leases_scan_run_idx` ON `scan_resource_leases` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `scan_resource_leases_active_idx` ON `scan_resource_leases` (`state`, `lease_expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_resource_leases_resource_unique_idx` ON `scan_resource_leases` (`provider`, `external_id`);
