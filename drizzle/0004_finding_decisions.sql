CREATE TABLE `finding_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`comment` text,
	`linked_review_id` text,
	`decided_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_review_id`) REFERENCES `finding_reviews`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `finding_decisions_finding_id_idx` ON `finding_decisions` (`finding_id`);--> statement-breakpoint
CREATE INDEX `finding_decisions_linked_review_id_idx` ON `finding_decisions` (`linked_review_id`);
