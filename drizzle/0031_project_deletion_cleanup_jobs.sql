CREATE TABLE `project_deletion_cleanup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`manifest_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_deletion_cleanup_jobs_status_created_idx`
	ON `project_deletion_cleanup_jobs` (`status`, `created_at`);
