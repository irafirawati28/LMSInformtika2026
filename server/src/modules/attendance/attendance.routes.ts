import { Router, type Response } from "express";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import { requireStudent } from "../../middleware/require-student.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";

type AttendanceStatus = "PRESENT" | "PERMISSION" | "SICK" | "ABSENT";
type AttendanceInput = { studentId: string; status: AttendanceStatus; notes: string | null };

const statuses = new Set<AttendanceStatus>(["PRESENT", "PERMISSION", "SICK", "ABSENT"]);
const teacherRouter = Router();
const studentRouter = Router();
teacherRouter.use(requireTeacher);
studentRouter.use(requireStudent);

const idFrom = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;

const userIdFrom = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const parseSessionDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
};

const parseAttendance = (value: unknown): AttendanceInput[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null;
  const seen = new Set<string>();
  const records: AttendanceInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const studentId = idFrom(item.studentId);
    if (
      !studentId ||
      typeof item.status !== "string" ||
      !statuses.has(item.status as AttendanceStatus) ||
      (item.notes !== undefined && item.notes !== null && typeof item.notes !== "string") ||
      (typeof item.notes === "string" && item.notes.trim().length > 500)
    ) return null;
    if (seen.has(studentId)) return null;
    seen.add(studentId);
    records.push({
      studentId,
      status: item.status as AttendanceStatus,
      notes: typeof item.notes === "string" ? item.notes.trim() || null : null,
    });
  }
  return records;
};

const ensureTeacherClass = async (
  client: Pick<PoolClient, "query">,
  classId: string,
  teacherId: string,
): Promise<boolean> => {
  const { rowCount } = await client.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, teacherId],
  );
  return rowCount === 1;
};

teacherRouter.get("/classes/:classId/attendance-sessions", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const teacherId = userIdFrom(response);
  const { rowCount } = await pool.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, teacherId],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string;
    session_date: string;
    title: string | null;
    notes: string | null;
    student_count: number;
    marked_count: number;
  }>(
    `SELECT ats.id, ats.session_date::text, ats.title, ats.notes,
            (SELECT COUNT(*)::integer FROM class_students cs
             WHERE cs.class_id = ats.class_id AND cs.is_active = TRUE) AS student_count,
            (SELECT COUNT(*)::integer FROM attendance_records ar
             WHERE ar.attendance_session_id = ats.id) AS marked_count
     FROM attendance_sessions ats
     WHERE ats.class_id = $1
     ORDER BY ats.session_date DESC, ats.id DESC`,
    [classId],
  );
  response.json({ sessions: rows.map((row) => ({
    id: row.id,
    date: row.session_date,
    title: row.title,
    notes: row.notes,
    studentCount: row.student_count,
    markedCount: row.marked_count,
  })) });
});

teacherRouter.post("/classes/:classId/attendance-sessions", async (request, response) => {
  const classId = idFrom(request.params.classId);
  const sessionDate = parseSessionDate(request.body?.date);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() || null : null;
  const notes = typeof request.body?.notes === "string" ? request.body.notes.trim() || null : null;
  if (
    !classId || !sessionDate ||
    (request.body?.title !== undefined && request.body?.title !== null && typeof request.body.title !== "string") ||
    (request.body?.notes !== undefined && request.body?.notes !== null && typeof request.body.notes !== "string") ||
    (title !== null && title.length > 180) ||
    (notes !== null && notes.length > 5000)
  ) {
    response.status(400).json({ error: "Tanggal, judul, atau catatan sesi tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await ensureTeacherClass(client, classId, userIdFrom(response))) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
    const { rows } = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO attendance_sessions (class_id, created_by, session_date, title, notes)
       VALUES ($1, $2, $3::date, $4, $5)
       ON CONFLICT (class_id, session_date) DO NOTHING
       RETURNING id`,
      [classId, userIdFrom(response), sessionDate, title, notes],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Sesi absensi untuk kelas pada tanggal tersebut sudah ada." });
      return;
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'ATTENDANCE_SESSION_CREATED', 'ATTENDANCE_SESSION', $2)`,
      [userIdFrom(response), rows[0].id],
    );
    await client.query("COMMIT");
    response.status(201).json({ id: rows[0].id, date: sessionDate });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.get("/attendance-sessions/:sessionId", async (request, response) => {
  const sessionId = idFrom(request.params.sessionId);
  if (!sessionId) {
    response.status(400).json({ error: "ID sesi absensi tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    class_id: string;
    session_date: string;
    title: string | null;
    notes: string | null;
  }>(
    `SELECT ats.class_id, ats.session_date::text, ats.title, ats.notes
     FROM attendance_sessions ats JOIN classes c ON c.id = ats.class_id
     WHERE ats.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE`,
    [sessionId, userIdFrom(response)],
  );
  const session = rows[0];
  if (!session) {
    response.status(404).json({ error: "Sesi absensi tidak ditemukan." });
    return;
  }
  const { rows: students } = await pool.query<QueryResultRow & {
    id: string; nisn: string; full_name: string; status: AttendanceStatus | null; record_notes: string | null;
  }>(
    `SELECT s.user_id AS id, s.nisn, s.full_name, ar.status, ar.notes AS record_notes
     FROM class_students cs JOIN students s ON s.user_id = cs.student_id
     LEFT JOIN attendance_records ar
       ON ar.attendance_session_id = $2 AND ar.student_id = s.user_id
     WHERE cs.class_id = $1 AND cs.is_active = TRUE
     ORDER BY s.full_name`,
    [session.class_id, sessionId],
  );
  response.json({
    session: {
      id: sessionId,
      classId: session.class_id,
      date: session.session_date,
      title: session.title,
      notes: session.notes,
    },
    students: students.map((student) => ({
      id: student.id,
      nisn: student.nisn.trim(),
      fullName: student.full_name,
      status: student.status,
      notes: student.record_notes,
    })),
  });
});

teacherRouter.put("/attendance-sessions/:sessionId/records", async (request, response) => {
  const sessionId = idFrom(request.params.sessionId);
  const records = parseAttendance(request.body?.records);
  if (!sessionId || !records) {
    response.status(400).json({ error: "Data kehadiran tidak valid atau terdapat siswa duplikat." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & { class_id: string }>(
      `SELECT ats.class_id
       FROM attendance_sessions ats JOIN classes c ON c.id = ats.class_id
       WHERE ats.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE
       FOR UPDATE OF ats`,
      [sessionId, userIdFrom(response)],
    );
    const attendanceSession = rows[0];
    if (!attendanceSession) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Sesi absensi tidak ditemukan." });
      return;
    }
    const { rows: roster } = await client.query<QueryResultRow & { id: string }>(
      "SELECT student_id AS id FROM class_students WHERE class_id = $1 AND is_active = TRUE",
      [attendanceSession.class_id],
    );
    const rosterIds = new Set(roster.map((student) => student.id));
    if (records.some((record) => !rosterIds.has(record.studentId))) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "Daftar berisi siswa yang tidak terdaftar aktif di kelas ini." });
      return;
    }
    for (const record of records) {
      await client.query(
        `INSERT INTO attendance_records (attendance_session_id, student_id, status, notes, marked_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (attendance_session_id, student_id) DO UPDATE
         SET status = EXCLUDED.status, notes = EXCLUDED.notes, marked_at = CURRENT_TIMESTAMP`,
        [sessionId, record.studentId, record.status, record.notes],
      );
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'ATTENDANCE_RECORDED', 'ATTENDANCE_SESSION', $2, $3::jsonb)`,
      [userIdFrom(response), sessionId, JSON.stringify({ updatedCount: records.length })],
    );
    await client.query("COMMIT");
    response.json({ updatedCount: records.length });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

studentRouter.get("/classes/:classId/attendance", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  const { rows: classes } = await pool.query<QueryResultRow & {
    id: string; name: string; subject: string; teacher: string;
  }>(
    `SELECT c.id, c.name, sub.name AS subject, t.full_name AS teacher
     FROM classes c
     JOIN subjects sub ON sub.id = c.subject_id
     JOIN teachers t ON t.user_id = c.teacher_id
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
    id: string; session_date: string; title: string | null; status: AttendanceStatus | null;
    notes: string | null; marked_at: Date | null;
  }>(
    `SELECT ats.id, ats.session_date::text, ats.title, ar.status, ar.notes, ar.marked_at
     FROM attendance_sessions ats
     LEFT JOIN attendance_records ar
       ON ar.attendance_session_id = ats.id AND ar.student_id = $2
     WHERE ats.class_id = $1
     ORDER BY ats.session_date DESC, ats.id DESC`,
    [classId, studentId],
  );
  const total = rows.filter((row) => row.status !== null).length;
  const present = rows.filter((row) => row.status === "PRESENT").length;
  const permission = rows.filter((row) => row.status === "PERMISSION").length;
  const sick = rows.filter((row) => row.status === "SICK").length;
  const absent = rows.filter((row) => row.status === "ABSENT").length;
  response.json({
    class: classInfo,
    summary: {
      totalSessions: rows.length,
      markedSessions: total,
      present,
      permission,
      sick,
      absent,
      attendanceRate: total === 0 ? 0 : Math.round((present / total) * 100),
    },
    records: rows.map((row) => ({
      sessionId: row.id,
      date: row.session_date,
      title: row.title,
      status: row.status,
      notes: row.notes,
      markedAt: row.marked_at,
    })),
  });
});

export { studentRouter as studentAttendanceRouter, teacherRouter as teacherAttendanceRouter };
