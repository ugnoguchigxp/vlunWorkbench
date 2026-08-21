CREATE TABLE `finding_grouping_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_run_id` text NOT NULL REFERENCES `scan_runs`(`id`) ON DELETE CASCADE,
	`status` text NOT NULL CHECK (`status` IN ('running', 'completed', 'failed')),
	`mode` text NOT NULL CHECK (`mode` IN ('deterministic', 'semantic')),
	`algorithm_version` text NOT NULL,
	`finding_set_hash` text NOT NULL,
	`semantic_decision_hash` text NOT NULL DEFAULT '',
	`snapshot_hash` text,
	`raw_finding_count` integer NOT NULL DEFAULT 0,
	`issue_count` integer NOT NULL DEFAULT 0,
	`suppressed_count` integer NOT NULL DEFAULT 0,
	`ambiguous_count` integer NOT NULL DEFAULT 0,
	`provider` text,
	`model` text,
	`prompt_sequence_hash` text,
	`limitations_json` text NOT NULL DEFAULT '[]',
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
	`updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX `finding_grouping_runs_scan_run_idx`
	ON `finding_grouping_runs` (`scan_run_id`);
--> statement-breakpoint
CREATE INDEX `finding_grouping_runs_completed_lookup_idx`
	ON `finding_grouping_runs` (`scan_run_id`, `mode`, `algorithm_version`, `finding_set_hash`, `completed_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_grouping_runs_active_unique_idx`
	ON `finding_grouping_runs` (`scan_run_id`, `mode`, `algorithm_version`, `finding_set_hash`)
	WHERE `status` = 'running';
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_grouping_runs_completed_unique_idx`
	ON `finding_grouping_runs` (`scan_run_id`, `mode`, `algorithm_version`, `finding_set_hash`, `semantic_decision_hash`)
	WHERE `status` = 'completed';
--> statement-breakpoint
CREATE TABLE `finding_issue_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`grouping_run_id` text NOT NULL REFERENCES `finding_grouping_runs`(`id`) ON DELETE CASCADE,
	`stable_key` text NOT NULL,
	`representative_finding_id` text REFERENCES `findings`(`id`) ON DELETE SET NULL,
	`issue_kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`severity` text NOT NULL,
	`primary_location_json` text NOT NULL DEFAULT '{}',
	`match_confidence` text NOT NULL CHECK (`match_confidence` IN ('exact', 'high', 'semantic_high', 'singleton')),
	`source_tools_json` text NOT NULL DEFAULT '[]',
	`reason_codes_json` text NOT NULL DEFAULT '[]',
	`metadata_json` text NOT NULL DEFAULT '{}',
	`created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
	UNIQUE (`grouping_run_id`, `stable_key`)
);
--> statement-breakpoint
CREATE INDEX `finding_issue_groups_run_idx`
	ON `finding_issue_groups` (`grouping_run_id`);
--> statement-breakpoint
CREATE TABLE `finding_issue_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL REFERENCES `finding_issue_groups`(`id`) ON DELETE CASCADE,
	`grouping_run_id` text NOT NULL REFERENCES `finding_grouping_runs`(`id`) ON DELETE CASCADE,
	`finding_id` text NOT NULL REFERENCES `findings`(`id`) ON DELETE CASCADE,
	`role` text NOT NULL CHECK (`role` IN ('representative', 'supporting')),
	`match_method` text NOT NULL CHECK (`match_method` IN ('deterministic', 'singleton', 'semantic')),
	`match_confidence` text NOT NULL CHECK (`match_confidence` IN ('exact', 'high', 'semantic_high', 'singleton')),
	`reason_codes_json` text NOT NULL DEFAULT '[]',
	`comparison_hash` text,
	`identity_json` text NOT NULL DEFAULT '{}',
	`created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
	UNIQUE (`grouping_run_id`, `finding_id`)
);
--> statement-breakpoint
CREATE INDEX `finding_issue_group_members_group_idx`
	ON `finding_issue_group_members` (`group_id`);
--> statement-breakpoint
CREATE TABLE `finding_grouping_pair_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`grouping_run_id` text NOT NULL REFERENCES `finding_grouping_runs`(`id`) ON DELETE CASCADE,
	`left_finding_id` text NOT NULL REFERENCES `findings`(`id`) ON DELETE CASCADE,
	`right_finding_id` text NOT NULL REFERENCES `findings`(`id`) ON DELETE CASCADE,
	`verdict` text NOT NULL CHECK (`verdict` IN ('same', 'different', 'ambiguous')),
	`confidence` text NOT NULL CHECK (`confidence` IN ('exact', 'high', 'semantic_high', 'none')),
	`method` text NOT NULL CHECK (`method` IN ('deterministic', 'semantic')),
	`reason_codes_json` text NOT NULL DEFAULT '[]',
	`rationale` text,
	`comparison_hash` text NOT NULL,
	`provider` text,
	`model` text,
	`prompt_sequence_hash` text,
	`response_content_sha256` text,
	`created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
	CHECK (`left_finding_id` < `right_finding_id`),
	UNIQUE (`grouping_run_id`, `left_finding_id`, `right_finding_id`)
);
--> statement-breakpoint
CREATE INDEX `finding_grouping_pair_decisions_cache_idx`
	ON `finding_grouping_pair_decisions` (`comparison_hash`, `method`, `provider`, `model`, `prompt_sequence_hash`, `created_at`);
