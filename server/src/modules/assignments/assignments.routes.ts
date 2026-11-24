import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import {
  createPrivateDownloadUrl,
  createPrivateUploadTarget,
  deletePrivateFile,
  isPrivateFileOwnedBy,
  isPrivateSupabaseStorageEnabled,
  readPrivateFile,
  writePrivateFile,
} from "../../shared/private-storage.js";
import { requireStudent } from "../../middleware/require-student.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";

type SubmissionType = "FILE" | "LINK" | "TEXT";
type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
type AssessmentQuestion = {
  type: QuestionType;
  prompt: string;
  options: Array<{ id: string; text: string }> | null;
  answerKey: string | boolean | null;
  points: number;
};

const teacherRouter = Router();
const studentRouter = Router();
teacherRouter.use(requireTeacher);
studentRouter.use(requireStudent);

const privateAssignmentStorage = resolve(process.cwd(), "storage/assignments");
const assignmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    if (![".pdf", ".docx", ".jpg", ".jpeg", ".png"].includes(extname(file.originalname).toLowerCase())) {
      callback(new Error("Format tugas tidak didukung. Gunakan PDF, DOCX, JPG, atau PNG."));
      return;
    }
    callback(null, true);
  },
});

const idFrom = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;

const userIdFrom = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const dateFrom = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
};

const assignmentSubmissionType = (value: unknown): SubmissionType | null =>
  value === "FILE" || value === "LINK" || value === "TEXT" ? value : null;

const parseQuestions = (value: unknown): AssessmentQuestion[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const questions: AssessmentQuestion[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const type = item.type;
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    const points = item.points === undefined ? 1 : item.points;
    if (
      !["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"].includes(String(type)) ||
      prompt.length < 3 || prompt.length > 2000 ||
      typeof points !== "number" || !Number.isFinite(points) || points <= 0 || points > 100
    ) return null;

    let options: AssessmentQuestion["options"] = null;
    let answerKey: AssessmentQuestion["answerKey"] = null;
    if (type === "MULTIPLE_CHOICE") {
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6) return null;
      options = [];
      const optionIds = new Set<string>();
      for (const option of item.options) {
        if (!option || typeof option !== "object") return null;
        const choice = option as Record<string, unknown>;
        if (
          typeof choice.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(choice.id) ||
          optionIds.has(choice.id) || typeof choice.text !== "string" ||
          choice.text.trim().length < 1 || choice.text.trim().length > 500
        ) return null;
        optionIds.add(choice.id);
        options.push({ id: choice.id, text: choice.text.trim() });
      }
      if (typeof item.answerKey !== "string" || !optionIds.has(item.answerKey)) return null;
      answerKey = item.answerKey;
    } else if (type === "TRUE_FALSE") {
      if (typeof item.answerKey !== "boolean") return null;
      options = [{ id: "true", text: "Benar" }, { id: "false", text: "Salah" }];
      answerKey = item.answerKey;
    } else if (type === "SHORT_ANSWER") {
      if (typeof item.answerKey !== "string" || !item.answerKey.trim() || item.answerKey.trim().length > 500) return null;
      answerKey = item.answerKey.trim();
    } else if (type !== "ESSAY") {
      return null;
    }

    questions.push({
      type: type as QuestionType,
      prompt,
      options,
      answerKey,
      points,
    });
    void index;
  }
  return questions;
};

const moduleIsUnlocked = async (
  client: Pick<PoolClient, "query">,
  moduleId: string,
  studentId: string,
): Promise<boolean> => {
  const { rows } = await client.query<QueryResultRow & { unlocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM modules current
       WHERE current.id = $1 AND current.is_active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = current.class_id AND previous.is_active = TRUE
             AND previous.position < current.position
             AND (
           EXISTS (
             SELECT 1 FROM module_contents mc
             WHERE mc.module_id = previous.id AND mc.is_active = TRUE AND mc.is_required = TRUE
               AND NOT EXISTS (
                 SELECT 1 FROM student_content_progress p
                 WHERE p.module_content_id = mc.id AND p.student_id = $2 AND p.status = 'COMPLETED'
               )
           )
           OR EXISTS (
             SELECT 1 FROM assignments a
             WHERE a.module_id = previous.id AND a.is_active = TRUE AND a.is_required = TRUE
               AND NOT EXISTS (
                 SELECT 1 FROM assignment_submissions s
                 WHERE s.assignment_id = a.id AND s.student_id = $2
               )
           )
           OR EXISTS (
             SELECT 1 FROM assessments a
             WHERE a.module_id = previous.id AND a.is_active = TRUE AND a.is_required = TRUE
               AND NOT EXISTS (
                 SELECT 1 FROM assessment_attempts attempt
                 WHERE attempt.assessment_id = a.id AND attempt.student_id = $2
                   AND attempt.status IN ('SUBMITTED', 'GRADED')
               )
           )
           )
         )
     ) AS unlocked`,
    [moduleId, studentId],
  );
  return rows[0]?.unlocked === true;
};

const refreshModuleProgress = async (client: PoolClient, moduleId: string): Promise<void> => {
  await client.query(
    `WITH totals AS (
       SELECT cs.student_id, m.id AS module_id,
         ((SELECT COUNT(*) FROM module_contents mc
           WHERE mc.module_id = m.id AND mc.is_active = TRUE AND mc.is_required = TRUE)
          + (SELECT COUNT(*) FROM assignments a
             WHERE a.module_id = m.id AND a.is_active = TRUE AND a.is_required = TRUE)
          + (SELECT COUNT(*) FROM assessments a
             WHERE a.module_id = m.id AND a.is_active = TRUE AND a.is_required = TRUE))::integer AS required_count,
         ((SELECT COUNT(*) FROM module_contents mc
           JOIN student_content_progress scp ON scp.module_content_id = mc.id
             AND scp.student_id = cs.student_id AND scp.status = 'COMPLETED'
           WHERE mc.module_id = m.id AND mc.is_active = TRUE AND mc.is_required = TRUE)
          + (SELECT COUNT(*) FROM assignments a
             WHERE a.module_id = m.id AND a.is_active = TRUE AND a.is_required = TRUE
               AND EXISTS (SELECT 1 FROM assignment_submissions s
                           WHERE s.assignment_id = a.id AND s.student_id = cs.student_id))
          + (SELECT COUNT(*) FROM assessments a
             WHERE a.module_id = m.id AND a.is_active = TRUE AND a.is_required = TRUE
               AND EXISTS (SELECT 1 FROM assessment_attempts aa
                           WHERE aa.assessment_id = a.id AND aa.student_id = cs.student_id
                             AND aa.status IN ('SUBMITTED', 'GRADED'))))::integer AS completed_count
       FROM modules m JOIN class_students cs ON cs.class_id = m.class_id AND cs.is_active = TRUE
       WHERE m.id = $1
     )
     INSERT INTO student_module_progress
       (student_id, module_id, status, progress_percent, started_at, completed_at)
     SELECT student_id, module_id,
            CASE WHEN completed_count = required_count THEN 'COMPLETED'
                 WHEN completed_count > 0 THEN 'IN_PROGRESS' ELSE 'LOCKED' END,
            CASE WHEN required_count = 0 THEN 100
                 ELSE ROUND(completed_count * 100.0 / required_count)::smallint END,
            CASE WHEN completed_count > 0 THEN CURRENT_TIMESTAMP ELSE NULL END,
            CASE WHEN completed_count = required_count THEN CURRENT_TIMESTAMP ELSE NULL END
     FROM totals
     ON CONFLICT (student_id, module_id) DO UPDATE
     SET progress_percent = EXCLUDED.progress_percent,
         status = EXCLUDED.status,
         started_at = CASE WHEN EXCLUDED.progress_percent > 0
                           THEN COALESCE(student_module_progress.started_at, CURRENT_TIMESTAMP)
                           ELSE student_module_progress.started_at END,
         completed_at = CASE WHEN EXCLUDED.status = 'COMPLETED'
                             THEN COALESCE(student_module_progress.completed_at, CURRENT_TIMESTAMP)
                             ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP`,
    [moduleId],
  );
};

const ensureAssignmentDirectory = async (): Promise<void> => {
  await mkdir(privateAssignmentStorage, { recursive: true, mode: 0o700 });
  await chmod(privateAssignmentStorage, 0o700);
};

const validateSubmissionFile = (fileName: string, bytes: Buffer): string | null => {
  const extension = extname(fileName).toLowerCase();
  let containsWordDocument = false;
  if (extension === ".docx" && bytes.length >= 4 &&
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const searchStart = Math.max(0, bytes.length - 65_557);
    for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
      if (offset + 22 > bytes.length || bytes.readUInt32LE(offset) !== 0x06054b50) continue;
      const entries = bytes.readUInt16LE(offset + 10);
      let directoryOffset = bytes.readUInt32LE(offset + 16);
      for (let index = 0; index < entries; index += 1) {
        if (directoryOffset + 46 > bytes.length || bytes.readUInt32LE(directoryOffset) !== 0x02014b50) break;
        const nameLength = bytes.readUInt16LE(directoryOffset + 28);
        const extraLength = bytes.readUInt16LE(directoryOffset + 30);
        const commentLength = bytes.readUInt16LE(directoryOffset + 32);
        const nameEnd = directoryOffset + 46 + nameLength;
        if (nameEnd + extraLength + commentLength > bytes.length) break;
        if (bytes.toString("utf8", directoryOffset + 46, nameEnd) === "word/document.xml") {
          containsWordDocument = true;
          break;
        }
        directoryOffset = nameEnd + extraLength + commentLength;
      }
      break;
    }
  }
  const valid = extension === ".pdf"
    ? bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-"
    : extension === ".jpg" || extension === ".jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : extension === ".png"
        ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : extension === ".docx"
          ? containsWordDocument
          : false;
  return valid ? extension : null;
};

const handleUpload = (request: Request, response: Response, next: (error?: unknown) => void): void => {
  assignmentUpload.single("file")(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE" ? "Ukuran file maksimal 20 MB." : "File tidak dapat diproses.",
      });
      return;
    }
    if (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "File tidak dapat diproses." });
      return;
    }
    next();
  });
};

const sendSubmissionFile = async (response: Response, fileKey: string): Promise<void> => {
  const signedUrl = await createPrivateDownloadUrl("assignments", fileKey, true);
  if (signedUrl) {
    response.redirect(302, signedUrl);
    return;
  }
  let contents: Buffer;
  try {
    contents = await readPrivateFile("assignments", fileKey);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      response.status(404).json({ error: "File tugas tidak ditemukan di penyimpanan." });
      return;
    }
    throw error;
  }
  const mimeType: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  response
    .set("Content-Type", mimeType[extname(fileKey).toLowerCase()] ?? "application/octet-stream")
    .set("Content-Disposition", `attachment; filename="${fileKey}"`)
    .set("Content-Length", String(contents.length))
    .set("X-Content-Type-Options", "nosniff")
    .set("Cache-Control", "private, no-store")
    .send(contents);
};

teacherRouter.get("/classes/:classId/assignments", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    `SELECT 1 FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string; title: string; description: string | null; instructions: string | null;
    module_id: string | null; module_title: string | null; starts_at: Date | null;
    due_at: Date | null; weight: string; is_required: boolean; allow_late_submission: boolean;
    allow_revision: boolean; submission_type: SubmissionType; submission_count: number;
  }>(
    `SELECT a.id, a.title, a.description, a.instructions, a.module_id, m.title AS module_title,
            a.starts_at, a.due_at, a.weight, a.is_required, a.allow_late_submission,
            a.allow_revision, a.submission_type,
            (SELECT COUNT(*)::integer FROM assignment_submissions s
             WHERE s.assignment_id = a.id) AS submission_count
     FROM assignments a
     JOIN classes c ON c.id = a.class_id
     LEFT JOIN modules m ON m.id = a.module_id
     WHERE a.class_id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND a.is_active = TRUE
     ORDER BY a.due_at NULLS LAST, a.created_at DESC`,
    [classId, userIdFrom(response)],
  );
  response.json({ assignments: rows.map((row) => ({
    id: row.id, title: row.title, description: row.description, instructions: row.instructions,
    moduleId: row.module_id, moduleTitle: row.module_title, startsAt: row.starts_at,
    dueAt: row.due_at, weight: Number(row.weight), isRequired: row.is_required,
    allowLateSubmission: row.allow_late_submission, allowRevision: row.allow_revision,
    submissionType: row.submission_type, submissionCount: row.submission_count,
  })) });
});

teacherRouter.post("/classes/:classId/assignments", async (request, response) => {
  const classId = idFrom(request.params.classId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const instructions = typeof request.body?.instructions === "string" ? request.body.instructions.trim() || null : null;
  const moduleId = request.body?.moduleId === "" || request.body?.moduleId === null
    ? null
    : request.body?.moduleId === undefined ? null : idFrom(request.body.moduleId);
  const startsAt = dateFrom(request.body?.startsAt);
  const dueAt = dateFrom(request.body?.dueAt);
  const submissionType = assignmentSubmissionType(request.body?.submissionType);
  const weight = request.body?.weight === undefined ? 50 : request.body.weight;
  if (
    !classId || title.length < 2 || title.length > 180 ||
    (description !== null && description.length > 5000) ||
    (instructions !== null && instructions.length > 10000) ||
    (request.body?.moduleId !== undefined && request.body?.moduleId !== null && request.body?.moduleId !== "" && !moduleId) ||
    startsAt === undefined || dueAt === undefined ||
    (startsAt && dueAt && Date.parse(startsAt) > Date.parse(dueAt)) ||
    !submissionType || typeof weight !== "number" || !Number.isFinite(weight) || weight < 50 || weight > 100 ||
    (request.body?.isRequired !== undefined && typeof request.body.isRequired !== "boolean") ||
    (request.body?.allowLateSubmission !== undefined && typeof request.body.allowLateSubmission !== "boolean") ||
    (request.body?.allowRevision !== undefined && typeof request.body.allowRevision !== "boolean")
  ) {
    response.status(400).json({ error: "Data tugas tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<QueryResultRow & { id: string; module_id: string | null }>(
      `INSERT INTO assignments
         (class_id, module_id, title, description, instructions, starts_at, due_at, weight,
          is_required, allow_late_submission, allow_revision, submission_type)
       SELECT c.id, m.id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       FROM classes c
       LEFT JOIN modules m ON m.id = $2 AND m.class_id = c.id AND m.is_active = TRUE
       WHERE c.id = $1 AND c.teacher_id = $13 AND c.is_active = TRUE
         AND ($2::bigint IS NULL OR m.id IS NOT NULL)
       RETURNING id, module_id`,
      [
        classId, moduleId, title, description, instructions, startsAt, dueAt, weight,
        request.body.isRequired !== false, request.body.allowLateSubmission === true,
        request.body.allowRevision === true, submissionType, userIdFrom(response),
      ],
    );
    const assignment = result.rows[0];
    if (!assignment) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas atau modul tidak ditemukan." });
      return;
    }
    if (assignment.module_id && request.body.isRequired !== false) {
      await client.query(
        "INSERT INTO module_requirements (module_id, assignment_id) VALUES ($1, $2)",
        [assignment.module_id, assignment.id],
      );
      await refreshModuleProgress(client, assignment.module_id);
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'ASSIGNMENT_CREATED', 'ASSIGNMENT', $2)`,
      [userIdFrom(response), assignment.id],
    );
    await client.query("COMMIT");
    response.status(201).json({ id: assignment.id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.put("/assignments/:assignmentId", async (request, response) => {
  const assignmentId = idFrom(request.params.assignmentId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const instructions = typeof request.body?.instructions === "string" ? request.body.instructions.trim() || null : null;
  const moduleId = request.body?.moduleId === "" || request.body?.moduleId === null
    ? null
    : request.body?.moduleId === undefined ? null : idFrom(request.body.moduleId);
  const startsAt = dateFrom(request.body?.startsAt);
  const dueAt = dateFrom(request.body?.dueAt);
  const submissionType = assignmentSubmissionType(request.body?.submissionType);
  const weight = request.body?.weight;
  if (
    !assignmentId || title.length < 2 || title.length > 180 ||
    (description !== null && description.length > 5000) ||
    (instructions !== null && instructions.length > 10000) ||
    (request.body?.moduleId !== undefined && request.body?.moduleId !== null && request.body?.moduleId !== "" && !moduleId) ||
    startsAt === undefined || dueAt === undefined ||
    (startsAt && dueAt && Date.parse(startsAt) > Date.parse(dueAt)) ||
    !submissionType || typeof weight !== "number" || !Number.isFinite(weight) || weight < 50 || weight > 100 ||
    (request.body?.isRequired !== undefined && typeof request.body.isRequired !== "boolean") ||
    (request.body?.allowLateSubmission !== undefined && typeof request.body.allowLateSubmission !== "boolean") ||
    (request.body?.allowRevision !== undefined && typeof request.body.allowRevision !== "boolean")
  ) {
    response.status(400).json({ error: "Data tugas tidak valid." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existingRows } = await client.query<QueryResultRow & {
      class_id: string; module_id: string | null; submission_type: SubmissionType; has_submissions: boolean;
    }>(
      `SELECT a.class_id, a.module_id, a.submission_type,
              EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.assignment_id = a.id) AS has_submissions
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
       WHERE a.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND a.is_active = TRUE
       FOR UPDATE OF a`,
      [assignmentId, userIdFrom(response)],
    );
    const existing = existingRows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Tugas tidak ditemukan." });
      return;
    }
    if (existing.has_submissions && submissionType !== existing.submission_type) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "Jenis pengumpulan tidak dapat diubah setelah ada siswa yang mengumpulkan tugas." });
      return;
    }

    const { rows: updatedRows } = await client.query<QueryResultRow & { module_id: string | null }>(
      `UPDATE assignments a
       SET module_id = m.id, title = $3, description = $4, instructions = $5,
           starts_at = $6, due_at = $7, weight = $8, is_required = $9,
           allow_late_submission = $10, allow_revision = $11, submission_type = $12
       FROM classes c
       LEFT JOIN modules m ON m.id = $2 AND m.class_id = c.id AND m.is_active = TRUE
       WHERE a.id = $1 AND a.class_id = c.id AND c.teacher_id = $13 AND c.is_active = TRUE
         AND ($2::bigint IS NULL OR m.id IS NOT NULL)
       RETURNING a.module_id`,
      [
        assignmentId, moduleId, title, description, instructions, startsAt, dueAt, weight,
        request.body.isRequired !== false, request.body.allowLateSubmission === true,
        request.body.allowRevision === true, submissionType, userIdFrom(response),
      ],
    );
    const updated = updatedRows[0];
    if (!updated) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Modul tidak ditemukan di kelas ini." });
      return;
    }

    await client.query("DELETE FROM module_requirements WHERE assignment_id = $1", [assignmentId]);
    if (updated.module_id && request.body.isRequired !== false) {
      await client.query(
        "INSERT INTO module_requirements (module_id, assignment_id) VALUES ($1, $2)",
        [updated.module_id, assignmentId],
      );
    }
    for (const moduleToRefresh of new Set([existing.module_id, updated.module_id].filter((id): id is string => id !== null))) {
      await refreshModuleProgress(client, moduleToRefresh);
    }
    await client.query("COMMIT");
    response.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.delete("/assignments/:assignmentId", async (request, response) => {
  const assignmentId = idFrom(request.params.assignmentId);
  if (!assignmentId) {
    response.status(400).json({ error: "ID tugas tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & { module_id: string | null }>(
      `UPDATE assignments a SET is_active = FALSE
       FROM classes c
       WHERE a.id = $1 AND a.class_id = c.id AND c.teacher_id = $2
         AND c.is_active = TRUE AND a.is_active = TRUE
       RETURNING a.module_id`,
      [assignmentId, userIdFrom(response)],
    );
    const assignment = rows[0];
    if (!assignment) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Tugas tidak ditemukan." });
      return;
    }
    await client.query("DELETE FROM module_requirements WHERE assignment_id = $1", [assignmentId]);
    if (assignment.module_id) await refreshModuleProgress(client, assignment.module_id);
    await client.query("COMMIT");
    response.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.get("/assignments/:assignmentId/submissions", async (request, response) => {
  const assignmentId = idFrom(request.params.assignmentId);
  if (!assignmentId) {
    response.status(400).json({ error: "ID tugas tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string; student_id: string; full_name: string; nisn: string; submission_type: SubmissionType;
    file_key: string | null; external_url: string | null; response_text: string | null;
    status: string; submitted_at: Date; score: string | null; max_score: string | null;
    feedback: string | null;
  }>(
    `SELECT s.id, s.student_id, st.full_name, st.nisn, s.submission_type, s.file_key,
            s.external_url, s.response_text, s.status, s.submitted_at,
            g.score, g.max_score, g.feedback
     FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN classes c ON c.id = a.class_id
     JOIN students st ON st.user_id = s.student_id
     LEFT JOIN grades g ON g.assignment_submission_id = s.id
     WHERE s.assignment_id = $1 AND c.teacher_id = $2 AND a.is_active = TRUE
     ORDER BY s.submitted_at DESC`,
    [assignmentId, userIdFrom(response)],
  );
  const { rowCount } = await pool.query(
    `SELECT 1 FROM assignments a JOIN classes c ON c.id = a.class_id
     WHERE a.id = $1 AND c.teacher_id = $2`,
    [assignmentId, userIdFrom(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Tugas tidak ditemukan." });
    return;
  }
  response.json({ submissions: rows.map((row) => ({
    id: row.id, studentId: row.student_id, fullName: row.full_name, nisn: row.nisn.trim(),
    type: row.submission_type, fileUrl: row.file_key ? `/api/assignment-submissions/${row.id}/file` : null,
    link: row.external_url, text: row.response_text, status: row.status,
    submittedAt: row.submitted_at, score: row.score === null ? null : Number(row.score),
    maxScore: row.max_score === null ? null : Number(row.max_score), feedback: row.feedback,
  })) });
});

teacherRouter.put("/assignment-submissions/:submissionId/grade", async (request, response) => {
  const submissionId = idFrom(request.params.submissionId);
  const score = request.body?.score;
  const maxScore = request.body?.maxScore;
  const feedback = typeof request.body?.feedback === "string" ? request.body.feedback.trim() || null : null;
  if (
    !submissionId || typeof score !== "number" || !Number.isFinite(score) ||
    typeof maxScore !== "number" || !Number.isFinite(maxScore) ||
    score < 0 || maxScore <= 0 || score > maxScore ||
    (feedback !== null && feedback.length > 5000)
  ) {
    response.status(400).json({ error: "Nilai atau umpan balik tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & { student_id: string; submission_id: string; module_id: string | null }>(
      `SELECT s.student_id, s.id AS submission_id, a.module_id
       FROM assignment_submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN classes c ON c.id = a.class_id
       WHERE s.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE`,
      [submissionId, userIdFrom(response)],
    );
    const submission = rows[0];
    if (!submission) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Pengumpulan tugas tidak ditemukan." });
      return;
    }
    await client.query(
      `UPDATE assignment_submissions SET status = 'GRADED' WHERE id = $1`,
      [submissionId],
    );
    await client.query(
      `INSERT INTO grades
         (student_id, assignment_submission_id, graded_by, score, max_score, feedback)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (assignment_submission_id) DO UPDATE
       SET graded_by = EXCLUDED.graded_by, score = EXCLUDED.score,
           max_score = EXCLUDED.max_score, feedback = EXCLUDED.feedback, graded_at = CURRENT_TIMESTAMP`,
      [submission.student_id, submissionId, userIdFrom(response), score, maxScore, feedback],
    );
    if (submission.module_id) await refreshModuleProgress(client, submission.module_id);
    await client.query("COMMIT");
    response.json({ message: "Nilai tugas tersimpan." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.get("/classes/:classId/assessments", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    `SELECT 1 FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string; title: string; description: string | null; module_id: string | null;
    module_title: string | null; starts_at: Date | null; due_at: Date | null;
    max_attempts: number; pass_score: string | null; is_required: boolean;
    question_count: number; attempt_count: number;
  }>(
    `SELECT a.id, a.title, a.description, a.module_id, m.title AS module_title,
            a.starts_at, a.due_at, a.max_attempts, a.pass_score, a.is_required,
            (SELECT COUNT(*)::integer FROM questions q WHERE q.assessment_id = a.id) AS question_count,
            (SELECT COUNT(*)::integer FROM assessment_attempts aa WHERE aa.assessment_id = a.id) AS attempt_count
     FROM assessments a JOIN classes c ON c.id = a.class_id
     LEFT JOIN modules m ON m.id = a.module_id
     WHERE a.class_id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND a.is_active = TRUE
     ORDER BY a.due_at NULLS LAST, a.created_at DESC`,
    [classId, userIdFrom(response)],
  );
  response.json({ assessments: rows.map((row) => ({
    id: row.id, title: row.title, description: row.description,
    moduleId: row.module_id, moduleTitle: row.module_title, startsAt: row.starts_at,
    dueAt: row.due_at, maxAttempts: row.max_attempts,
    passScore: row.pass_score === null ? null : Number(row.pass_score),
    isRequired: row.is_required, questionCount: row.question_count, attemptCount: row.attempt_count,
  })) });
});

teacherRouter.post("/classes/:classId/assessments", async (request, response) => {
  const classId = idFrom(request.params.classId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const moduleId = request.body?.moduleId === "" || request.body?.moduleId === null
    ? null
    : request.body?.moduleId === undefined ? null : idFrom(request.body.moduleId);
  const startsAt = dateFrom(request.body?.startsAt);
  const dueAt = dateFrom(request.body?.dueAt);
  const maxAttempts = request.body?.maxAttempts === undefined ? 1 : request.body.maxAttempts;
  const passScore = request.body?.passScore === "" || request.body?.passScore === undefined
    ? null : request.body?.passScore;
  const questions = parseQuestions(request.body?.questions);
  if (
    !classId || title.length < 2 || title.length > 180 ||
    (description !== null && description.length > 5000) ||
    (request.body?.moduleId !== undefined && request.body?.moduleId !== null && request.body?.moduleId !== "" && !moduleId) ||
    startsAt === undefined || dueAt === undefined ||
    (startsAt && dueAt && Date.parse(startsAt) > Date.parse(dueAt)) ||
    typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
    (passScore !== null && (typeof passScore !== "number" || !Number.isFinite(passScore) || passScore < 0 || passScore > 100)) ||
    (request.body?.isRequired !== undefined && typeof request.body.isRequired !== "boolean") ||
    !questions
  ) {
    response.status(400).json({ error: "Data asesmen atau soal tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & { id: string; module_id: string | null }>(
      `INSERT INTO assessments
         (class_id, module_id, title, description, starts_at, due_at, max_attempts, pass_score, is_required)
       SELECT c.id, m.id, $3, $4, $5, $6, $7, $8, $9
       FROM classes c
       LEFT JOIN modules m ON m.id = $2 AND m.class_id = c.id AND m.is_active = TRUE
       WHERE c.id = $1 AND c.teacher_id = $10 AND c.is_active = TRUE
         AND ($2::bigint IS NULL OR m.id IS NOT NULL)
       RETURNING id, module_id`,
      [classId, moduleId, title, description, startsAt, dueAt, maxAttempts, passScore,
        request.body.isRequired !== false, userIdFrom(response)],
    );
    const assessment = rows[0];
    if (!assessment) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas atau modul tidak ditemukan." });
      return;
    }
    for (const [position, question] of questions.entries()) {
      await client.query(
        `INSERT INTO questions
           (assessment_id, question_type, prompt, options, answer_key, points, position)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          assessment.id, question.type, question.prompt,
          question.options === null ? null : JSON.stringify(question.options),
          question.answerKey === null ? null : JSON.stringify(question.answerKey),
          question.points, position + 1,
        ],
      );
    }
    if (assessment.module_id && request.body.isRequired !== false) {
      await client.query(
        "INSERT INTO module_requirements (module_id, assessment_id) VALUES ($1, $2)",
        [assessment.module_id, assessment.id],
      );
      await refreshModuleProgress(client, assessment.module_id);
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'ASSESSMENT_CREATED', 'ASSESSMENT', $2)`,
      [userIdFrom(response), assessment.id],
    );
    await client.query("COMMIT");
    response.status(201).json({ id: assessment.id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.delete("/assessments/:assessmentId", async (request, response) => {
  const assessmentId = idFrom(request.params.assessmentId);
  if (!assessmentId) {
    response.status(400).json({ error: "ID asesmen tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & { module_id: string | null }>(
      `UPDATE assessments a SET is_active = FALSE
       FROM classes c
       WHERE a.id = $1 AND a.class_id = c.id AND c.teacher_id = $2
         AND c.is_active = TRUE AND a.is_active = TRUE
       RETURNING a.module_id`,
      [assessmentId, userIdFrom(response)],
    );
    const assessment = rows[0];
    if (!assessment) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Asesmen tidak ditemukan." });
      return;
    }
    await client.query("DELETE FROM module_requirements WHERE assessment_id = $1", [assessmentId]);
    if (assessment.module_id) await refreshModuleProgress(client, assessment.module_id);
    await client.query("COMMIT");
    response.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.get("/assessments/:assessmentId/attempts", async (request, response) => {
  const assessmentId = idFrom(request.params.assessmentId);
  if (!assessmentId) {
    response.status(400).json({ error: "ID asesmen tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string; student_id: string; full_name: string; nisn: string; attempt_number: number;
    status: string; started_at: Date; submitted_at: Date | null; score: string | null;
    max_score: string | null; feedback: string | null;
    answers: Array<{ prompt: string; type: QuestionType; answer: unknown; points: number }>;
  }>(
    `SELECT aa.id, aa.student_id, s.full_name, s.nisn, aa.attempt_number, aa.status,
            aa.started_at, aa.submitted_at, g.score,
            COALESCE(g.max_score, (SELECT SUM(q.points) FROM questions q WHERE q.assessment_id = a.id)) AS max_score,
            g.feedback,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'prompt', q.prompt, 'type', q.question_type,
                'answer', answer.answer, 'points', q.points
              ) ORDER BY q.position)
              FROM assessment_answers answer
              JOIN questions q ON q.id = answer.question_id
              WHERE answer.attempt_id = aa.id
            ), '[]'::jsonb) AS answers
     FROM assessment_attempts aa
     JOIN assessments a ON a.id = aa.assessment_id
     JOIN classes c ON c.id = a.class_id
     JOIN students s ON s.user_id = aa.student_id
     LEFT JOIN grades g ON g.assessment_attempt_id = aa.id
     WHERE aa.assessment_id = $1 AND c.teacher_id = $2 AND a.is_active = TRUE
     ORDER BY aa.submitted_at DESC NULLS LAST`,
    [assessmentId, userIdFrom(response)],
  );
  const { rowCount } = await pool.query(
    `SELECT 1 FROM assessments a JOIN classes c ON c.id = a.class_id
     WHERE a.id = $1 AND c.teacher_id = $2`,
    [assessmentId, userIdFrom(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Asesmen tidak ditemukan." });
    return;
  }
  response.json({ attempts: rows.map((row) => ({
    id: row.id, studentId: row.student_id, fullName: row.full_name, nisn: row.nisn.trim(),
    attemptNumber: row.attempt_number, status: row.status, startedAt: row.started_at,
    submittedAt: row.submitted_at, score: row.score === null ? null : Number(row.score),
    maxScore: row.max_score === null ? null : Number(row.max_score), feedback: row.feedback,
    answers: row.answers.map((answer) => ({ ...answer, points: Number(answer.points) })),
  })) });
});

teacherRouter.put("/assessment-attempts/:attemptId/grade", async (request, response) => {
  const attemptId = idFrom(request.params.attemptId);
  const score = request.body?.score;
  const maxScore = request.body?.maxScore;
  const feedback = typeof request.body?.feedback === "string" ? request.body.feedback.trim() || null : null;
  if (
    !attemptId || typeof score !== "number" || !Number.isFinite(score) ||
    typeof maxScore !== "number" || !Number.isFinite(maxScore) ||
    score < 0 || maxScore <= 0 || score > maxScore ||
    (feedback !== null && feedback.length > 5000)
  ) {
    response.status(400).json({ error: "Nilai atau umpan balik tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & {
      student_id: string; module_id: string | null; teacher_id: string;
    }>(
      `SELECT aa.student_id, a.module_id, c.teacher_id
       FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
       JOIN classes c ON c.id = a.class_id
       WHERE aa.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE`,
      [attemptId, userIdFrom(response)],
    );
    const attempt = rows[0];
    if (!attempt) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Percobaan asesmen tidak ditemukan." });
      return;
    }
    await client.query("UPDATE assessment_attempts SET status = 'GRADED' WHERE id = $1", [attemptId]);
    await client.query(
      `INSERT INTO grades
         (student_id, assessment_attempt_id, graded_by, score, max_score, feedback)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (assessment_attempt_id) DO UPDATE
       SET graded_by = EXCLUDED.graded_by, score = EXCLUDED.score,
           max_score = EXCLUDED.max_score, feedback = EXCLUDED.feedback, graded_at = CURRENT_TIMESTAMP`,
      [attempt.student_id, attemptId, userIdFrom(response), score, maxScore, feedback],
    );
    if (attempt.module_id) await refreshModuleProgress(client, attempt.module_id);
    await client.query("COMMIT");
    response.json({ message: "Nilai asesmen tersimpan." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

const loadStudentClass = async (classId: string, studentId: string): Promise<boolean> => {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM classes c JOIN class_students cs ON cs.class_id = c.id
     WHERE c.id = $1 AND c.is_active = TRUE AND cs.student_id = $2 AND cs.is_active = TRUE`,
    [classId, studentId],
  );
  return rowCount === 1;
};

studentRouter.get("/classes/:classId/assignments", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  if (!await loadStudentClass(classId, studentId)) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string; title: string; description: string | null; instructions: string | null;
    module_id: string | null; module_title: string | null; starts_at: Date | null; due_at: Date | null;
    submission_type: SubmissionType; is_required: boolean; allow_late_submission: boolean;
    allow_revision: boolean; submission_id: string | null; attempt_number: number | null;
    status: string | null; submitted_at: Date | null; score: string | null; max_score: string | null;
    feedback: string | null; file_key: string | null; external_url: string | null; response_text: string | null;
  }>(
    `SELECT a.id, a.title, a.description, a.instructions, a.module_id, m.title AS module_title,
            a.starts_at, a.due_at, a.submission_type, a.is_required,
            a.allow_late_submission, a.allow_revision,
            latest.id AS submission_id, latest.attempt_number, latest.status, latest.submitted_at,
            g.score, g.max_score, g.feedback, latest.file_key, latest.external_url, latest.response_text
     FROM assignments a
     LEFT JOIN modules m ON m.id = a.module_id
     LEFT JOIN LATERAL (
       SELECT s.* FROM assignment_submissions s
       WHERE s.assignment_id = a.id AND s.student_id = $2
       ORDER BY s.attempt_number DESC LIMIT 1
     ) latest ON TRUE
     LEFT JOIN grades g ON g.assignment_submission_id = latest.id
     WHERE a.class_id = $1 AND a.is_active = TRUE
     ORDER BY a.due_at NULLS LAST, a.created_at DESC`,
    [classId, studentId],
  );
  const assignments = [];
  for (const row of rows) {
    const unlocked = !row.module_id || await moduleIsUnlocked(pool, row.module_id, studentId);
    assignments.push({
      id: row.id, title: row.title, description: row.description, instructions: row.instructions,
      moduleId: row.module_id, moduleTitle: row.module_title, startsAt: row.starts_at,
      dueAt: row.due_at, submissionType: row.submission_type, isRequired: row.is_required,
      allowLateSubmission: row.allow_late_submission, allowRevision: row.allow_revision,
      unlocked, submission: row.submission_id ? {
        id: row.submission_id, attemptNumber: row.attempt_number, status: row.status,
        submittedAt: row.submitted_at, score: row.score === null ? null : Number(row.score),
        maxScore: row.max_score === null ? null : Number(row.max_score), feedback: row.feedback,
        fileUrl: row.file_key ? `/api/learning/assignment-submissions/${row.submission_id}/file` : null,
        link: row.external_url, text: row.response_text,
      } : null,
    });
  }
  response.json({ assignments });
});

studentRouter.post("/assignments/:assignmentId/submission-upload-url", async (request, response) => {
  if (!isPrivateSupabaseStorageEnabled()) {
    response.json({ mode: "local" });
    return;
  }
  const assignmentId = idFrom(request.params.assignmentId);
  const studentId = userIdFrom(response);
  const fileName = typeof request.body?.fileName === "string" ? request.body.fileName : "";
  const fileSize = request.body?.fileSize;
  const extension = extname(fileName).toLowerCase();
  if (
    !assignmentId || ![".pdf", ".docx", ".jpg", ".jpeg", ".png"].includes(extension) ||
    typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 20 * 1024 * 1024
  ) {
    response.status(400).json({ error: "Nama atau ukuran file tugas tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    module_id: string | null; submission_type: SubmissionType; starts_at: Date | null;
    due_at: Date | null; allow_late_submission: boolean; allow_revision: boolean; active: boolean;
  }>(
    `SELECT a.module_id, a.submission_type, a.starts_at, a.due_at,
            a.allow_late_submission, a.allow_revision, (a.is_active AND c.is_active) AS active
     FROM assignments a JOIN classes c ON c.id = a.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE a.id = $1`,
    [assignmentId, studentId],
  );
  const assignment = rows[0];
  if (!assignment?.active || assignment.submission_type !== "FILE") {
    response.status(404).json({ error: "Tugas unggah file tidak ditemukan." });
    return;
  }
  if (assignment.module_id && !await moduleIsUnlocked(pool, assignment.module_id, studentId)) {
    response.status(423).json({ error: "Selesaikan modul sebelumnya untuk mengumpulkan tugas.", code: "MODULE_LOCKED" });
    return;
  }
  const now = Date.now();
  if (assignment.starts_at && now < new Date(assignment.starts_at).getTime()) {
    response.status(409).json({ error: "Tugas belum dibuka." });
    return;
  }
  if (assignment.due_at && now > new Date(assignment.due_at).getTime() && !assignment.allow_late_submission) {
    response.status(409).json({ error: "Batas waktu pengumpulan tugas telah lewat." });
    return;
  }
  const { rows: previousRows } = await pool.query<QueryResultRow & { attempt_number: number }>(
    `SELECT attempt_number FROM assignment_submissions
     WHERE assignment_id = $1 AND student_id = $2
     ORDER BY attempt_number DESC LIMIT 1`,
    [assignmentId, studentId],
  );
  if (previousRows.length > 0 && !assignment.allow_revision) {
    response.status(409).json({ error: "Pengumpulan ulang tidak diizinkan untuk tugas ini." });
    return;
  }
  const target = await createPrivateUploadTarget("assignments", studentId, extension);
  if (!target) {
    response.status(503).json({ error: "Penyimpanan file belum dikonfigurasi." });
    return;
  }
  response.json({ mode: "direct", ...target });
});

studentRouter.post("/assignments/:assignmentId/submissions", handleUpload, async (request, response) => {
  const assignmentId = idFrom(request.params.assignmentId);
  const studentId = userIdFrom(response);
  if (!assignmentId) {
    response.status(400).json({ error: "ID tugas tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    class_id: string; module_id: string | null; submission_type: SubmissionType;
    starts_at: Date | null; due_at: Date | null; allow_late_submission: boolean;
    allow_revision: boolean; active: boolean;
  }>(
    `SELECT a.class_id, a.module_id, a.submission_type, a.starts_at, a.due_at,
            a.allow_late_submission, a.allow_revision, (a.is_active AND c.is_active) AS active
     FROM assignments a JOIN classes c ON c.id = a.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE a.id = $1`,
    [assignmentId, studentId],
  );
  const assignment = rows[0];
  if (!assignment?.active) {
    response.status(404).json({ error: "Tugas tidak ditemukan." });
    return;
  }
  if (assignment.module_id && !await moduleIsUnlocked(pool, assignment.module_id, studentId)) {
    response.status(423).json({ error: "Selesaikan modul sebelumnya untuk mengumpulkan tugas.", code: "MODULE_LOCKED" });
    return;
  }
  const now = Date.now();
  if (assignment.starts_at && now < new Date(assignment.starts_at).getTime()) {
    response.status(409).json({ error: "Tugas belum dibuka." });
    return;
  }
  const late = assignment.due_at !== null && now > new Date(assignment.due_at).getTime();
  if (late && !assignment.allow_late_submission) {
    response.status(409).json({ error: "Batas waktu pengumpulan tugas telah lewat." });
    return;
  }
  const { rows: previousRows } = await pool.query<QueryResultRow & { attempt_number: number }>(
    `SELECT attempt_number FROM assignment_submissions
     WHERE assignment_id = $1 AND student_id = $2
     ORDER BY attempt_number DESC LIMIT 1`,
    [assignmentId, studentId],
  );
  if (previousRows.length > 0 && !assignment.allow_revision) {
    response.status(409).json({ error: "Pengumpulan ulang tidak diizinkan untuk tugas ini." });
    return;
  }
  const attemptNumber = (previousRows[0]?.attempt_number ?? 0) + 1;
  let fileKey: string | null = null;
  let externalUrl: string | null = null;
  let responseText: string | null = null;
  if (assignment.submission_type === "FILE") {
    const file = request.file;
    const uploadedFileKey = typeof request.body?.fileKey === "string" ? request.body.fileKey : "";
    let fileContents: Buffer | null = file?.buffer ?? null;
    let extension = file ? validateSubmissionFile(file.originalname, file.buffer) : null;
    if (!file && isPrivateFileOwnedBy("assignments", studentId, uploadedFileKey)) {
      try {
        fileContents = await readPrivateFile("assignments", uploadedFileKey);
        extension = validateSubmissionFile(uploadedFileKey.split("/").at(-1) ?? "", fileContents);
      } catch {
        extension = null;
      }
    }
    if (!fileContents || !extension) {
      if (uploadedFileKey) await deletePrivateFile("assignments", uploadedFileKey).catch(() => undefined);
      response.status(400).json({ error: "Unggah PDF, DOCX, JPG, atau PNG yang valid." });
      return;
    }
    if (file) {
      fileKey = `${randomUUID()}${extension}`;
      await writePrivateFile("assignments", fileKey, fileContents, file.mimetype);
    } else {
      fileKey = uploadedFileKey;
    }
  } else if (assignment.submission_type === "LINK") {
    const link = typeof request.body?.externalUrl === "string" ? request.body.externalUrl.trim() : "";
    try {
      const url = new URL(link);
      if (url.protocol !== "https:" || link.length > 2048) throw new Error("invalid");
      externalUrl = url.toString();
    } catch {
      response.status(400).json({ error: "Masukkan tautan HTTPS yang valid." });
      return;
    }
  } else {
    const text = typeof request.body?.responseText === "string" ? request.body.responseText.trim() : "";
    if (!text || text.length > 50000) {
      response.status(400).json({ error: "Jawaban wajib diisi dan maksimal 50.000 karakter." });
      return;
    }
    responseText = text;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: inserted } = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO assignment_submissions
         (assignment_id, student_id, attempt_number, submission_type, file_key,
          external_url, response_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [assignmentId, studentId, attemptNumber, assignment.submission_type, fileKey,
        externalUrl, responseText, late ? "LATE" : "SUBMITTED"],
    );
    if (assignment.module_id) await refreshModuleProgress(client, assignment.module_id);
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'ASSIGNMENT_SUBMITTED', 'ASSIGNMENT', $2)`,
      [studentId, assignmentId],
    );
    await client.query("COMMIT");
    response.status(201).json({
      id: inserted[0]?.id,
      attemptNumber,
      status: late ? "LATE" : "SUBMITTED",
      submittedAt: new Date().toISOString(),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (fileKey) await deletePrivateFile("assignments", fileKey).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

const loadStudentAssessment = async (
  assessmentId: string,
  studentId: string,
): Promise<QueryResultRow & {
  id: string; class_id: string; module_id: string | null; starts_at: Date | null;
  due_at: Date | null; active: boolean; max_attempts: number; attempt_count: number;
}> => {
  const { rows } = await pool.query(
    `SELECT a.id, a.class_id, a.module_id, a.starts_at, a.due_at, a.max_attempts,
            (a.is_active AND c.is_active) AS active,
            (SELECT COUNT(*)::integer FROM assessment_attempts aa
             WHERE aa.assessment_id = a.id AND aa.student_id = $2
               AND aa.status IN ('SUBMITTED', 'GRADED')) AS attempt_count
     FROM assessments a JOIN classes c ON c.id = a.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE a.id = $1`,
    [assessmentId, studentId],
  );
  return rows[0] as QueryResultRow & {
    id: string; class_id: string; module_id: string | null; starts_at: Date | null;
    due_at: Date | null; active: boolean; max_attempts: number; attempt_count: number;
  };
};

studentRouter.get("/classes/:classId/assessments", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  if (!await loadStudentClass(classId, studentId)) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string; title: string; description: string | null; module_id: string | null;
    module_title: string | null; starts_at: Date | null; due_at: Date | null;
    max_attempts: number; pass_score: string | null; is_required: boolean;
    question_count: number; attempt_count: number; latest_status: string | null;
    score: string | null; max_score: string | null; feedback: string | null;
  }>(
    `SELECT a.id, a.title, a.description, a.module_id, m.title AS module_title,
            a.starts_at, a.due_at, a.max_attempts, a.pass_score, a.is_required,
            (SELECT COUNT(*)::integer FROM questions q WHERE q.assessment_id = a.id) AS question_count,
            (SELECT COUNT(*)::integer FROM assessment_attempts aa
             WHERE aa.assessment_id = a.id AND aa.student_id = $2) AS attempt_count,
            latest.status AS latest_status, g.score, g.max_score, g.feedback
     FROM assessments a LEFT JOIN modules m ON m.id = a.module_id
     LEFT JOIN LATERAL (
       SELECT aa.* FROM assessment_attempts aa
       WHERE aa.assessment_id = a.id AND aa.student_id = $2
       ORDER BY aa.attempt_number DESC LIMIT 1
     ) latest ON TRUE
     LEFT JOIN grades g ON g.assessment_attempt_id = latest.id
     WHERE a.class_id = $1 AND a.is_active = TRUE
     ORDER BY a.due_at NULLS LAST, a.created_at DESC`,
    [classId, studentId],
  );
  const assessments = [];
  for (const row of rows) {
    const unlocked = !row.module_id || await moduleIsUnlocked(pool, row.module_id, studentId);
    assessments.push({
      id: row.id, title: row.title, description: row.description,
      moduleId: row.module_id, moduleTitle: row.module_title, startsAt: row.starts_at,
      dueAt: row.due_at, maxAttempts: row.max_attempts, attemptCount: row.attempt_count,
      passScore: row.pass_score === null ? null : Number(row.pass_score), isRequired: row.is_required,
      questionCount: row.question_count, unlocked, status: row.latest_status,
      score: row.score === null ? null : Number(row.score),
      maxScore: row.max_score === null ? null : Number(row.max_score), feedback: row.feedback,
    });
  }
  response.json({ assessments });
});

studentRouter.get("/assessments/:assessmentId", async (request, response) => {
  const assessmentId = idFrom(request.params.assessmentId);
  if (!assessmentId) {
    response.status(400).json({ error: "ID asesmen tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  const assessment = await loadStudentAssessment(assessmentId, studentId);
  if (!assessment?.active) {
    response.status(404).json({ error: "Asesmen tidak ditemukan." });
    return;
  }
  if (assessment.module_id && !await moduleIsUnlocked(pool, assessment.module_id, studentId)) {
    response.status(423).json({ error: "Selesaikan modul sebelumnya untuk membuka asesmen.", code: "MODULE_LOCKED" });
    return;
  }
  const now = Date.now();
  if (assessment.starts_at && now < new Date(assessment.starts_at).getTime()) {
    response.status(409).json({ error: "Asesmen belum dibuka." });
    return;
  }
  if (assessment.due_at && now > new Date(assessment.due_at).getTime()) {
    response.status(409).json({ error: "Batas waktu asesmen telah lewat." });
    return;
  }
  if (assessment.attempt_count >= assessment.max_attempts) {
    response.status(409).json({ error: "Batas jumlah percobaan asesmen tercapai." });
    return;
  }
  const { rows: questions } = await pool.query<QueryResultRow & {
    id: string; question_type: QuestionType; prompt: string; options: unknown; points: string;
  }>(
    `SELECT id, question_type, prompt, options, points
     FROM questions WHERE assessment_id = $1 ORDER BY position`,
    [assessmentId],
  );
  response.json({ assessment: {
    id: assessment.id, startsAt: assessment.starts_at, dueAt: assessment.due_at,
    maxAttempts: assessment.max_attempts, questions: questions.map((question) => ({
      id: question.id, type: question.question_type, prompt: question.prompt,
      options: question.options, points: Number(question.points),
    })),
  } });
});

studentRouter.post("/assessments/:assessmentId/attempts", async (request, response) => {
  const assessmentId = idFrom(request.params.assessmentId);
  const rawAnswers = request.body?.answers;
  if (
    !assessmentId || !Array.isArray(rawAnswers) || rawAnswers.length < 1 ||
    rawAnswers.length > 100 || rawAnswers.some((item) =>
      !item || typeof item !== "object" || typeof item.questionId !== "string" ||
      !Object.hasOwn(item, "answer")
    )
  ) {
    response.status(400).json({ error: "Jawaban asesmen tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & {
      id: string; module_id: string | null; starts_at: Date | null; due_at: Date | null;
      max_attempts: number; class_id: string; teacher_id: string;
    }>(
      `SELECT a.id, a.module_id, a.starts_at, a.due_at, a.max_attempts, a.class_id,
              c.teacher_id
       FROM assessments a JOIN classes c ON c.id = a.class_id
       JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
       WHERE a.id = $1 AND a.is_active = TRUE AND c.is_active = TRUE
       FOR UPDATE OF a`,
      [assessmentId, studentId],
    );
    const assessment = rows[0];
    if (!assessment) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Asesmen tidak ditemukan." });
      return;
    }
    if (assessment.module_id && !await moduleIsUnlocked(client, assessment.module_id, studentId)) {
      await client.query("ROLLBACK");
      response.status(423).json({ error: "Selesaikan modul sebelumnya untuk mengerjakan asesmen.", code: "MODULE_LOCKED" });
      return;
    }
    const now = Date.now();
    if (assessment.starts_at && now < new Date(assessment.starts_at).getTime()) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Asesmen belum dibuka." });
      return;
    }
    if (assessment.due_at && now > new Date(assessment.due_at).getTime()) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Batas waktu asesmen telah lewat." });
      return;
    }
    const { rows: previous } = await client.query<QueryResultRow & { attempts: number }>(
      `SELECT COUNT(*)::integer AS attempts FROM assessment_attempts
       WHERE assessment_id = $1 AND student_id = $2 AND status IN ('SUBMITTED', 'GRADED')`,
      [assessmentId, studentId],
    );
    const attemptNumber = Number(previous[0]?.attempts ?? 0) + 1;
    if (attemptNumber > assessment.max_attempts) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Batas jumlah percobaan asesmen tercapai." });
      return;
    }
    const { rows: questions } = await client.query<QueryResultRow & {
      id: string; question_type: QuestionType; answer_key: unknown; points: string; options: unknown;
    }>(
      `SELECT id, question_type, answer_key, points, options FROM questions
       WHERE assessment_id = $1 ORDER BY position`,
      [assessmentId],
    );
    const answerMap = new Map<string, unknown>();
    for (const item of rawAnswers as Array<{ questionId: string; answer: unknown }>) {
      if (answerMap.has(item.questionId)) {
        await client.query("ROLLBACK");
        response.status(400).json({ error: "Terdapat jawaban soal yang duplikat." });
        return;
      }
      answerMap.set(item.questionId, item.answer);
    }
    if (
      questions.length === 0 || answerMap.size !== questions.length ||
      questions.some((question) => !answerMap.has(question.id))
    ) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "Jawaban harus mencakup seluruh soal asesmen." });
      return;
    }
    const { rows: attempts } = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO assessment_attempts (assessment_id, student_id, attempt_number, status, submitted_at)
       VALUES ($1, $2, $3, 'SUBMITTED', CURRENT_TIMESTAMP) RETURNING id`,
      [assessmentId, studentId, attemptNumber],
    );
    const attemptId = attempts[0]?.id;
    if (!attemptId) throw new Error("Database tidak mengembalikan ID percobaan.");
    let earned = 0;
    let maximum = 0;
    let hasEssay = false;
    for (const question of questions) {
      const answer = answerMap.get(question.id);
      const points = Number(question.points);
      maximum += points;
      let awarded: number | null = null;
      if (question.question_type === "ESSAY") {
        if (typeof answer !== "string" || !answer.trim() || answer.trim().length > 10000) {
          await client.query("ROLLBACK");
          response.status(400).json({ error: "Jawaban esai wajib diisi dan maksimal 10.000 karakter." });
          return;
        }
        hasEssay = true;
      } else {
        if (question.question_type === "MULTIPLE_CHOICE" && typeof answer !== "string") {
          await client.query("ROLLBACK");
          response.status(400).json({ error: "Jawaban pilihan ganda tidak valid." });
          return;
        }
        if (question.question_type === "MULTIPLE_CHOICE" &&
            (!Array.isArray(question.options) ||
             !question.options.some((option) =>
               typeof option === "object" && option !== null &&
               "id" in option && option.id === answer
             ))) {
          await client.query("ROLLBACK");
          response.status(400).json({ error: "Pilihan jawaban tidak tersedia." });
          return;
        }
        if (question.question_type === "TRUE_FALSE" && typeof answer !== "boolean") {
          await client.query("ROLLBACK");
          response.status(400).json({ error: "Jawaban benar/salah tidak valid." });
          return;
        }
        if (question.question_type === "SHORT_ANSWER" &&
            (typeof answer !== "string" || !answer.trim() || answer.trim().length > 1000)) {
          await client.query("ROLLBACK");
          response.status(400).json({ error: "Jawaban singkat wajib diisi dan maksimal 1.000 karakter." });
          return;
        }
        const key = question.answer_key;
        const isCorrect = question.question_type === "SHORT_ANSWER"
          ? typeof answer === "string" && typeof key === "string" &&
            answer.trim().toLocaleLowerCase("id-ID") === key.trim().toLocaleLowerCase("id-ID")
          : answer === key;
        awarded = isCorrect ? points : 0;
        earned += awarded;
      }
      await client.query(
        `INSERT INTO assessment_answers (attempt_id, question_id, answer, awarded_points)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [attemptId, question.id, JSON.stringify(answer), awarded],
      );
    }
    if (!hasEssay) {
      await client.query("UPDATE assessment_attempts SET status = 'GRADED' WHERE id = $1", [attemptId]);
      await client.query(
        `INSERT INTO grades (student_id, assessment_attempt_id, graded_by, score, max_score)
         VALUES ($1, $2, $3, $4, $5)`,
        [studentId, attemptId, assessment.teacher_id, earned, maximum],
      );
    }
    if (assessment.module_id) await refreshModuleProgress(client, assessment.module_id);
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'ASSESSMENT_SUBMITTED', 'ASSESSMENT', $2, $3::jsonb)`,
      [studentId, assessmentId, JSON.stringify({ attemptNumber })],
    );
    await client.query("COMMIT");
    response.status(201).json({
      attemptId, attemptNumber, status: hasEssay ? "SUBMITTED" : "GRADED",
      score: hasEssay ? null : earned, maxScore: hasEssay ? null : maximum,
      awaitingTeacher: hasEssay,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

studentRouter.get("/assignment-submissions/:submissionId/file", async (request, response) => {
  const submissionId = idFrom(request.params.submissionId);
  if (!submissionId) {
    response.status(400).json({ error: "ID pengumpulan tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & { file_key: string }>(
    `SELECT s.file_key FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN class_students cs ON cs.class_id = a.class_id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE s.id = $1 AND s.student_id = $2 AND a.is_active = TRUE`,
    [submissionId, userIdFrom(response)],
  );
  if (!rows[0]) {
    response.status(404).json({ error: "File pengumpulan tidak ditemukan." });
    return;
  }
  await sendSubmissionFile(response, rows[0].file_key);
});

teacherRouter.get("/assignment-submissions/:submissionId/file", async (request, response) => {
  const submissionId = idFrom(request.params.submissionId);
  if (!submissionId) {
    response.status(400).json({ error: "ID pengumpulan tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & { file_key: string }>(
    `SELECT s.file_key FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN classes c ON c.id = a.class_id
     WHERE s.id = $1 AND c.teacher_id = $2`,
    [submissionId, userIdFrom(response)],
  );
  if (!rows[0]) {
    response.status(404).json({ error: "File pengumpulan tidak ditemukan." });
    return;
  }
  await sendSubmissionFile(response, rows[0].file_key);
});

export { studentRouter as studentAssignmentsRouter, teacherRouter as teacherAssignmentsRouter };
