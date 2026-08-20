CREATE TABLE `scan_report_user_views` (
	`report_id` text NOT NULL,
	`user_id` text NOT NULL,
	`llm_comment_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`report_id`, `user_id`),
	FOREIGN KEY (`report_id`) REFERENCES `scan_reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_report_user_views_user_updated_idx`
	ON `scan_report_user_views` (`user_id`, `updated_at`);
