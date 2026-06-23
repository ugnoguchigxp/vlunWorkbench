CREATE TABLE `finding_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`likely_impact` text,
	`false_positive_assessment` text,
	`evidence_strength` text,
	`remediation_direction` text,
	`reviewer_notes` text,
	`confidence_adjustment` text NOT NULL,
	`input_bundle` text,
	`output` text,
	`error_message` text,
	`created_by_user_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `finding_reviews_finding_id_idx` ON `finding_reviews` (`finding_id`);--> statement-breakpoint
CREATE INDEX `finding_reviews_status_idx` ON `finding_reviews` (`status`);
