UPDATE `artifacts`
SET
	`type` = 'code',
	`metadata` = json_set(
		CASE
			WHEN json_valid(`metadata`) AND json_type(`metadata`) = 'object'
				THEN `metadata`
			ELSE '{}'
		END,
		'$.legacyArtifactType',
		'mermaid'
	),
	`updated_at` = (unixepoch() * 1000)
WHERE lower(trim(`type`)) = 'mermaid';
