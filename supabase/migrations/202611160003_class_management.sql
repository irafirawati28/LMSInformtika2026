CREATE UNIQUE INDEX IF NOT EXISTS uq_subjects_name_ci
  ON subjects (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_class_students_active_class
  ON class_students (class_id, student_id)
  WHERE is_active = TRUE;
