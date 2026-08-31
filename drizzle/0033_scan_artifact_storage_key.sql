ALTER TABLE `scan_artifacts` ADD `storage_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_artifacts_storage_key_unique_idx`
	ON `scan_artifacts` (`storage_key`)
	WHERE `storage_key` IS NOT NULL;
