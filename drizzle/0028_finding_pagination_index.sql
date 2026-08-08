CREATE INDEX IF NOT EXISTS `findings_scan_run_created_id_idx`
	ON `findings` (`scan_run_id`, `created_at`, `id`);
