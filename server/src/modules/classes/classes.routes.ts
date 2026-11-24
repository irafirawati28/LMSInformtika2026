import { Router, type Request, type Response } from "express";
import type { QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";

type ClassRow = QueryResultRow & {
  id: string;
  name: string;
  academic_year: string;
  semester: "ODD" | "EVEN";
  description: string | null;
  subject: string;
  student_count: number | string;
  module_count: number | string;
  assignment_count: number | string;
  assessment_count: number | string;
  created_at: Date;
};

type StudentProgressRow = QueryResultRow & {
  id: string;
  nisn: string;
  full_name: string;
  required_count: number | string;
  completed_count: number | string;
  required_modules: number | string;
  completed_modules: number | string;
};

const router = Router();
router.use(requireTeacher);

const getTeacherId = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const parseId = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;

const parseClassFields = (body: unknown):
  | {
      name: string;
      subject: string;
      academicYear: string;
      semester: "ODD" | "EVEN";
      description: string | null;
    }
  | null => {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value.name !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.academicYear !== "string" ||
    (value.semester !== "ODD" && value.semester !== "EVEN") ||
    (value.description !== undefined &&
      value.description !== null &&
      typeof value.description !== "string")
  ) {
    return null;
  }

  const name = value.name.trim();
  const subject = value.subject.trim();
  const academicYear = value.academicYear.trim();
  const description =
    typeof value.description === "string" ? value.description.trim() || null : null;
  const [startYear, endYear] = academicYear.split("-").map(Number);

  if (
    name.length < 2 ||
    name.length > 120 ||
    subject.length < 2 ||
    subject.length > 120 ||
    !/^\d{4}-\d{4}$/.test(academicYear) ||
    endYear !== startYear + 1 ||
    (description !== null && description.length > 2000)
  ) {
    return null;
  }

  return {
    name,
    subject,
    academicYear,
    semester: value.semester,
    description,
  };
};

router.get("/", async (_request: Request, response: Response) => {
  const { rows } = await pool.query<ClassRow>(
    `SELECT c.id, c.name, c.academic_year, c.semester, c.description, c.created_at,
            sub.name AS subject,
            COUNT(DISTINCT cs.student_id) FILTER (WHERE cs.is_active = TRUE) AS student_count,
            COUNT(DISTINCT m.id) FILTER (WHERE m.is_active = TRUE) AS module_count,
            COUNT(DISTINCT a.id) FILTER (WHERE a.is_active = TRUE) AS assignment_count,
            COUNT(DISTINCT ass.id) FILTER (WHERE ass.is_active = TRUE) AS assessment_count
     FROM classes c
     JOIN subjects sub ON sub.id = c.subject_id
     LEFT JOIN class_students cs ON cs.class_id = c.id
     LEFT JOIN modules m ON m.class_id = c.id
     LEFT JOIN assignments a ON a.class_id = c.id
     LEFT JOIN assessments ass ON ass.class_id = c.id
     WHERE c.teacher_id = $1 AND c.is_active = TRUE
     GROUP BY c.id, sub.name
     ORDER BY c.academic_year DESC, c.name`,
    [getTeacherId(response)],
  );

  response.json({
    classes: rows.map((row) => ({
      id: row.id,
      name: row.name,
      subject: row.subject,
      academicYear: row.academic_year,
      semester: row.semester,
      description: row.description,
      studentCount: Number(row.student_count),
      moduleCount: Number(row.module_count),
      assignmentCount: Number(row.assignment_count),
      assessmentCount: Number(row.assessment_count),
    })),
  });
});

router.post("/", async (request: Request, response: Response) => {
  const fields = parseClassFields(request.body);
  if (!fields) {
    response.status(400).json({
      error: "Lengkapi nama kelas, mata pelajaran, tahun ajaran berurutan, semester, dan deskripsi yang valid.",
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const subjectResult = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO subjects (name)
       VALUES ($1)
       ON CONFLICT ((LOWER(name))) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [fields.subject],
    );
    const subjectId = subjectResult.rows[0]?.id;
    if (!subjectId) {
      throw new Error("Database tidak mengembalikan mata pelajaran.");
    }

    const classResult = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO classes (teacher_id, subject_id, name, academic_year, semester, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        getTeacherId(response),
        subjectId,
        fields.name,
        fields.academicYear,
        fields.semester,
        fields.description,
      ],
    );
    await client.query("COMMIT");
    response.status(201).json({ id: classResult.rows[0]?.id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/:classId/students", async (request: Request, response: Response) => {
  const classId = parseId(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }

  const { rows: classRows } = await pool.query<QueryResultRow & { id: string }>(
    "SELECT id FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, getTeacherId(response)],
  );
  if (classRows.length === 0) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }

  const { rows } = await pool.query<StudentProgressRow>(
    `SELECT s.user_id AS id, s.nisn, s.full_name,
            COALESCE(mp.required_modules, 0)
              + COALESCE(ap.required_assignments, 0)
              + COALESCE(ep.required_assessments, 0) AS required_count,
            COALESCE(mp.completed_modules, 0)
              + COALESCE(ap.completed_assignments, 0)
              + COALESCE(ep.completed_assessments, 0) AS completed_count,
            COALESCE(mp.required_modules, 0) AS required_modules,
            COALESCE(mp.completed_modules, 0) AS completed_modules
     FROM classes c
     JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
     JOIN students s ON s.user_id = cs.student_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS required_modules,
              COUNT(*) FILTER (WHERE smp.status = 'COMPLETED') AS completed_modules
       FROM modules m
       LEFT JOIN student_module_progress smp
         ON smp.module_id = m.id AND smp.student_id = s.user_id
       WHERE m.class_id = c.id AND m.is_active = TRUE AND m.is_required = TRUE
     ) mp ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS required_assignments,
              COUNT(*) FILTER (WHERE submission.id IS NOT NULL) AS completed_assignments
       FROM assignments a
       LEFT JOIN LATERAL (
         SELECT sub.id
         FROM assignment_submissions sub
         WHERE sub.assignment_id = a.id AND sub.student_id = s.user_id
         ORDER BY sub.submitted_at DESC
         LIMIT 1
       ) submission ON TRUE
       WHERE a.class_id = c.id AND a.is_active = TRUE AND a.is_required = TRUE
     ) ap ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS required_assessments,
              COUNT(*) FILTER (WHERE attempt.id IS NOT NULL) AS completed_assessments
       FROM assessments assessment
       LEFT JOIN LATERAL (
         SELECT aa.id
         FROM assessment_attempts aa
         WHERE aa.assessment_id = assessment.id AND aa.student_id = s.user_id
           AND aa.status IN ('SUBMITTED', 'GRADED')
         ORDER BY aa.submitted_at DESC NULLS LAST
         LIMIT 1
       ) attempt ON TRUE
       WHERE assessment.class_id = c.id AND assessment.is_active = TRUE
         AND assessment.is_required = TRUE
     ) ep ON TRUE
     WHERE c.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE
     ORDER BY s.full_name`,
    [classId, getTeacherId(response)],
  );

  response.json({
    students: rows.map((row) => {
      const required = Number(row.required_count);
      const completed = Number(row.completed_count);
      return {
        id: row.id,
        nisn: row.nisn.trim(),
        fullName: row.full_name,
        requiredModules: Number(row.required_modules),
        completedModules: Number(row.completed_modules),
        progress: required === 0 ? 0 : Math.round((completed / required) * 100),
        completed: required > 0 && completed === required,
      };
    }),
  });
});

router.put("/:classId", async (request: Request, response: Response) => {
  const classId = parseId(request.params.classId);
  const fields = parseClassFields(request.body);
  if (!classId || !fields) {
    response.status(400).json({ error: "ID atau data kelas tidak valid." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const subjectResult = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO subjects (name)
       VALUES ($1)
       ON CONFLICT ((LOWER(name))) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [fields.subject],
    );
    const subjectId = subjectResult.rows[0]?.id;
    if (!subjectId) {
      throw new Error("Database tidak mengembalikan mata pelajaran.");
    }
    const result = await client.query(
      `UPDATE classes
       SET name = $1, subject_id = $2, academic_year = $3, semester = $4, description = $5
       WHERE id = $6 AND teacher_id = $7 AND is_active = TRUE`,
      [
        fields.name,
        subjectId,
        fields.academicYear,
        fields.semester,
        fields.description,
        classId,
        getTeacherId(response),
      ],
    );
    if (result.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
    await client.query("COMMIT");
    response.json({ message: "Kelas berhasil diperbarui." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.delete("/:classId", async (request: Request, response: Response) => {
  const classId = parseId(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const result = await pool.query(
    `UPDATE classes SET is_active = FALSE
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, getTeacherId(response)],
  );
  if (result.rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  response.status(204).end();
});

router.post("/:classId/students", async (request: Request, response: Response) => {
  const classId = parseId(request.params.classId);
  const nisn =
    request.body && typeof request.body.nisn === "string"
      ? request.body.nisn.trim()
      : "";
  if (!classId || !/^\d{10}$/.test(nisn)) {
    response.status(400).json({ error: "ID kelas atau NISN tidak valid." });
    return;
  }

  const { rows: classes } = await pool.query(
    `SELECT id FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, getTeacherId(response)],
  );
  if (classes.length === 0) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }

  const { rows: students } = await pool.query<QueryResultRow & { user_id: string }>(
    `SELECT s.user_id
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.nisn = $1 AND u.is_active = TRUE`,
    [nisn],
  );
  const student = students[0];
  if (!student) {
    response.status(404).json({ error: "Siswa dengan NISN tersebut tidak ditemukan." });
    return;
  }

  const result = await pool.query(
    `INSERT INTO class_students (class_id, student_id)
     VALUES ($1, $2)
     ON CONFLICT (class_id, student_id)
     DO UPDATE SET is_active = TRUE, enrolled_at = CURRENT_TIMESTAMP
       WHERE class_students.is_active = FALSE
     RETURNING student_id`,
    [classId, student.user_id],
  );
  if (result.rowCount !== 1) {
    response.status(409).json({ error: "Siswa sudah terdaftar di kelas ini." });
    return;
  }

  response.status(201).json({ message: "Siswa berhasil ditambahkan ke kelas." });
});

router.delete(
  "/:classId/students/:studentId",
  async (request: Request, response: Response) => {
    const classId = parseId(request.params.classId);
    const studentId = parseId(request.params.studentId);
    if (!classId || !studentId) {
      response.status(400).json({ error: "ID kelas atau siswa tidak valid." });
      return;
    }
    const result = await pool.query(
      `UPDATE class_students cs
       SET is_active = FALSE
       FROM classes c
       WHERE cs.class_id = c.id AND cs.class_id = $1 AND cs.student_id = $2
         AND c.teacher_id = $3 AND c.is_active = TRUE AND cs.is_active = TRUE`,
      [classId, studentId, getTeacherId(response)],
    );
    if (result.rowCount !== 1) {
      response.status(404).json({ error: "Siswa tidak ditemukan di kelas tersebut." });
      return;
    }
    response.status(204).end();
  },
);

export { router as classesRouter };
