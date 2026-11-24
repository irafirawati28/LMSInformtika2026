import { Router, type Response } from "express";
import type { QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import { requireStudent } from "../../middleware/require-student.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";
import { createExcelWorkbook } from "../../shared/excel-workbook.js";

type GradeRow = QueryResultRow & {
  id: string;
  source_id: string;
  student_id: string;
  full_name: string;
  nisn: string;
  activity_type: "ASSIGNMENT" | "ASSESSMENT";
  title: string;
  status: string;
  submitted_at: Date | null;
  score: string | null;
  max_score: string | null;
  feedback: string | null;
  graded_at: Date | null;
  attempt_number: number;
};

const teacherRouter = Router();
const studentRouter = Router();
teacherRouter.use(requireTeacher);
studentRouter.use(requireStudent);

const idFrom = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;

const userIdFrom = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const teacherGradesQuery = `
  SELECT source_id AS id, source_id, student_id, full_name, nisn, activity_type,
         title, status, submitted_at, score, max_score, feedback, graded_at, attempt_number
  FROM (
    SELECT s.id AS source_id, s.student_id, st.full_name, st.nisn,
           'ASSIGNMENT'::text AS activity_type, a.title, s.status,
           s.submitted_at, g.score::text AS score,
           g.max_score::text AS max_score,
           g.feedback, g.graded_at, s.attempt_number
    FROM assignment_submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    JOIN students st ON st.user_id = s.student_id
    LEFT JOIN grades g ON g.assignment_submission_id = s.id
    WHERE c.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND a.is_active = TRUE
    UNION ALL
    SELECT aa.id AS source_id, aa.student_id, st.full_name, st.nisn,
           'ASSESSMENT'::text AS activity_type, a.title, aa.status,
           aa.submitted_at, g.score::text AS score,
           COALESCE(g.max_score, (
             SELECT SUM(q.points) FROM questions q WHERE q.assessment_id = a.id
           ))::text AS max_score,
           g.feedback, g.graded_at, aa.attempt_number
    FROM assessment_attempts aa
    JOIN assessments a ON a.id = aa.assessment_id
    JOIN classes c ON c.id = a.class_id
    JOIN students st ON st.user_id = aa.student_id
    LEFT JOIN grades g ON g.assessment_attempt_id = aa.id
    WHERE c.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND a.is_active = TRUE
  ) grade_items
  ORDER BY submitted_at DESC NULLS LAST, full_name, title
`;

const toGradeItem = (row: GradeRow) => ({
  id: row.id,
  sourceId: row.source_id,
  studentId: row.student_id,
  fullName: row.full_name,
  nisn: row.nisn.trim(),
  type: row.activity_type,
  title: row.title,
  status: row.status,
  submittedAt: row.submitted_at,
  score: row.score === null ? null : Number(row.score),
  maxScore: row.max_score === null ? null : Number(row.max_score),
  feedback: row.feedback,
  gradedAt: row.graded_at,
  attemptNumber: row.attempt_number,
});

const escapeCsv = (value: unknown): string => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

const gradeExportHeaders = [
    "NISN", "Nama siswa", "Jenis", "Aktivitas", "Percobaan", "Status",
    "Nilai", "Nilai maksimum", "Umpan balik", "Tanggal pengumpulan", "Tanggal penilaian",
];

const gradeExportRows = (items: ReturnType<typeof toGradeItem>[]) => items.map((item) => [
    item.nisn, item.fullName, item.type === "ASSIGNMENT" ? "Tugas" : "Asesmen",
    item.title, item.attemptNumber, item.status,
    item.score, item.maxScore, item.feedback,
    item.submittedAt?.toISOString() ?? "", item.gradedAt?.toISOString() ?? "",
]);

const csvRows = (items: ReturnType<typeof toGradeItem>[]): string => {
  const rows = gradeExportRows(items);
  return `\uFEFFsep=;\r\n${[gradeExportHeaders, ...rows]
    .map((row) => row.map(escapeCsv).join(";"))
    .join("\r\n")}`;
};

teacherRouter.get("/classes/:classId/grades/export.csv", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows: classes } = await pool.query<QueryResultRow & { name: string }>(
    `SELECT name FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom(response)],
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<GradeRow>(
    teacherGradesQuery,
    [classId, userIdFrom(response)],
  );
  const filename = classInfo.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "kelas";
  response
    .set("Content-Type", "text/csv; charset=utf-8")
    .set("Content-Disposition", `attachment; filename="nilai-${filename}.csv"`)
    .set("Cache-Control", "private, no-store")
    .send(csvRows(rows.map(toGradeItem)));
});

teacherRouter.get("/classes/:classId/grades/export.xlsx", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows: classes } = await pool.query<QueryResultRow & { name: string }>(
    `SELECT name FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom(response)],
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<GradeRow>(
    teacherGradesQuery,
    [classId, userIdFrom(response)],
  );
  const filename = classInfo.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "kelas";
  const workbook = await createExcelWorkbook(
    "Nilai",
    gradeExportHeaders,
    gradeExportRows(rows.map(toGradeItem)),
  );
  response
    .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .set("Content-Disposition", `attachment; filename="nilai-${filename}.xlsx"`)
    .set("Cache-Control", "private, no-store")
    .send(workbook);
});

teacherRouter.get("/classes/:classId/grades", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows: classes } = await pool.query<QueryResultRow & { id: string; name: string }>(
    `SELECT id, name FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom(response)],
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<GradeRow>(
    teacherGradesQuery,
    [classId, userIdFrom(response)],
  );
  const { rows: activityRows } = await pool.query<QueryResultRow & {
    student_id: string;
    full_name: string;
    nisn: string;
    present_count: number;
    marked_count: number;
    attendance_percent: number | null;
    assignment_completed: number;
    assignment_count: number;
    game_average: string | null;
    game_passed: number;
    game_count: number;
  }>(
    `SELECT s.user_id AS student_id, s.full_name, s.nisn,
            attendance.present_count, attendance.marked_count,
            CASE WHEN attendance.marked_count = 0 THEN NULL
                 ELSE ROUND(attendance.present_count * 100.0 / attendance.marked_count)::integer
            END AS attendance_percent,
            assignments.completed_count AS assignment_completed,
            assignments.total_count AS assignment_count,
            games.average_score AS game_average,
            games.passed_count AS game_passed,
            games.total_count AS game_count
     FROM class_students cs
     JOIN students s ON s.user_id = cs.student_id
     JOIN classes c ON c.id = cs.class_id
     LEFT JOIN LATERAL (
       SELECT COUNT(ar.student_id)::integer AS marked_count,
              COUNT(ar.student_id) FILTER (WHERE ar.status = 'PRESENT')::integer AS present_count
       FROM attendance_sessions ats
       LEFT JOIN attendance_records ar
         ON ar.attendance_session_id = ats.id AND ar.student_id = s.user_id
       WHERE ats.class_id = c.id
     ) attendance ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::integer AS total_count,
              COUNT(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM assignment_submissions submission
                  WHERE submission.assignment_id = a.id AND submission.student_id = s.user_id
                )
              )::integer AS completed_count
       FROM assignments a
       WHERE a.class_id = c.id AND a.is_active = TRUE
     ) assignments ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::integer AS total_count,
              COUNT(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM learning_game_attempts passed_attempt
                  WHERE passed_attempt.learning_game_id = lg.id
                    AND passed_attempt.student_id = s.user_id AND passed_attempt.passed = TRUE
                )
              )::integer AS passed_count,
              ROUND(AVG(latest.score * 100.0 / NULLIF(latest.max_score, 0)), 1) AS average_score
       FROM learning_games lg
       JOIN module_contents mc ON mc.id = lg.module_content_id AND mc.is_active = TRUE
       JOIN modules m ON m.id = mc.module_id AND m.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT attempt.score, attempt.max_score
         FROM learning_game_attempts attempt
         WHERE attempt.learning_game_id = lg.id AND attempt.student_id = s.user_id
         ORDER BY attempt.submitted_at DESC, attempt.id DESC
         LIMIT 1
       ) latest ON TRUE
       WHERE m.class_id = c.id AND lg.is_active = TRUE
         AND jsonb_array_length(lg.configuration->'questions') > 0
     ) games ON TRUE
     WHERE cs.class_id = $1 AND cs.is_active = TRUE
       AND c.teacher_id = $2 AND c.is_active = TRUE
     ORDER BY s.full_name, s.nisn`,
    [classId, userIdFrom(response)],
  );
  response.json({
    class: classInfo,
    grades: rows.map(toGradeItem),
    studentActivity: activityRows.map((row) => ({
      studentId: row.student_id,
      fullName: row.full_name,
      nisn: row.nisn.trim(),
      attendancePercent: row.attendance_percent,
      presentCount: row.present_count,
      markedCount: row.marked_count,
      assignmentsCompleted: row.assignment_completed,
      assignmentsTotal: row.assignment_count,
      gameAverage: row.game_average === null ? null : Number(row.game_average),
      gamesPassed: row.game_passed,
      gamesTotal: row.game_count,
    })),
  });
});

studentRouter.get("/classes/:classId/grades", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  const { rows: classes } = await pool.query<QueryResultRow & { id: string; name: string }>(
    `SELECT c.id, c.name FROM classes c
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE c.id = $1 AND c.is_active = TRUE`,
    [classId, studentId],
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string;
    activity_type: "ASSIGNMENT" | "ASSESSMENT";
    title: string;
    score: string | null;
    max_score: string | null;
    feedback: string | null;
    graded_at: Date | null;
    submitted_at: Date | null;
    status: string;
    attempt_number: number;
  }>(
    `SELECT 'ASSIGNMENT-' || s.id::text AS id,
            g.score::text AS score, g.max_score::text AS max_score,
            g.feedback, g.graded_at, s.submitted_at, s.status,
            s.attempt_number, 'ASSIGNMENT'::text AS activity_type, a.title
     FROM assignment_submissions s
     LEFT JOIN grades g ON g.assignment_submission_id = s.id
       AND s.student_id = g.student_id
     JOIN assignments a ON a.id = s.assignment_id
     WHERE s.student_id = $1 AND a.class_id = $2 AND a.is_active = TRUE
     UNION ALL
     SELECT 'ASSESSMENT-' || aa.id::text AS id,
            g.score::text, g.max_score::text, g.feedback, g.graded_at,
            aa.submitted_at, aa.status, aa.attempt_number,
            'ASSESSMENT'::text, a.title
     FROM assessment_attempts aa
     LEFT JOIN grades g ON g.assessment_attempt_id = aa.id
       AND aa.student_id = g.student_id
     JOIN assessments a ON a.id = aa.assessment_id
     WHERE aa.student_id = $1 AND a.class_id = $2 AND a.is_active = TRUE
     ORDER BY graded_at DESC NULLS LAST, submitted_at DESC`,
    [studentId, classId],
  );
  const grades = rows.map((row) => ({
    id: row.id,
    type: row.activity_type,
    title: row.title,
    score: row.score === null ? null : Number(row.score),
    maxScore: row.max_score === null ? null : Number(row.max_score),
    feedback: row.feedback,
    gradedAt: row.graded_at,
    submittedAt: row.submitted_at,
    status: row.status,
    attemptNumber: row.attempt_number,
  }));
  const percentScores = grades.map((grade) => grade.score !== null && grade.maxScore !== null && grade.maxScore > 0
    ? (grade.score / grade.maxScore) * 100
    : null).filter((value): value is number => value !== null);
  const gradedItems = grades.filter((grade) => grade.score !== null).length;
  response.json({
    class: classInfo,
    summary: {
      gradedItems,
      pendingItems: grades.length - gradedItems,
      averagePercent: percentScores.length === 0
        ? null
        : Math.round(percentScores.reduce((total, score) => total + score, 0) / percentScores.length),
    },
    grades,
  });
});

export { studentRouter as studentGradesRouter, teacherRouter as teacherGradesRouter };
