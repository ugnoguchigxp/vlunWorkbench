CREATE TRIGGER `scan_runs_prevent_delete_with_active_work`
BEFORE DELETE ON `scan_runs`
WHEN
	OLD.`status` IN ('queued', 'running')
	OR EXISTS (
		SELECT 1 FROM `tool_runs`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `static_intelligence_prepare_jobs`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('requested', 'queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `scan_reviews`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `scan_reports`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `scan_diagnostic_runs`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `dast_runs`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `dynamic_runs`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `reproduction_runs`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `active_assessment_runs`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `business_logic_runs`
		WHERE `scan_run_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
BEGIN
	SELECT RAISE(ABORT, 'scan_has_active_work');
END;
--> statement-breakpoint
CREATE TRIGGER `projects_prevent_delete_with_active_work`
BEFORE DELETE ON `projects`
WHEN
	EXISTS (
		SELECT 1 FROM `scan_runs`
		WHERE `project_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `tool_runs`
		INNER JOIN `scan_runs` ON `scan_runs`.`id` = `tool_runs`.`scan_run_id`
		WHERE `scan_runs`.`project_id` = OLD.`id` AND `tool_runs`.`status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `static_intelligence_prepare_jobs`
		WHERE `project_id` = OLD.`id` AND `status` IN ('requested', 'queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `scan_reviews`
		WHERE `project_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `scan_reports`
		INNER JOIN `scan_runs` ON `scan_runs`.`id` = `scan_reports`.`scan_run_id`
		WHERE `scan_runs`.`project_id` = OLD.`id` AND `scan_reports`.`status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `scan_diagnostic_runs`
		INNER JOIN `scan_runs` ON `scan_runs`.`id` = `scan_diagnostic_runs`.`scan_run_id`
		WHERE `scan_runs`.`project_id` = OLD.`id` AND `scan_diagnostic_runs`.`status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `dast_runs`
		WHERE `project_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `dynamic_runs`
		WHERE `project_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `reproduction_runs`
		WHERE `project_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `active_assessment_runs`
		WHERE `project_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `threat_model_runs`
		WHERE `project_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
	OR EXISTS (
		SELECT 1 FROM `business_logic_runs`
		WHERE `project_id` = OLD.`id` AND `status` IN ('queued', 'running')
	)
BEGIN
	SELECT RAISE(ABORT, 'project_has_active_work');
END;
