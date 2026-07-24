ALTER TABLE `llm_provider_endpoints` ADD `api_key_ciphertext` text;
--> statement-breakpoint
ALTER TABLE `llm_provider_endpoints` ADD `api_key_nonce` text;
--> statement-breakpoint
ALTER TABLE `llm_provider_endpoints` ADD `api_key_auth_tag` text;
--> statement-breakpoint
ALTER TABLE `llm_provider_endpoints` ADD `api_key_key_id` text;
