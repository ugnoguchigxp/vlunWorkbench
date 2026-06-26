CREATE TABLE `llm_provider_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`api_key` text,
	`base_url` text,
	`endpoint` text,
	`api_version` text,
	`region` text,
	`models` text DEFAULT '[]' NOT NULL,
	`model_display_names` text DEFAULT '{}' NOT NULL,
	`default_model_capability` text DEFAULT null,
	`model_capabilities` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_provider_endpoints_kind_idx` ON `llm_provider_endpoints` (`kind`);
--> statement-breakpoint
CREATE INDEX `llm_provider_endpoints_enabled_idx` ON `llm_provider_endpoints` (`enabled`);
--> statement-breakpoint
CREATE TABLE `llm_task_routes` (
	`task` text PRIMARY KEY NOT NULL,
	`primary_provider_endpoint_id` text,
	`primary_model` text,
	`primary_thinking_depth` text,
	`fallback_targets` text DEFAULT '[]' NOT NULL,
	`policy` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`primary_provider_endpoint_id`) REFERENCES `llm_provider_endpoints`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `llm_provider_health_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_endpoint_id` text NOT NULL,
	`ok` integer NOT NULL,
	`reachable` integer NOT NULL,
	`status` text NOT NULL,
	`url` text,
	`message` text,
	`duration_ms` integer NOT NULL,
	`checked_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`provider_endpoint_id`) REFERENCES `llm_provider_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `llm_provider_health_checks_endpoint_idx` ON `llm_provider_health_checks` (`provider_endpoint_id`);
--> statement-breakpoint
CREATE INDEX `llm_provider_health_checks_checked_at_idx` ON `llm_provider_health_checks` (`checked_at`);
