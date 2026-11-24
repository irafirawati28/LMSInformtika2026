import { Router } from "express";
import type { QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import { requireAuthenticated, type AuthenticatedUser } from "../../middleware/require-auth.js";

type TeacherOverviewRow = QueryResultRow & {
  total_students: number | string;
  total_classes: number | string;
  total_modules: number | string;
  total_assignments: number | string;
  completed_students: number | string;
  incomplete_students: number | string;
  present_records: number | string;
  total_attendance_records: number | string;
};

type ActivityRow = QueryResultRow & {
  id: string;
  event_type: string;
  full_name: string;
  created_at: Date;
};

type StudentClassRow = QueryResultRow & {
  id: string;
  name: string;
  subject: string;
  teacher_name: string;
  required_modules: number | string;
  completed_modules: number | string;
};

type DueAssignmentRow = QueryResultRow & {
  id: string;
  title: string;
  class_name: string;
  due_at: Date;
};

type StudentGradeRow = QueryResultRow & {
  id: string;
  title: string;
  score: number | string;
  max_score: number | string;
  graded_at: Date;
};

type AttendanceSummaryRow = QueryResultRow & {
  present_records: number | string;
  total_records: number | string;
};

type StudentProgressSummaryRow = QueryResultRow & {
  required_activities: number | string;
  completed_activities: number | string;
  outstanding_assignments: number | string;
};

const router = Router();

const toNumber = (value: number | string): number => Number(value);

router.get("/", requireAuthenticated, async (_request, response) => {
  const user = response.locals.authUser as AuthenticatedUser;

  if (user.role === "TEACHER") {
    const [overviewResult, gradeResult, activityResult] = await Promise.all([
      pool.query<TeacherOverviewRow>(
        `WITH class_roster AS (
           SELECT c.id AS class_id, cs.student_id
           FROM classes c
           JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
           WHERE c.teacher_id = $1 AND c.is_active = TRUE
         ),
         required_counts AS (
           SELECT c.id AS class_id,
             (SELECT COUNT(*) FROM modules m
              WHERE m.class_id = c.id AND m.is_active = TRUE AND m.is_required = TRUE) AS modules,
             (SELECT COUNT(*) FROM assignments a
              WHERE a.class_id = c.id AND a.is_active = TRUE AND a.is_required = TRUE) AS assignments,
             (SELECT COUNT(*) FROM assessments a
              WHERE a.class_id = c.id AND a.is_active = TRUE AND a.is_required = TRUE) AS assessments
           FROM classes c
           WHERE c.teacher_id = $1 AND c.is_active = TRUE
         ),
         module_completion AS (
           SELECT r.class_id, r.student_id,
             COUNT(m.id) FILTER (WHERE smp.status = 'COMPLETED') AS completed,
             COUNT(m.id) FILTER (WHERE smp.status = 'PENDING_REVIEW') AS pending
           FROM class_roster r
           LEFT JOIN modules m ON m.class_id = r.class_id
             AND m.is_active = TRUE AND m.is_required = TRUE
           LEFT JOIN student_module_progress smp
             ON smp.module_id = m.id AND smp.student_id = r.student_id
           GROUP BY r.class_id, r.student_id
         ),
         assignment_completion AS (
           SELECT r.class_id, r.student_id,
             COUNT(DISTINCT a.id) FILTER (WHERE sub.status IN ('SUBMITTED', 'GRADED')) AS completed,
             COUNT(DISTINCT a.id) FILTER (
               WHERE sub.status IN ('SUBMITTED', 'LATE')
                 AND g.assignment_submission_id IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM assignment_submissions later
                   WHERE later.assignment_id = sub.assignment_id
                     AND later.student_id = sub.student_id
                     AND later.attempt_number > sub.attempt_number
                 )
             ) AS pending
           FROM class_roster r
           LEFT JOIN assignments a ON a.class_id = r.class_id
             AND a.is_active = TRUE AND a.is_required = TRUE
           LEFT JOIN assignment_submissions sub
             ON sub.assignment_id = a.id AND sub.student_id = r.student_id
           LEFT JOIN grades g ON g.assignment_submission_id = sub.id
           GROUP BY r.class_id, r.student_id
         ),
         assessment_completion AS (
           SELECT r.class_id, r.student_id,
             COUNT(DISTINCT a.id) FILTER (WHERE aa.status IN ('SUBMITTED', 'GRADED')) AS completed,
             COUNT(DISTINCT a.id) FILTER (WHERE aa.status = 'SUBMITTED') AS pending
           FROM class_roster r
           LEFT JOIN assessments a ON a.class_id = r.class_id
             AND a.is_active = TRUE AND a.is_required = TRUE
           LEFT JOIN assessment_attempts aa
             ON aa.assessment_id = a.id AND aa.student_id = r.student_id
           GROUP BY r.class_id, r.student_id
         ),
         class_completion AS (
           SELECT r.student_id,
             (rc.modules + rc.assignments + rc.assessments > 0) AS has_required,
             (COALESCE(mc.completed, 0) = rc.modules
              AND COALESCE(ac.completed, 0) = rc.assignments
              AND COALESCE(ascm.completed, 0) = rc.assessments
              AND COALESCE(mc.pending, 0) = 0
              AND COALESCE(ac.pending, 0) = 0
              AND COALESCE(ascm.pending, 0) = 0) AS is_complete
           FROM class_roster r
           JOIN required_counts rc ON rc.class_id = r.class_id
           LEFT JOIN module_completion mc
             ON mc.class_id = r.class_id AND mc.student_id = r.student_id
           LEFT JOIN assignment_completion ac
             ON ac.class_id = r.class_id AND ac.student_id = r.student_id
           LEFT JOIN assessment_completion ascm
             ON ascm.class_id = r.class_id AND ascm.student_id = r.student_id
         ),
         student_completion AS (
           SELECT student_id,
                  BOOL_OR(has_required) AS has_required,
                  BOOL_AND(is_complete) FILTER (WHERE has_required) AS is_complete
           FROM class_completion
           GROUP BY student_id
         )
         SELECT
           (SELECT COUNT(DISTINCT cs.student_id)
            FROM classes c
            JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
            WHERE c.teacher_id = $2 AND c.is_active = TRUE) AS total_students,
           (SELECT COUNT(*) FROM classes c
            WHERE c.teacher_id = $3 AND c.is_active = TRUE) AS total_classes,
           (SELECT COUNT(*)
            FROM modules m JOIN classes c ON c.id = m.class_id
            WHERE c.teacher_id = $4 AND c.is_active = TRUE AND m.is_active = TRUE) AS total_modules,
           (SELECT COUNT(*)
            FROM assignments a JOIN classes c ON c.id = a.class_id
            WHERE c.teacher_id = $5 AND c.is_active = TRUE AND a.is_active = TRUE) AS total_assignments,
           (SELECT COUNT(*) FROM student_completion
            WHERE has_required = TRUE AND is_complete = TRUE) AS completed_students,
           (SELECT COUNT(*) FROM student_completion
            WHERE has_required = TRUE AND is_complete = FALSE) AS incomplete_students,
           (SELECT COUNT(*)
            FROM attendance_records ar
            JOIN attendance_sessions ats ON ats.id = ar.attendance_session_id
            JOIN classes c ON c.id = ats.class_id
            WHERE c.teacher_id = $6 AND c.is_active = TRUE) AS total_attendance_records,
           (SELECT COUNT(*)
            FROM attendance_records ar
            JOIN attendance_sessions ats ON ats.id = ar.attendance_session_id
            JOIN classes c ON c.id = ats.class_id
            WHERE c.teacher_id = $7 AND c.is_active = TRUE AND ar.status = 'PRESENT') AS present_records`,
        [user.id, user.id, user.id, user.id, user.id, user.id, user.id],
      ),
      pool.query<QueryResultRow & { month: string; average_score: number | string }>(
        `SELECT TO_CHAR(g.graded_at, 'YYYY-MM') AS month,
                ROUND(AVG((g.score / g.max_score) * 100), 1) AS average_score
         FROM grades g
         JOIN teachers t ON t.user_id = $1
         WHERE g.graded_at >= CURRENT_DATE - INTERVAL '6 months'
           AND (
             EXISTS (
               SELECT 1 FROM assignment_submissions sub
               JOIN assignments a ON a.id = sub.assignment_id
               JOIN classes c ON c.id = a.class_id
               WHERE sub.id = g.assignment_submission_id AND c.teacher_id = t.user_id
             )
             OR EXISTS (
               SELECT 1 FROM assessment_attempts aa
               JOIN assessments a ON a.id = aa.assessment_id
               JOIN classes c ON c.id = a.class_id
               WHERE aa.id = g.assessment_attempt_id AND c.teacher_id = t.user_id
             )
           )
         GROUP BY TO_CHAR(g.graded_at, 'YYYY-MM')
         ORDER BY month`,
        [user.id],
      ),
      pool.query<ActivityRow>(
        `SELECT al.id, al.event_type, s.full_name, al.created_at
         FROM activity_logs al
         JOIN students s ON s.user_id = al.user_id
         WHERE EXISTS (
           SELECT 1 FROM class_students cs
           JOIN classes c ON c.id = cs.class_id
           WHERE cs.student_id = al.user_id AND cs.is_active = TRUE
             AND c.teacher_id = $1 AND c.is_active = TRUE
         )
         ORDER BY al.created_at DESC
         LIMIT 8`,
        [user.id],
      ),
    ]);

    const overviewRows = overviewResult.rows;
    const gradeRows = gradeResult.rows;
    const activityRows = activityResult.rows;
    const overview = overviewRows[0];
    if (!overview) {
      throw new Error("Ringkasan dashboard guru tidak dapat dihitung.");
    }

    response.json({
      role: "TEACHER",
      summary: {
        students: toNumber(overview.total_students),
        classes: toNumber(overview.total_classes),
        modules: toNumber(overview.total_modules),
        assignments: toNumber(overview.total_assignments),
        completedStudents: toNumber(overview.completed_students),
        incompleteStudents: toNumber(overview.incomplete_students),
        attendanceRate:
          toNumber(overview.total_attendance_records) === 0
            ? 0
            : Math.round(
                (toNumber(overview.present_records) /
                  toNumber(overview.total_attendance_records)) *
                  100,
              ),
      },
      gradeTrend: gradeRows.map((row) => ({
        month: row.month,
        averageScore: toNumber(row.average_score),
      })),
      recentActivities: activityRows.map((activity) => ({
        id: activity.id,
        type: activity.event_type,
        name: activity.full_name,
        at: activity.created_at,
      })),
    });
    return;
  }

  const [
    classResult,
    assignmentResult,
    gradeResult,
    attendanceResult,
    activityResult,
    progressResult,
  ] = await Promise.all([
      pool.query<StudentClassRow>(
        `SELECT c.id, c.name, sub.name AS subject, t.full_name AS teacher_name,
                COUNT(DISTINCT CASE WHEN m.is_required = TRUE AND m.is_active = TRUE THEN m.id END) AS required_modules,
                COUNT(DISTINCT CASE WHEN m.is_required = TRUE AND m.is_active = TRUE
                                     AND smp.status = 'COMPLETED' THEN m.id END) AS completed_modules
         FROM class_students cs
         JOIN classes c ON c.id = cs.class_id AND c.is_active = TRUE
         JOIN subjects sub ON sub.id = c.subject_id
         JOIN teachers t ON t.user_id = c.teacher_id
         LEFT JOIN modules m ON m.class_id = c.id AND m.is_active = TRUE
         LEFT JOIN student_module_progress smp ON smp.module_id = m.id AND smp.student_id = cs.student_id
         WHERE cs.student_id = $1 AND cs.is_active = TRUE
         GROUP BY c.id, c.name, sub.name, t.full_name
         ORDER BY c.name`,
        [user.id],
      ),
      pool.query<DueAssignmentRow>(
        `SELECT a.id, a.title, c.name AS class_name, a.due_at
         FROM assignments a
         JOIN classes c ON c.id = a.class_id AND c.is_active = TRUE
         JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $1 AND cs.is_active = TRUE
         WHERE a.is_active = TRUE AND a.due_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM assignment_submissions sub
             WHERE sub.assignment_id = a.id AND sub.student_id = cs.student_id
           )
         ORDER BY a.due_at
         LIMIT 5`,
        [user.id],
      ),
      pool.query<StudentGradeRow>(
        `SELECT g.id, COALESCE(a.title, ass.title) AS title, g.score, g.max_score, g.graded_at
         FROM grades g
         LEFT JOIN assignment_submissions sub ON sub.id = g.assignment_submission_id
         LEFT JOIN assignments a ON a.id = sub.assignment_id
         LEFT JOIN assessment_attempts aa ON aa.id = g.assessment_attempt_id
         LEFT JOIN assessments ass ON ass.id = aa.assessment_id
         WHERE g.student_id = $1
         ORDER BY g.graded_at DESC
         LIMIT 5`,
        [user.id],
      ),
      pool.query<AttendanceSummaryRow>(
        `SELECT COUNT(DISTINCT CASE WHEN ar.status = 'PRESENT' THEN ats.id END) AS present_records,
                COUNT(DISTINCT ats.id) AS total_records
         FROM class_students cs
         JOIN classes c ON c.id = cs.class_id AND c.is_active = TRUE
         JOIN attendance_sessions ats ON ats.class_id = c.id
         LEFT JOIN attendance_records ar
           ON ar.attendance_session_id = ats.id AND ar.student_id = cs.student_id
         WHERE cs.student_id = $1 AND cs.is_active = TRUE`,
        [user.id],
      ),
      pool.query<ActivityRow>(
        `SELECT al.id, al.event_type, s.full_name, al.created_at
         FROM activity_logs al
         JOIN students s ON s.user_id = al.user_id
         WHERE al.user_id = $1
         ORDER BY al.created_at DESC
         LIMIT 8`,
        [user.id],
      ),
      pool.query<StudentProgressSummaryRow>(
        `SELECT
           (
             (SELECT COUNT(*) FROM modules m
              JOIN classes c ON c.id = m.class_id AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
              WHERE cs.student_id = $1 AND m.is_active = TRUE AND m.is_required = TRUE)
             +
             (SELECT COUNT(*) FROM assignments a
              JOIN classes c ON c.id = a.class_id AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
              WHERE cs.student_id = $2 AND a.is_active = TRUE AND a.is_required = TRUE)
             +
             (SELECT COUNT(*) FROM assessments a
              JOIN classes c ON c.id = a.class_id AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
              WHERE cs.student_id = $3 AND a.is_active = TRUE AND a.is_required = TRUE)
           ) AS required_activities,
           (
             (SELECT COUNT(*) FROM student_module_progress smp
              JOIN modules m ON m.id = smp.module_id AND m.is_active = TRUE AND m.is_required = TRUE
              JOIN classes c ON c.id = m.class_id AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
              WHERE smp.student_id = $4 AND smp.status = 'COMPLETED')
             +
             (SELECT COUNT(DISTINCT a.id) FROM assignments a
              JOIN classes c ON c.id = a.class_id AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
              JOIN assignment_submissions sub
                ON sub.assignment_id = a.id AND sub.student_id = cs.student_id
              WHERE cs.student_id = $5 AND a.is_active = TRUE AND a.is_required = TRUE)
             +
             (SELECT COUNT(DISTINCT a.id) FROM assessments a
              JOIN classes c ON c.id = a.class_id AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
              JOIN assessment_attempts aa
                ON aa.assessment_id = a.id AND aa.student_id = cs.student_id
                   AND aa.status IN ('SUBMITTED', 'GRADED')
              WHERE cs.student_id = $6 AND a.is_active = TRUE AND a.is_required = TRUE)
           ) AS completed_activities,
           (SELECT COUNT(*) FROM assignments a
            JOIN classes c ON c.id = a.class_id AND c.is_active = TRUE
            JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
            WHERE cs.student_id = $7 AND a.is_active = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM assignment_submissions sub
                WHERE sub.assignment_id = a.id AND sub.student_id = cs.student_id
              )) AS outstanding_assignments`,
        [user.id, user.id, user.id, user.id, user.id, user.id, user.id],
      ),
    ]);

  const classRows = classResult.rows;
  const assignmentRows = assignmentResult.rows;
  const gradeRows = gradeResult.rows;
  const attendanceRows = attendanceResult.rows;
  const activityRows = activityResult.rows;
  const progressRows = progressResult.rows;
  const attendance = attendanceRows[0];
  const progressSummary = progressRows[0];
  if (!progressSummary) {
    throw new Error("Ringkasan progres siswa tidak dapat dihitung.");
  }
  const requiredActivities = toNumber(progressSummary.required_activities);
  const completedActivities = toNumber(progressSummary.completed_activities);
  const outstandingAssignments = toNumber(progressSummary.outstanding_assignments);

  response.json({
    role: "STUDENT",
    summary: {
      classes: classRows.length,
      progress:
        requiredActivities === 0
          ? 0
          : Math.round((completedActivities / requiredActivities) * 100),
      outstandingAssignments,
      attendanceRate:
        !attendance || toNumber(attendance.total_records) === 0
          ? 0
          : Math.round(
              (toNumber(attendance.present_records) /
                toNumber(attendance.total_records)) *
                100,
            ),
    },
    classes: classRows.map((learningClass) => {
      const required = toNumber(learningClass.required_modules);
      const completed = toNumber(learningClass.completed_modules);
      return {
        id: learningClass.id,
        name: learningClass.name,
        subject: learningClass.subject,
        teacher: learningClass.teacher_name,
        progress: required === 0 ? 0 : Math.round((completed / required) * 100),
      };
    }),
    dueAssignments: assignmentRows.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      className: assignment.class_name,
      dueAt: assignment.due_at,
    })),
    latestGrades: gradeRows.map((grade) => ({
      id: grade.id,
      title: grade.title,
      score: toNumber(grade.score),
      maxScore: toNumber(grade.max_score),
      gradedAt: grade.graded_at,
    })),
    recentActivities: activityRows.map((activity) => ({
      id: activity.id,
      type: activity.event_type,
      at: activity.created_at,
    })),
  });
});

export { router as dashboardRouter };
