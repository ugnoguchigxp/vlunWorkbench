CREATE TABLE `application_model_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`model_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_model_snapshots_project_idx` ON `application_model_snapshots` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_model_snapshots_project_fingerprint_idx` ON `application_model_snapshots` (`project_id`,`source_fingerprint`);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_model_snapshots_hash_idx` ON `application_model_snapshots` (`snapshot_hash`);
--> statement-breakpoint
CREATE TABLE `threat_model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`model_snapshot_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`llm_available` integer DEFAULT false NOT NULL,
	`limitations_json` text DEFAULT '[]' NOT NULL,
	`error_code` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_snapshot_id`) REFERENCES `application_model_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threat_model_runs_project_idx` ON `threat_model_runs` (`project_id`);
--> statement-breakpoint
CREATE TABLE `threat_hypotheses` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`model_snapshot_id` text NOT NULL,
	`external_id` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`validation_kind` text NOT NULL,
	`hypothesis_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `threat_model_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_snapshot_id`) REFERENCES `application_model_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threat_hypotheses_run_external_idx` ON `threat_hypotheses` (`run_id`,`external_id`);
--> statement-breakpoint
CREATE TABLE `threat_model_evidences` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`hypothesis_id` text,
	`kind` text NOT NULL,
	`reference` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `threat_model_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hypothesis_id`) REFERENCES `threat_hypotheses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threat_model_evidences_run_idx` ON `threat_model_evidences` (`run_id`);
