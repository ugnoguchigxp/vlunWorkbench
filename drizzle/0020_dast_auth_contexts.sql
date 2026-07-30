CREATE TABLE `dast_test_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_config_id` text NOT NULL,
	`role` text NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_config_id`) REFERENCES `dast_target_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dast_test_identities_role_idx` ON `dast_test_identities` (`project_id`,`target_config_id`,`role`);
--> statement-breakpoint
CREATE TABLE `dast_auth_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_config_id` text NOT NULL,
	`test_identity_id` text NOT NULL,
	`identity_role` text NOT NULL,
	`label` text NOT NULL,
	`auth_kind` text NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`secret_nonce` text NOT NULL,
	`secret_auth_tag` text NOT NULL,
	`secret_key_id` text NOT NULL,
	`login_flow_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer NOT NULL,
	`rotated_at` integer,
	`revoked_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_config_id`) REFERENCES `dast_target_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_identity_id`) REFERENCES `dast_test_identities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dast_auth_contexts_project_idx` ON `dast_auth_contexts` (`project_id`);
--> statement-breakpoint
CREATE INDEX `dast_auth_contexts_target_idx` ON `dast_auth_contexts` (`target_config_id`);
--> statement-breakpoint
CREATE INDEX `dast_auth_contexts_identity_idx` ON `dast_auth_contexts` (`test_identity_id`);
--> statement-breakpoint
CREATE INDEX `dast_auth_contexts_status_idx` ON `dast_auth_contexts` (`status`);
--> statement-breakpoint
CREATE TABLE `dast_auth_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`auth_context_id` text,
	`event_type` text NOT NULL,
	`actor_user_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`auth_context_id`) REFERENCES `dast_auth_contexts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dast_auth_audit_events_project_idx` ON `dast_auth_audit_events` (`project_id`);
--> statement-breakpoint
CREATE INDEX `dast_auth_audit_events_context_idx` ON `dast_auth_audit_events` (`auth_context_id`);
