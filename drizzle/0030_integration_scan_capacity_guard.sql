ALTER TABLE `integration_resource_bindings`
	ADD COLUMN `active_capacity_limit` integer;
--> statement-breakpoint
CREATE TRIGGER `integration_resource_binding_scan_capacity_guard`
	BEFORE INSERT ON `integration_resource_bindings`
	WHEN NEW.`resource_type` = 'scan_run'
BEGIN
	SELECT CASE WHEN
		NEW.`active_capacity_limit` IS NULL
		OR NEW.`active_capacity_limit` < 1
		OR (
			SELECT COUNT(*)
			FROM `integration_resource_bindings` AS `binding`
			INNER JOIN `scan_runs` AS `scan`
				ON `binding`.`resource_type` = 'scan_run'
				AND `binding`.`resource_id` = `scan`.`id`
			WHERE `binding`.`integration_client_id` = NEW.`integration_client_id`
				AND `scan`.`status` IN ('queued', 'running')
		) >= NEW.`active_capacity_limit`
	THEN RAISE(ABORT, 'integration_scan_capacity_exceeded') END;
END;
