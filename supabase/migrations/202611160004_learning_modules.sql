CREATE INDEX IF NOT EXISTS idx_module_contents_active_order
  ON module_contents (module_id, position)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_module_progress_module_student_status
  ON student_module_progress (module_id, student_id, status);

CREATE INDEX IF NOT EXISTS idx_content_progress_content_student_status
  ON student_content_progress (module_content_id, student_id, status);
