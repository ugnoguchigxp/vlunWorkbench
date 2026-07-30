CREATE TABLE `security_capability_benchmark_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`corpus_id` text NOT NULL,
	`corpus_version` text NOT NULL,
	`corpus_digest` text NOT NULL,
	`git_commit` text NOT NULL,
	`toolbox_image_digest` text NOT NULL,
	`scanner_manifest_hash` text NOT NULL,
	`benchmark_policy_version` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input_hash` text NOT NULL,
	`output_hash` text,
	`metrics_artifact_id` text,
	`error_code` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`metrics_artifact_id`) REFERENCES `scan_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `security_capability_benchmark_runs_corpus_idx` ON `security_capability_benchmark_runs` (`corpus_id`);
--> statement-breakpoint
CREATE INDEX `security_capability_benchmark_runs_status_idx` ON `security_capability_benchmark_runs` (`status`);
--> statement-breakpoint
CREATE TABLE `security_capability_benchmark_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`category` text NOT NULL,
	`true_positive` integer NOT NULL,
	`false_negative` integer NOT NULL,
	`true_negative` integer NOT NULL,
	`false_positive` integer NOT NULL,
	`recall` real,
	`precision` real,
	`false_positive_rate` real,
	`score` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `security_capability_benchmark_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_capability_benchmark_metrics_run_category_idx` ON `security_capability_benchmark_metrics` (`run_id`,`category`);
