ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS submission_type TEXT NOT NULL DEFAULT 'TEXT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_assignments_submission_type'
      AND conrelid = 'assignments'::regclass
  ) THEN
    ALTER TABLE assignments
      ADD CONSTRAINT chk_assignments_submission_type
      CHECK (submission_type IN ('FILE', 'LINK', 'TEXT'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment_student_latest
  ON assignment_submissions (assignment_id, student_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_assessment_student_latest
  ON assessment_attempts (assessment_id, student_id, submitted_at DESC);
