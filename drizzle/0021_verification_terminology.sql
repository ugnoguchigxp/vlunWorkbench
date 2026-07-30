ALTER TABLE reproduction_runs
ADD COLUMN verification_kind TEXT NOT NULL DEFAULT 'scanner_recheck';

ALTER TABLE reproduction_runs
ADD COLUMN evidence_strength TEXT NOT NULL DEFAULT 'scanner_signal';

UPDATE reproduction_runs
SET
  metadata = json_set(
    CASE
      WHEN json_valid(metadata) THEN metadata
      ELSE '{}'
    END,
    '$.legacyOutcome',
    outcome
  ),
  outcome = CASE
    WHEN outcome = 'reproduced' THEN 'observed'
    WHEN outcome = 'not_reproduced' THEN 'not_observed'
    ELSE outcome
  END
WHERE outcome IN ('reproduced', 'not_reproduced');

CREATE INDEX reproduction_runs_verification_kind_idx
ON reproduction_runs (verification_kind);
