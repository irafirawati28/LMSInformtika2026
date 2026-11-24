import { Router, type Response } from "express";
import type { QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";
import { createExcelWorkbook } from "../../shared/excel-workbook.js";

type ReportClassRow = QueryResultRow & {
  id: string;
  name: string;
  subject: string;
  academic_year: string;
  semester: "ODD" | "EVEN";
};

type StudentReportRow = QueryResultRow & {
  id: string;
  nisn: string;
  full_name: string;
  required_modules: string | number;
  completed_modules: string | number;
  pending_review_modules: string | number;
  required_assignments: string | number;
  completed_assignments: string | number;
  pending_review_assignments: string | number;
  overdue_assignments: string | number;
  required_assessments: string | number;
  completed_assessments: string | number;
  pending_review_assessments: string | number;
  overdue_assessments: string | number;
  marked_attendance: string | number;
  present_attendance: string | number;
  graded_items: string | number;
  average_grade_percent: string | number | null;
  scored_games: string | number;
  average_game_percent: string | number | null;
};

type StudentReport = {
  id: string;
  nisn: string;
  fullName: string;
  requiredActivities: number;
  completedActivities: number;
  progressPercent: number;
  completed: boolean;
  status: "NO_REQUIREMENTS" | "COMPLETED" | "PENDING_REVIEW" | "OVERDUE" | "INCOMPLETE";
  pendingReviews: number;
  overdueActivities: number;
  requiredModules: number;
  completedModules: number;
  pendingReviewModules: number;
  requiredAssignments: number;
  completedAssignments: number;
  pendingReviewAssignments: number;
  overdueAssignments: number;
  requiredAssessments: number;
  completedAssessments: number;
  pendingReviewAssessments: number;
  overdueAssessments: number;
  markedAttendance: number;
  presentAttendance: number;
  attendancePercent: number | null;
  gradedItems: number;
  averageGradePercent: number | null;
  scoredGames: number;
  averageGamePercent: number | null;
};

const router = Router();
router.use(requireTeacher);

const idFrom = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;

const teacherIdFrom = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const reportQuery = `
  SELECT s.user_id AS id, s.nisn, s.full_name,
         modules.required_modules, modules.completed_modules, modules.pending_review_modules,
         assignments.required_assignments, assignments.completed_assignments,
         assignments.pending_review_assignments, assignments.overdue_assignments,
         assessments.required_assessments, assessments.completed_assessments,
         assessments.pending_review_assessments, assessments.overdue_assessments,
         attendance.marked_attendance, attendance.present_attendance,
         grades.graded_items, grades.average_grade_percent,
         games.scored_games, games.average_game_percent
  FROM classes c
  JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
  JOIN students s ON s.user_id = cs.student_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS required_modules,
           COUNT(*) FILTER (WHERE smp.status = 'COMPLETED')::integer AS completed_modules,
           COUNT(*) FILTER (WHERE smp.status = 'PENDING_REVIEW')::integer AS pending_review_modules
    FROM modules m
    LEFT JOIN student_module_progress smp
      ON smp.module_id = m.id AND smp.student_id = s.user_id
    WHERE m.class_id = c.id AND m.is_active = TRUE AND m.is_required = TRUE
  ) modules ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS required_assignments,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM assignment_submissions sub
               WHERE sub.assignment_id = a.id AND sub.student_id = s.user_id
             )
           )::integer AS completed_assignments,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1
               FROM assignment_submissions sub
               WHERE sub.assignment_id = a.id AND sub.student_id = s.user_id
                 AND sub.status IN ('SUBMITTED', 'LATE')
                 AND NOT EXISTS (
                   SELECT 1 FROM grades g
                   WHERE g.assignment_submission_id = sub.id
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM assignment_submissions later
                   WHERE later.assignment_id = sub.assignment_id
                     AND later.student_id = sub.student_id
                     AND later.attempt_number > sub.attempt_number
                 )
             )
           )::integer AS pending_review_assignments,
           COUNT(*) FILTER (
             WHERE (
               a.due_at < CURRENT_TIMESTAMP
               AND NOT EXISTS (
                 SELECT 1 FROM assignment_submissions sub
                 WHERE sub.assignment_id = a.id AND sub.student_id = s.user_id
               )
             ) OR EXISTS (
               SELECT 1
               FROM assignment_submissions sub
               WHERE sub.assignment_id = a.id AND sub.student_id = s.user_id
                 AND sub.status = 'LATE'
                 AND NOT EXISTS (
                   SELECT 1 FROM assignment_submissions later
                   WHERE later.assignment_id = sub.assignment_id
                     AND later.student_id = sub.student_id
                     AND later.attempt_number > sub.attempt_number
                 )
             )
           )::integer AS overdue_assignments
    FROM assignments a
    WHERE a.class_id = c.id AND a.is_active = TRUE AND a.is_required = TRUE
  ) assignments ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS required_assessments,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM assessment_attempts aa
               WHERE aa.assessment_id = assessment.id AND aa.student_id = s.user_id
                 AND aa.status IN ('SUBMITTED', 'GRADED')
             )
           )::integer AS completed_assessments,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM assessment_attempts aa
               WHERE aa.assessment_id = assessment.id AND aa.student_id = s.user_id
                 AND aa.status = 'SUBMITTED'
             )
           )::integer AS pending_review_assessments,
           COUNT(*) FILTER (
             WHERE assessment.due_at < CURRENT_TIMESTAMP
               AND NOT EXISTS (
                 SELECT 1 FROM assessment_attempts aa
                 WHERE aa.assessment_id = assessment.id AND aa.student_id = s.user_id
                   AND aa.status IN ('SUBMITTED', 'GRADED')
               )
           )::integer AS overdue_assessments
    FROM assessments assessment
    WHERE assessment.class_id = c.id
      AND assessment.is_active = TRUE AND assessment.is_required = TRUE
  ) assessments ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(ar.student_id)::integer AS marked_attendance,
           COUNT(*) FILTER (WHERE ar.status = 'PRESENT')::integer AS present_attendance
    FROM attendance_sessions ats
    LEFT JOIN attendance_records ar
      ON ar.attendance_session_id = ats.id AND ar.student_id = s.user_id
    WHERE ats.class_id = c.id
  ) attendance ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS graded_items,
           ROUND(AVG((item.score / NULLIF(item.max_score, 0)) * 100), 1) AS average_grade_percent
    FROM (
      SELECT g.score, g.max_score
      FROM grades g
      JOIN assignment_submissions sub ON sub.id = g.assignment_submission_id
        AND sub.student_id = g.student_id
      JOIN assignments a ON a.id = sub.assignment_id
      WHERE g.student_id = s.user_id AND a.class_id = c.id AND a.is_active = TRUE
      UNION ALL
      SELECT g.score, g.max_score
      FROM grades g
      JOIN assessment_attempts aa ON aa.id = g.assessment_attempt_id
        AND aa.student_id = g.student_id
      JOIN assessments assessment ON assessment.id = aa.assessment_id
      WHERE g.student_id = s.user_id
        AND assessment.class_id = c.id AND assessment.is_active = TRUE
    ) item
  ) grades ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(latest.score)::integer AS scored_games,
           ROUND(AVG(latest.score * 100.0 / NULLIF(latest.max_score, 0)), 1) AS average_game_percent
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
  WHERE c.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE
  ORDER BY s.full_name, s.nisn
`;

const mapStudent = (row: StudentReportRow): StudentReport => {
  const requiredModules = Number(row.required_modules);
  const completedModules = Number(row.completed_modules);
  const pendingReviewModules = Number(row.pending_review_modules);
  const requiredAssignments = Number(row.required_assignments);
  const completedAssignments = Number(row.completed_assignments);
  const pendingReviewAssignments = Number(row.pending_review_assignments);
  const overdueAssignments = Number(row.overdue_assignments);
  const requiredAssessments = Number(row.required_assessments);
  const completedAssessments = Number(row.completed_assessments);
  const pendingReviewAssessments = Number(row.pending_review_assessments);
  const overdueAssessments = Number(row.overdue_assessments);
  const requiredActivities = requiredModules + requiredAssignments + requiredAssessments;
  const completedActivities = completedModules + completedAssignments + completedAssessments;
  const pendingReviews = pendingReviewModules + pendingReviewAssignments + pendingReviewAssessments;
  const overdueActivities = overdueAssignments + overdueAssessments;
  const completed = requiredActivities > 0 &&
    completedActivities === requiredActivities &&
    pendingReviews === 0 &&
    overdueActivities === 0;
  const status = requiredActivities === 0
    ? "NO_REQUIREMENTS"
    : overdueActivities > 0
      ? "OVERDUE"
      : pendingReviews > 0
        ? "PENDING_REVIEW"
        : completedActivities === requiredActivities
          ? "COMPLETED"
          : "INCOMPLETE";
  const markedAttendance = Number(row.marked_attendance);
  const presentAttendance = Number(row.present_attendance);

  return {
    id: row.id,
    nisn: row.nisn.trim(),
    fullName: row.full_name,
    requiredActivities,
    completedActivities,
    progressPercent: requiredActivities === 0
      ? 0
      : Math.round((completedActivities / requiredActivities) * 100),
    completed,
    status,
    pendingReviews,
    overdueActivities,
    requiredModules,
    completedModules,
    pendingReviewModules,
    requiredAssignments,
    completedAssignments,
    pendingReviewAssignments,
    overdueAssignments,
    requiredAssessments,
    completedAssessments,
    pendingReviewAssessments,
    overdueAssessments,
    markedAttendance,
    presentAttendance,
    attendancePercent: markedAttendance === 0
      ? null
      : Math.round((presentAttendance / markedAttendance) * 100),
    gradedItems: Number(row.graded_items),
    averageGradePercent: row.average_grade_percent === null
      ? null
      : Number(row.average_grade_percent),
    scoredGames: Number(row.scored_games),
    averageGamePercent: row.average_game_percent === null
      ? null
      : Number(row.average_game_percent),
  };
};

const escapeCsv = (value: unknown): string => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

const reportExportHeaders = [
    "NISN", "Nama siswa", "Progres wajib (%)", "Aktivitas selesai",
    "Aktivitas wajib", "Modul selesai", "Modul wajib", "Tugas terkumpul",
    "Tugas wajib", "Menunggu penilaian", "Terlambat", "Asesmen selesai", "Asesmen wajib", "Kehadiran (%)",
    "Hadir", "Absensi tercatat", "Rata-rata nilai (%)", "Jumlah nilai", "Rata-rata game (%)", "Game dinilai",
    "Status penyelesaian",
];

const reportExportRows = (students: StudentReport[]) => students.map((student) => [
    student.nisn,
    student.fullName,
    student.progressPercent,
    student.completedActivities,
    student.requiredActivities,
    student.completedModules,
    student.requiredModules,
    student.completedAssignments,
    student.requiredAssignments,
    student.pendingReviews,
    student.overdueActivities,
    student.completedAssessments,
    student.requiredAssessments,
    student.attendancePercent,
    student.presentAttendance,
    student.markedAttendance,
    student.averageGradePercent,
    student.gradedItems,
    student.averageGamePercent,
    student.scoredGames,
    student.status === "NO_REQUIREMENTS"
      ? "Belum ada aktivitas wajib"
      : student.status === "COMPLETED"
        ? "Selesai"
        : student.status === "PENDING_REVIEW"
          ? "Menunggu penilaian"
          : student.status === "OVERDUE"
            ? "Terlambat"
            : "Belum memenuhi ketentuan",
]);

const toCsv = (students: StudentReport[]): string => {
  const rows = reportExportRows(students);
  return `\uFEFFsep=;\r\n${[reportExportHeaders, ...rows]
    .map((row) => row.map(escapeCsv).join(";"))
    .join("\r\n")}`;
};

const loadReport = async (classId: string, teacherId: string) => {
  const { rows: classes } = await pool.query<ReportClassRow>(
    `SELECT c.id, c.name, sub.name AS subject, c.academic_year, c.semester
     FROM classes c
     JOIN subjects sub ON sub.id = c.subject_id
     WHERE c.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE`,
    [classId, teacherId],
  );
  const classInfo = classes[0];
  if (!classInfo) return null;

  const { rows } = await pool.query<StudentReportRow>(reportQuery, [classId, teacherId]);
  const students = rows.map(mapStudent);
  const studentsWithGrades = students.filter((student) => student.averageGradePercent !== null);
  const scoredGames = students.reduce((total, student) => total + student.scoredGames, 0);
  const gradedItems = students.reduce((total, student) => total + student.gradedItems, 0);
  const markedAttendance = students.reduce((total, student) => total + student.markedAttendance, 0);
  const presentAttendance = students.reduce((total, student) => total + student.presentAttendance, 0);
  const requiredActivities = students.reduce((total, student) => total + student.requiredActivities, 0);
  const completedActivities = students.reduce((total, student) => total + student.completedActivities, 0);
  const summary = {
    studentCount: students.length,
    completedStudents: students.filter((student) => student.completed).length,
    incompleteStudents: students.filter(
      (student) => student.requiredActivities > 0 && !student.completed,
    ).length,
    studentsWithoutRequiredActivities: students.filter(
      (student) => student.requiredActivities === 0,
    ).length,
    pendingReviewStudents: students.filter((student) => student.status === "PENDING_REVIEW").length,
    overdueStudents: students.filter((student) => student.status === "OVERDUE").length,
    averageProgress: requiredActivities === 0
      ? 0
      : Math.round((completedActivities / requiredActivities) * 100),
    averageGradePercent: studentsWithGrades.length === 0
      ? null
      : Math.round(
          students.reduce(
            (total, student) =>
              total + (student.averageGradePercent ?? 0) * student.gradedItems,
            0,
          ) / gradedItems,
        ),
    averageGamePercent: scoredGames === 0
      ? null
      : Math.round(
          students.reduce(
            (total, student) =>
              total + (student.averageGamePercent ?? 0) * student.scoredGames,
            0,
          ) / scoredGames,
        ),
    attendancePercent: markedAttendance === 0
      ? null
      : Math.round((presentAttendance / markedAttendance) * 100),
  };

  return {
    class: {
      id: classInfo.id,
      name: classInfo.name,
      subject: classInfo.subject,
      academicYear: classInfo.academic_year,
      semester: classInfo.semester,
    },
    summary,
    students,
  };
};

router.get("/classes/:classId/report/export.csv", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const report = await loadReport(classId, teacherIdFrom(response));
  if (!report) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const filename = report.class.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "kelas";
  response
    .set("Content-Type", "text/csv; charset=utf-8")
    .set("Content-Disposition", `attachment; filename="laporan-${filename}.csv"`)
    .set("Cache-Control", "private, no-store")
    .send(toCsv(report.students));
});

router.get("/classes/:classId/report/export.xlsx", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const report = await loadReport(classId, teacherIdFrom(response));
  if (!report) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const filename = report.class.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "kelas";
  const workbook = await createExcelWorkbook(
    "Laporan",
    reportExportHeaders,
    reportExportRows(report.students),
  );
  response
    .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .set("Content-Disposition", `attachment; filename="laporan-${filename}.xlsx"`)
    .set("Cache-Control", "private, no-store")
    .send(workbook);
});

router.get("/classes/:classId/report", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const report = await loadReport(classId, teacherIdFrom(response));
  if (!report) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  response.json(report);
});

export { router as reportsRouter };
