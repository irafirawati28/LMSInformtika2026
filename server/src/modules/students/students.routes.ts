import { Router, type Request, type Response } from "express";
import { Readable } from "node:stream";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import multer from "multer";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import {
  createPrivateUploadTarget,
  deletePrivateFile,
  isPrivateFileOwnedBy,
  isPrivateSupabaseStorageEnabled,
  readPrivateFile,
} from "../../shared/private-storage.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";

type StudentDirectoryRow = QueryResultRow & {
  id: string;
  nisn: string;
  full_name: string;
  class_count: number | string;
  class_names: string;
  required_activities: number | string;
  completed_activities: number | string;
};

const router = Router();
router.use(requireTeacher);

const studentImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    if (![".csv", ".xlsx"].includes(file.originalname.slice(file.originalname.lastIndexOf(".")).toLowerCase())) {
      callback(new Error("Gunakan file Excel (.xlsx) atau CSV (.csv)."));
      return;
    }
    callback(null, true);
  },
});

const teacherIdFrom = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const parseNewStudent = (body: unknown):
  | { nisn: string; fullName: string; classId: string }
  | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value.nisn !== "string" ||
    typeof value.fullName !== "string" ||
    typeof value.classId !== "string"
  ) return null;
  const nisn = value.nisn.trim();
  const fullName = value.fullName.trim();
  const classId = value.classId;
  if (
    !/^\d{10}$/.test(nisn) ||
    fullName.length < 2 ||
    fullName.length > 150 ||
    !/^[1-9]\d{0,18}$/.test(classId)
  ) return null;
  return { nisn, fullName, classId };
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error &&
  error.code === "23505";

const parsePage = (value: unknown, fallback: number): number | null => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

type StudentImportRow = {
  row: number;
  nisn: string;
  fullName: string;
};

type StudentImportError = {
  row: number;
  nisn: string;
  error: string;
};

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return "";
  if (value instanceof Date) return "";
  if (typeof value !== "object") return "";
  if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  return "";
};

const parseStudentSheet = async (
  file: Pick<Express.Multer.File, "originalname" | "buffer">,
): Promise<{ rows: StudentImportRow[]; errors: StudentImportError[] }> => {
  const workbook = new ExcelJS.Workbook();
  const isCsv = file.originalname.toLowerCase().endsWith(".csv");
  if (isCsv) {
    await workbook.csv.read(Readable.from([file.buffer]));
  } else {
    await workbook.xlsx.read(Readable.from([file.buffer]));
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    throw new Error("File tidak berisi daftar siswa.");
  }

  const header = worksheet.getRow(1);
  const columns = new Map<string, number>();
  header.eachCell((cell, column) => {
    const key = cellText(cell.value).replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z]/g, "");
    if (key) columns.set(key, column);
  });
  const nisnColumn = columns.get("nisn");
  const nameColumn = columns.get("nama") ?? columns.get("namalengkap") ?? columns.get("fullname");
  if (!nisnColumn || !nameColumn) {
    throw new Error("Kolom wajib tidak ditemukan. Gunakan judul kolom NISN dan Nama Lengkap.");
  }

  const rows: StudentImportRow[] = [];
  const errors: StudentImportError[] = [];
  const seenNisn = new Set<string>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let nisn = cellText(row.getCell(nisnColumn).value);
    const rawNisn = nisn;
    if (/^\d{1,10}$/.test(nisn)) nisn = nisn.padStart(10, "0");
    const fullName = cellText(row.getCell(nameColumn).value);
    if (!nisn && !fullName) continue;

    let error = "";
    if (!/^\d{10}$/.test(nisn)) {
      error = "NISN harus terdiri dari 10 digit.";
    } else if (fullName.length < 2 || fullName.length > 150) {
      error = "Nama lengkap harus terdiri dari 2 sampai 150 karakter.";
    } else if (seenNisn.has(nisn)) {
      error = "NISN tercantum lebih dari sekali dalam file.";
    }

    if (error) {
      errors.push({ row: rowNumber, nisn: rawNisn, error });
      continue;
    }
    seenNisn.add(nisn);
    rows.push({ row: rowNumber, nisn, fullName });
  }
  return { rows, errors };
};

const handleStudentImportUpload = (
  request: Request,
  response: Response,
  next: (error?: unknown) => void,
): void => {
  studentImportUpload.single("file")(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE"
          ? "Ukuran file maksimal 5 MB."
          : "File tidak dapat diproses.",
      });
      return;
    }
    if (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "File tidak dapat diproses.",
      });
      return;
    }
    next();
  });
};

router.get("/template.csv", (_request, response) => {
  response
    .set("Content-Type", "text/csv; charset=utf-8")
    .set("Content-Disposition", 'attachment; filename="template-daftar-siswa.csv"')
    .send("\uFEFFNISN,Nama Lengkap\r\n");
});

router.post("/import/upload-url", async (request, response) => {
  if (!isPrivateSupabaseStorageEnabled()) {
    response.json({ mode: "local" });
    return;
  }
  const classId = request.body?.classId;
  const fileName = typeof request.body?.fileName === "string" ? request.body.fileName : "";
  const fileSize = request.body?.fileSize;
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (
    typeof classId !== "string" || !/^[1-9]\d{0,18}$/.test(classId) ||
    ![".csv", ".xlsx"].includes(extension) ||
    typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 5 * 1024 * 1024
  ) {
    response.status(400).json({ error: "File atau kelas impor tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, teacherIdFrom(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const target = await createPrivateUploadTarget("imports", teacherIdFrom(response), extension);
  if (!target) {
    response.status(503).json({ error: "Penyimpanan file belum dikonfigurasi." });
    return;
  }
  response.json({ mode: "direct", ...target });
});

router.post("/import", handleStudentImportUpload, async (request: Request, response: Response) => {
  const uploadedKey = typeof request.body?.fileKey === "string" ? request.body.fileKey : "";
  let remoteFileKey: string | null = null;
  let file: Pick<Express.Multer.File, "originalname" | "buffer"> | null = request.file ?? null;
  if (!file && uploadedKey && isPrivateFileOwnedBy("imports", teacherIdFrom(response), uploadedKey)) {
    try {
      file = {
        originalname: uploadedKey.split("/").at(-1) ?? "",
        buffer: await readPrivateFile("imports", uploadedKey),
      };
      remoteFileKey = uploadedKey;
    } catch {
      await deletePrivateFile("imports", uploadedKey).catch(() => undefined);
    }
  }
  const removeTemporaryUpload = async () => {
    if (remoteFileKey) await deletePrivateFile("imports", remoteFileKey).catch(() => undefined);
  };
  if (!file) {
    response.status(400).json({ error: "Pilih file Excel (.xlsx) atau CSV (.csv)." });
    return;
  }
  const classId = request.body?.classId;
  if (typeof classId !== "string" || !/^[1-9]\d{0,18}$/.test(classId)) {
    await removeTemporaryUpload();
    response.status(400).json({ error: "Pilih kelas yang valid." });
    return;
  }

  let parsed: Awaited<ReturnType<typeof parseStudentSheet>>;
  try {
    parsed = await parseStudentSheet(file);
  } catch {
    await removeTemporaryUpload();
    response.status(400).json({
      error: "File tidak dapat dibaca. Pastikan formatnya benar dan berisi kolom NISN serta Nama Lengkap.",
    });
    return;
  }
  await removeTemporaryUpload();
  if (parsed.rows.length + parsed.errors.length > 500) {
    response.status(400).json({ error: "File maksimal berisi 500 baris siswa." });
    return;
  }
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    response.status(400).json({ error: "File tidak berisi baris siswa untuk diimpor." });
    return;
  }

  const errors = [...parsed.errors];
  if (parsed.rows.length === 0) {
    response.json({ imported: 0, skipped: errors.length, errors });
    return;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount: classCount } = await client.query(
      "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE FOR SHARE",
      [classId, teacherIdFrom(response)],
    );
    if (classCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }

    const passwordHash = await bcrypt.hash("12345", 12);
    let imported = 0;
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const student = parsed.rows[index];
      if (!student) continue;
      const savepoint = `student_import_${index}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const { rows: users } = await client.query<QueryResultRow & { id: string }>(
          `INSERT INTO users (username, password_hash, role, must_change_password)
           VALUES ($1, $2, 'STUDENT', TRUE)
           RETURNING id`,
          [student.nisn, passwordHash],
        );
        const studentId = users[0]?.id;
        if (!studentId) throw new Error("Database tidak mengembalikan ID akun siswa.");
        await client.query(
          "INSERT INTO students (user_id, nisn, full_name) VALUES ($1, $2, $3)",
          [studentId, student.nisn, student.fullName],
        );
        await client.query(
          "INSERT INTO class_students (class_id, student_id) VALUES ($1, $2)",
          [classId, studentId],
        );
        await client.query(
          `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
           VALUES ($1, 'STUDENT_ACCOUNT_CREATED', 'STUDENT', $2, $3::jsonb)`,
          [teacherIdFrom(response), studentId, JSON.stringify({ classId, source: "bulk_import" })],
        );
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        imported += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        errors.push({
          row: student.row,
          nisn: student.nisn,
          error: "NISN sudah terdaftar; akun siswa tidak dibuat ulang.",
        });
      }
    }
    await client.query("COMMIT");
    response.json({ imported, skipped: errors.length, errors });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/", async (request: Request, response: Response) => {
  const input = parseNewStudent(request.body);
  if (!input) {
    response.status(400).json({ error: "NISN, nama siswa, atau kelas tidak valid." });
    return;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount: classCount } = await client.query(
      "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE FOR SHARE",
      [input.classId, teacherIdFrom(response)],
    );
    if (classCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }

    const passwordHash = await bcrypt.hash("12345", 12);
    const { rows: users } = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO users (username, password_hash, role, must_change_password)
       VALUES ($1, $2, 'STUDENT', TRUE)
       RETURNING id`,
      [input.nisn, passwordHash],
    );
    const studentId = users[0]?.id;
    if (!studentId) throw new Error("Database tidak mengembalikan ID akun siswa.");

    await client.query(
      "INSERT INTO students (user_id, nisn, full_name) VALUES ($1, $2, $3)",
      [studentId, input.nisn, input.fullName],
    );
    await client.query(
      "INSERT INTO class_students (class_id, student_id) VALUES ($1, $2)",
      [input.classId, studentId],
    );
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'STUDENT_ACCOUNT_CREATED', 'STUDENT', $2, $3::jsonb)`,
      [teacherIdFrom(response), studentId, JSON.stringify({ classId: input.classId })],
    );
    await client.query("COMMIT");
    response.status(201).json({
      id: studentId,
      message: "Akun siswa dibuat dan didaftarkan ke kelas. Password awal harus diganti saat login pertama.",
      initialPassword: "12345",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      response.status(409).json({ error: "Akun dengan NISN tersebut sudah terdaftar." });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

router.post("/:studentId/reset-password", async (request: Request, response: Response) => {
  const studentId = typeof request.params.studentId === "string" &&
    /^[1-9]\d{0,18}$/.test(request.params.studentId)
    ? request.params.studentId
    : null;
  if (!studentId) {
    response.status(400).json({ error: "ID siswa tidak valid." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & { nisn: string }>(
      `SELECT s.nisn
       FROM students s
       JOIN users u ON u.id = s.user_id AND u.is_active = TRUE
       WHERE s.user_id = $1 AND EXISTS (
         SELECT 1 FROM class_students cs
         JOIN classes c ON c.id = cs.class_id
         WHERE cs.student_id = s.user_id AND cs.is_active = TRUE
           AND c.teacher_id = $2 AND c.is_active = TRUE
       )
       FOR UPDATE OF u`,
      [studentId, teacherIdFrom(response)],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Siswa tidak ditemukan pada kelas aktif yang kamu ajar." });
      return;
    }

    const passwordHash = await bcrypt.hash("12345", 12);
    await client.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = TRUE, auth_version = auth_version + 1
       WHERE id = $2`,
      [passwordHash, studentId],
    );
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'STUDENT_PASSWORD_RESET', 'STUDENT', $2, '{}'::jsonb)`,
      [teacherIdFrom(response), studentId],
    );
    await client.query("COMMIT");
    response.json({
      message: "Password siswa berhasil direset. Siswa wajib menggantinya saat login.",
      initialPassword: "12345",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/", async (request: Request, response: Response) => {
  const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
  const page = parsePage(request.query.page, 1);
  const pageSize = parsePage(request.query.pageSize, 25);
  if (
    search.length > 100 ||
    page === null || page < 1 ||
    pageSize === null || pageSize < 1 || pageSize > 100
  ) {
    response.status(400).json({ error: "Parameter pencarian atau halaman tidak valid." });
    return;
  }

  const teacherId = teacherIdFrom(response);
  const [countResult, studentResult] = await Promise.all([
    pool.query<QueryResultRow & { total: number | string }>(
      `SELECT COUNT(DISTINCT s.user_id)::integer AS total
       FROM students s
       JOIN users u ON u.id = s.user_id AND u.is_active = TRUE
       JOIN class_students cs ON cs.student_id = s.user_id AND cs.is_active = TRUE
       JOIN classes c ON c.id = cs.class_id AND c.teacher_id = $1 AND c.is_active = TRUE
       WHERE ($2 = '' OR POSITION(LOWER($2) IN LOWER(s.full_name)) > 0
              OR POSITION($2 IN s.nisn) > 0)`,
      [teacherId, search],
    ),
    pool.query<StudentDirectoryRow>(
      `WITH visible_students AS (
         SELECT s.user_id AS id, s.nisn, s.full_name,
                COUNT(DISTINCT c.id)::integer AS class_count,
                STRING_AGG(DISTINCT c.name, ', ' ORDER BY c.name) AS class_names
         FROM students s
         JOIN users u ON u.id = s.user_id AND u.is_active = TRUE
         JOIN class_students cs ON cs.student_id = s.user_id AND cs.is_active = TRUE
         JOIN classes c ON c.id = cs.class_id AND c.teacher_id = $1 AND c.is_active = TRUE
         WHERE ($2 = '' OR POSITION(LOWER($2) IN LOWER(s.full_name)) > 0
                OR POSITION($2 IN s.nisn) > 0)
         GROUP BY s.user_id, s.nisn, s.full_name
       )
       SELECT student.id, student.nisn, student.full_name,
              student.class_count, student.class_names,
              progress.required_activities, progress.completed_activities
       FROM visible_students student
       CROSS JOIN LATERAL (
         SELECT
           (
             (SELECT COUNT(*) FROM modules m
              JOIN classes c ON c.id = m.class_id
              JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = student.id AND cs.is_active = TRUE
              WHERE c.teacher_id = $1 AND c.is_active = TRUE AND m.is_active = TRUE AND m.is_required = TRUE)
             +
             (SELECT COUNT(*) FROM assignments a
              JOIN classes c ON c.id = a.class_id
              JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = student.id AND cs.is_active = TRUE
              WHERE c.teacher_id = $1 AND c.is_active = TRUE AND a.is_active = TRUE AND a.is_required = TRUE)
             +
             (SELECT COUNT(*) FROM assessments assessment
              JOIN classes c ON c.id = assessment.class_id
              JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = student.id AND cs.is_active = TRUE
              WHERE c.teacher_id = $1 AND c.is_active = TRUE
                AND assessment.is_active = TRUE AND assessment.is_required = TRUE)
           )::integer AS required_activities,
           (
             (SELECT COUNT(*) FROM student_module_progress smp
              JOIN modules m ON m.id = smp.module_id AND m.is_active = TRUE AND m.is_required = TRUE
              JOIN classes c ON c.id = m.class_id AND c.teacher_id = $1 AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = student.id AND cs.is_active = TRUE
              WHERE smp.student_id = student.id AND smp.status = 'COMPLETED')
             +
             (SELECT COUNT(DISTINCT a.id) FROM assignments a
              JOIN classes c ON c.id = a.class_id AND c.teacher_id = $1 AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = student.id AND cs.is_active = TRUE
              JOIN assignment_submissions sub ON sub.assignment_id = a.id AND sub.student_id = student.id
              WHERE a.is_active = TRUE AND a.is_required = TRUE)
             +
             (SELECT COUNT(DISTINCT assessment.id) FROM assessments assessment
              JOIN classes c ON c.id = assessment.class_id AND c.teacher_id = $1 AND c.is_active = TRUE
              JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = student.id AND cs.is_active = TRUE
              JOIN assessment_attempts aa
                ON aa.assessment_id = assessment.id AND aa.student_id = student.id
                AND aa.status IN ('SUBMITTED', 'GRADED')
              WHERE assessment.is_active = TRUE AND assessment.is_required = TRUE)
           )::integer AS completed_activities
       ) progress
       ORDER BY student.full_name, student.nisn, student.id
       LIMIT $3 OFFSET $4`,
      [teacherId, search, pageSize, (page - 1) * pageSize],
    ),
  ]);

  response.json({
    students: studentResult.rows.map((row) => {
      const requiredActivities = Number(row.required_activities);
      const completedActivities = Number(row.completed_activities);
      return {
        id: row.id,
        nisn: row.nisn.trim(),
        fullName: row.full_name,
        classes: row.class_names,
        classCount: Number(row.class_count),
        requiredActivities,
        completedActivities,
        progressPercent: requiredActivities === 0
          ? 0
          : Math.round((completedActivities / requiredActivities) * 100),
      };
    }),
    pagination: {
      page,
      pageSize,
      total: Number(countResult.rows[0]?.total ?? 0),
      pageCount: Math.ceil(Number(countResult.rows[0]?.total ?? 0) / pageSize),
    },
  });
});

export { router as studentsRouter };
