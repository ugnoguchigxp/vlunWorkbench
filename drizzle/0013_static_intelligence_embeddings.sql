CREATE TABLE `static_intelligence_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scan_run_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_ref` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`embedding` blob,
	`embedding_model` text NOT NULL,
	`embedding_dim` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`indexed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_run_id`) REFERENCES `scan_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `static_intel_embed_scan_run_idx` ON `static_intelligence_embeddings` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `static_intel_embed_project_idx` ON `static_intelligence_embeddings` (`project_id`);
--> statement-breakpoint
CREATE INDEX `static_intel_embed_source_idx` ON `static_intelligence_embeddings` (`source_kind`, `source_id`);
--> statement-breakpoint
CREATE INDEX `static_intel_embed_hash_idx` ON `static_intelligence_embeddings` (`content_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `static_intel_embed_source_unique_idx` ON `static_intelligence_embeddings` (`scan_run_id`, `source_kind`, `source_id`);
