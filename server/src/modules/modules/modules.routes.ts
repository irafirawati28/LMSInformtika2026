import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
} from "../../shared/private-storage.js";
import { requireStudent } from "../../middleware/require-student.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";

type ModuleFields = {
  title: string;
  description: string | null;
  learningObjectives: string | null;
  durationMinutes: number | null;
  isRequired: boolean;
};

type ContentFields = {
  title: string;
  description: string | null;
  contentType: "TEXT" | "PDF" | "DOCX" | "IMAGE" | "VIDEO" | "LINK" | "YOUTUBE";
  body: string | null;
  externalUrl: string | null;
  durationMinutes: number | null;
  isRequired: boolean;
};

type ModuleRow = QueryResultRow & {
  id: string;
  title: string;
  description: string | null;
  learning_objectives: string | null;
  position: number;
  duration_minutes: number | null;
  is_required: boolean;
  contents: unknown;
};

type LearningModuleRow = QueryResultRow & {
  id: string;
  title: string;
  description: string | null;
  learning_objectives: string | null;
  position: number;
  duration_minutes: number | null;
  is_required: boolean;
  required_count: number | string;
  completed_count: number | string;
  progress_percent: number | string;
  is_complete: boolean;
  is_unlocked: boolean;
  status: string;
};

type ContentRow = QueryResultRow & {
  id: string;
  module_id: string;
  title: string;
  description: string | null;
  content_type: ContentFields["contentType"];
  body: string | null;
  external_url: string | null;
  position: number;
  duration_minutes: number | null;
  is_required: boolean;
  file_key?: string | null;
  game_id?: string | null;
  completed?: boolean;
};

const teacherRouter = Router();
const studentRouter = Router();
teacherRouter.use(requireTeacher);
studentRouter.use(requireStudent);

const moduleStorageDirectory = resolve(process.cwd(), "storage/modules");
const privateModuleStorageDirectory = resolve(moduleStorageDirectory);
const moduleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    const extension = extname(file.originalname).toLowerCase();
    if (![".pdf", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm"].includes(extension)) {
      callback(new Error("Format file tidak didukung. Gunakan PDF, DOCX, JPG, PNG, GIF, WEBP, MP4, atau WEBM."));
      return;
    }
    callback(null, true);
  },
});

const parseUploadedFile = (file: Pick<Express.Multer.File, "originalname" | "buffer">): {
  contentType: ContentFields["contentType"];
  extension: string;
} | null => {
  const extension = extname(file.originalname).toLowerCase();
  const bytes = file.buffer;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isGif = bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  const isWebp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const isPdf = bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-";
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isMp4 = bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  const isWebm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  let hasDocxDocument = false;
  if (isZip) {
    const searchStart = Math.max(0, bytes.length - 65_557);
    for (let endOffset = bytes.length - 22; endOffset >= searchStart; endOffset -= 1) {
      if (bytes.readUInt32LE(endOffset) !== 0x06054b50) continue;
      const entries = bytes.readUInt16LE(endOffset + 10);
      let directoryOffset = bytes.readUInt32LE(endOffset + 16);
      if (directoryOffset >= bytes.length) break;
      for (let entry = 0; entry < entries; entry += 1) {
        if (directoryOffset + 46 > bytes.length || bytes.readUInt32LE(directoryOffset) !== 0x02014b50) break;
        const nameLength = bytes.readUInt16LE(directoryOffset + 28);
        const extraLength = bytes.readUInt16LE(directoryOffset + 30);
        const commentLength = bytes.readUInt16LE(directoryOffset + 32);
        const nameEnd = directoryOffset + 46 + nameLength;
        if (nameEnd + extraLength + commentLength > bytes.length) break;
        if (bytes.toString("utf8", directoryOffset + 46, nameEnd) === "word/document.xml") {
          hasDocxDocument = true;
          break;
        }
        directoryOffset = nameEnd + extraLength + commentLength;
      }
      break;
    }
  }

  if (extension === ".pdf" && isPdf) return { contentType: "PDF", extension };
  if (extension === ".docx" && hasDocxDocument) return { contentType: "DOCX", extension };
  if ([".jpg", ".jpeg"].includes(extension) && isJpeg) return { contentType: "IMAGE", extension: ".jpg" };
  if (extension === ".png" && isPng) return { contentType: "IMAGE", extension };
  if (extension === ".gif" && isGif) return { contentType: "IMAGE", extension };
  if (extension === ".webp" && isWebp) return { contentType: "IMAGE", extension };
  if (extension === ".mp4" && isMp4) return { contentType: "VIDEO", extension };
  if (extension === ".webm" && isWebm) return { contentType: "VIDEO", extension };
  return null;
};

const handleModuleUpload = (request: Request, response: Response, next: (error?: unknown) => void): void => {
  moduleUpload.single("file")(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE"
          ? "Ukuran file maksimal 20 MB."
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

const getFileMimeType = (fileKey: string): string => {
  switch (extname(fileKey).toLowerCase()) {
    case ".pdf": return "application/pdf";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    default: return "application/octet-stream";
  }
};

const sendPrivateFile = async (
  response: Response,
  fileKey: string,
  title: string,
): Promise<void> => {
  const extension = extname(fileKey).toLowerCase();
  const downloadName = `${title.replace(/[^a-zA-Z0-9 ._-]/g, "_").slice(0, 100) || "materi"}${extension}`;
  const signedUrl = await createPrivateDownloadUrl(
    "modules",
    fileKey,
    extension === ".docx" ? downloadName : false,
  );
  if (signedUrl) {
    response.redirect(302, signedUrl);
    return;
  }
  let contents: Buffer;
  try {
    contents = await readPrivateFile("modules", fileKey);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      response.status(404).json({ error: "File materi tidak ditemukan di penyimpanan." });
      return;
    }
    throw error;
  }
  response
    .set("Content-Type", getFileMimeType(fileKey))
    .set("Content-Length", String(contents.length))
    .set(
      "Content-Disposition",
      `${extension === ".docx" ? "attachment" : "inline"}; filename="${downloadName}"`,
    )
    .set("X-Content-Type-Options", "nosniff")
    .set("Cache-Control", "private, no-store")
    .send(contents);
};

const idFrom = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;

const parseModuleFields = (body: unknown): ModuleFields | null => {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value.title !== "string" ||
    (value.description !== undefined && value.description !== null && typeof value.description !== "string") ||
    (value.learningObjectives !== undefined && value.learningObjectives !== null && typeof value.learningObjectives !== "string") ||
    (value.durationMinutes !== undefined && value.durationMinutes !== null && typeof value.durationMinutes !== "number") ||
    (value.isRequired !== undefined && typeof value.isRequired !== "boolean")
  ) return null;

  const title = value.title.trim();
  const description = typeof value.description === "string" ? value.description.trim() || null : null;
  const learningObjectives = typeof value.learningObjectives === "string" ? value.learningObjectives.trim() || null : null;
  const durationMinutes = typeof value.durationMinutes === "number" ? value.durationMinutes : null;
  if (
    title.length < 2 || title.length > 180 ||
    (description !== null && description.length > 5000) ||
    (learningObjectives !== null && learningObjectives.length > 5000) ||
    (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440))
  ) return null;

  return { title, description, learningObjectives, durationMinutes, isRequired: value.isRequired !== false };
};

const parseContentFields = (body: unknown): ContentFields | null => {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const validTypes = ["TEXT", "PDF", "DOCX", "IMAGE", "VIDEO", "LINK", "YOUTUBE"];
  if (
    typeof value.title !== "string" ||
    typeof value.contentType !== "string" ||
    !validTypes.includes(value.contentType) ||
    (value.description !== undefined && value.description !== null && typeof value.description !== "string") ||
    (value.body !== undefined && value.body !== null && typeof value.body !== "string") ||
    (value.externalUrl !== undefined && value.externalUrl !== null && typeof value.externalUrl !== "string") ||
    (value.durationMinutes !== undefined && value.durationMinutes !== null && typeof value.durationMinutes !== "number") ||
    (value.isRequired !== undefined && typeof value.isRequired !== "boolean")
  ) return null;

  const title = value.title.trim();
  const description = typeof value.description === "string" ? value.description.trim() || null : null;
  const contentType = value.contentType as ContentFields["contentType"];
  const bodyText = typeof value.body === "string" ? value.body.trim() || null : null;
  const externalUrl = typeof value.externalUrl === "string" ? value.externalUrl.trim() || null : null;
  const durationMinutes = typeof value.durationMinutes === "number" ? value.durationMinutes : null;
  if (
    title.length < 2 || title.length > 180 ||
    (description !== null && description.length > 5000) ||
    (bodyText !== null && bodyText.length > 50000) ||
    (externalUrl !== null && externalUrl.length > 2048) ||
    (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) ||
    (contentType === "TEXT" ? !bodyText : !externalUrl)
  ) return null;

  if (externalUrl) {
    let url: URL;
    try {
      url = new URL(externalUrl);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") return null;
    if (contentType === "YOUTUBE" && !["youtube.com", "www.youtube.com", "youtu.be"].includes(url.hostname.toLowerCase())) {
      return null;
    }
  }
  return { title, description, contentType, body: bodyText, externalUrl, durationMinutes, isRequired: value.isRequired !== false };
};

const getUserId = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const refreshModuleProgress = async (
  client: PoolClient,
  moduleId: string,
): Promise<void> => {
  await client.query(
    `WITH totals AS (
       SELECT p.student_id,
         (
           (SELECT COUNT(*) FROM module_contents mc
            WHERE mc.module_id = p.module_id AND mc.is_active = TRUE AND mc.is_required = TRUE)
           + (SELECT COUNT(*) FROM assignments a
              WHERE a.module_id = p.module_id AND a.is_active = TRUE AND a.is_required = TRUE)
           + (SELECT COUNT(*) FROM assessments a
              WHERE a.module_id = p.module_id AND a.is_active = TRUE AND a.is_required = TRUE)
         )::integer AS required_count,
         (
           (SELECT COUNT(*) FROM module_contents mc
            JOIN student_content_progress scp ON scp.module_content_id = mc.id
              AND scp.student_id = p.student_id AND scp.status = 'COMPLETED'
            WHERE mc.module_id = p.module_id AND mc.is_active = TRUE AND mc.is_required = TRUE)
           + (SELECT COUNT(*) FROM assignments a
              WHERE a.module_id = p.module_id AND a.is_active = TRUE AND a.is_required = TRUE
                AND EXISTS (SELECT 1 FROM assignment_submissions s
                            WHERE s.assignment_id = a.id AND s.student_id = p.student_id))
           + (SELECT COUNT(*) FROM assessments a
              WHERE a.module_id = p.module_id AND a.is_active = TRUE AND a.is_required = TRUE
                AND EXISTS (SELECT 1 FROM assessment_attempts aa
                            WHERE aa.assessment_id = a.id AND aa.student_id = p.student_id
                              AND aa.status IN ('SUBMITTED', 'GRADED')))
         )::integer AS completed_count
       FROM student_module_progress p
       WHERE p.module_id = $1
     )
     UPDATE student_module_progress p
     SET progress_percent = CASE WHEN totals.required_count = 0 THEN 100
                                 ELSE ROUND(totals.completed_count * 100.0 / totals.required_count)::smallint END,
         status = CASE WHEN totals.completed_count = totals.required_count THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,
         completed_at = CASE WHEN totals.completed_count = totals.required_count
                             THEN COALESCE(p.completed_at, CURRENT_TIMESTAMP) ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     FROM totals
     WHERE p.module_id = $1 AND p.student_id = totals.student_id`,
    [moduleId],
  );
};

const moduleFieldsSql = `m.title, m.description, m.learning_objectives, m.duration_minutes, m.is_required`;

teacherRouter.get("/classes/:classId/modules", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows } = await pool.query<ModuleRow>(
    `SELECT m.id, ${moduleFieldsSql}, m.position,
            COALESCE(
              json_agg(json_build_object(
                'id', mc.id::text, 'title', mc.title, 'description', mc.description,
                'contentType', mc.content_type, 'body', mc.body,
                'externalUrl', mc.external_url, 'position', mc.position,
                          'durationMinutes', mc.duration_minutes, 'isRequired', mc.is_required,
                          'gameId', lg.id::text,
                          'fileUrl', CASE WHEN mc.file_key IS NOT NULL THEN '/api/contents/' || mc.id::text || '/file' ELSE NULL END
              ) ORDER BY mc.position) FILTER (WHERE mc.id IS NOT NULL),
              '[]'::json
            ) AS contents
     FROM modules m
     JOIN classes c ON c.id = m.class_id
     LEFT JOIN module_contents mc ON mc.module_id = m.id AND mc.is_active = TRUE
     LEFT JOIN learning_games lg ON lg.module_content_id = mc.id AND lg.is_active = TRUE
     WHERE m.class_id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE
       AND m.is_active = TRUE
     GROUP BY m.id
     ORDER BY m.position`,
    [classId, getUserId(response)],
  );
  const { rowCount } = await pool.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, getUserId(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  response.json({
    modules: rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      learningObjectives: row.learning_objectives,
      position: row.position,
      durationMinutes: row.duration_minutes,
      isRequired: row.is_required,
      contents: row.contents,
    })),
  });
});

teacherRouter.post("/classes/:classId/modules", async (request, response) => {
  const classId = idFrom(request.params.classId);
  const fields = parseModuleFields(request.body);
  if (!classId || !fields) {
    response.status(400).json({ error: "Data modul tidak valid." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const classResult = await client.query(
      "SELECT id FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE FOR UPDATE",
      [classId, getUserId(response)],
    );
    if (classResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
    const result = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO modules (class_id, title, description, learning_objectives, position, duration_minutes, is_required)
       SELECT $1, $2, $3, $4, COALESCE(MAX(position), 0) + 1, $5, $6
       FROM modules WHERE class_id = $1
       RETURNING id`,
      [classId, fields.title, fields.description, fields.learningObjectives, fields.durationMinutes, fields.isRequired],
    );
    await client.query("COMMIT");
    response.status(201).json({ id: result.rows[0]?.id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.post("/classes/:classId/modules/reorder", async (request, response) => {
  const classId = idFrom(request.params.classId);
  const moduleIds = request.body && typeof request.body === "object"
    ? (request.body as Record<string, unknown>).moduleIds
    : null;
  if (
    !classId ||
    !Array.isArray(moduleIds) ||
    moduleIds.length > 500 ||
    moduleIds.some((id) => idFrom(id) === null) ||
    new Set(moduleIds).size !== moduleIds.length
  ) {
    response.status(400).json({ error: "Urutan modul tidak valid." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const classResult = await client.query(
      "SELECT id FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE FOR UPDATE",
      [classId, getUserId(response)],
    );
    if (classResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }

    const { rows: activeRows } = await client.query<QueryResultRow & { id: string }>(
      "SELECT id FROM modules WHERE class_id = $1 AND is_active = TRUE FOR UPDATE",
      [classId],
    );
    const activeIds = new Set(activeRows.map((row) => row.id));
    if (
      activeIds.size !== moduleIds.length ||
      moduleIds.some((id) => !activeIds.has(id as string))
    ) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Daftar modul berubah. Muat ulang sebelum mengatur urutannya." });
      return;
    }

    const { rows: maxRows } = await client.query<QueryResultRow & { max_position: number | string; inactive_max: number | string }>(
      `SELECT COALESCE(MAX(position), 0) AS max_position,
              COALESCE(MAX(position) FILTER (WHERE is_active = FALSE), 0) AS inactive_max
       FROM modules WHERE class_id = $1`,
      [classId],
    );
    const maxPosition = Number(maxRows[0]?.max_position ?? 0);
    const inactiveMax = Number(maxRows[0]?.inactive_max ?? 0);
    const offset = maxPosition + activeRows.length + moduleIds.length + 1;
    await client.query(
      "UPDATE modules SET position = position + $2 WHERE class_id = $1 AND is_active = TRUE",
      [classId, offset],
    );
    await client.query(
      `UPDATE modules AS m
       SET position = $3 + ordered.ordinality::integer
       FROM unnest($2::bigint[]) WITH ORDINALITY AS ordered(id, ordinality)
       WHERE m.id = ordered.id AND m.class_id = $1 AND m.is_active = TRUE`,
      [classId, moduleIds, inactiveMax],
    );
    await client.query("COMMIT");
    response.json({ message: "Urutan modul berhasil diperbarui." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.put("/modules/:moduleId", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  const fields = parseModuleFields(request.body);
  if (!moduleId || !fields) {
    response.status(400).json({ error: "ID atau data modul tidak valid." });
    return;
  }
  const result = await pool.query(
    `UPDATE modules m
     SET title = $1, description = $2, learning_objectives = $3,
         duration_minutes = $4, is_required = $5
     FROM classes c
     WHERE m.id = $6 AND m.class_id = c.id AND c.teacher_id = $7
       AND c.is_active = TRUE AND m.is_active = TRUE`,
    [fields.title, fields.description, fields.learningObjectives, fields.durationMinutes, fields.isRequired, moduleId, getUserId(response)],
  );
  if (result.rowCount !== 1) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  response.json({ message: "Modul berhasil diperbarui." });
});

teacherRouter.delete("/modules/:moduleId", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  if (!moduleId) {
    response.status(400).json({ error: "ID modul tidak valid." });
    return;
  }
  const result = await pool.query(
    `UPDATE modules m SET is_active = FALSE
     FROM classes c
     WHERE m.id = $1 AND m.class_id = c.id AND c.teacher_id = $2
       AND c.is_active = TRUE AND m.is_active = TRUE`,
    [moduleId, getUserId(response)],
  );
  if (result.rowCount !== 1) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  response.status(204).end();
});

teacherRouter.post("/modules/:moduleId/contents", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  const fields = parseContentFields(request.body);
  if (!moduleId || !fields) {
    response.status(400).json({ error: "Data materi tidak valid. Pastikan jenis materi dan kontennya sesuai." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moduleResult = await client.query(
      `SELECT m.id FROM modules m JOIN classes c ON c.id = m.class_id
       WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE
       FOR UPDATE OF m`,
      [moduleId, getUserId(response)],
    );
    if (moduleResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Modul tidak ditemukan." });
      return;
    }
    const result = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO module_contents
        (module_id, title, description, content_type, body, external_url, position, duration_minutes, is_required)
       SELECT $1, $2, $3, $4, $5, $6, COALESCE(MAX(position), 0) + 1, $7, $8
       FROM module_contents WHERE module_id = $1
       RETURNING id`,
      [moduleId, fields.title, fields.description, fields.contentType, fields.body, fields.externalUrl, fields.durationMinutes, fields.isRequired],
    );
    if (fields.isRequired) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [moduleId, result.rows[0]?.id],
      );
    }
    await refreshModuleProgress(client, moduleId);
    await client.query("COMMIT");
    response.status(201).json({ id: result.rows[0]?.id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.post("/modules/:moduleId/contents/upload-url", async (request, response) => {
  if (!isPrivateSupabaseStorageEnabled()) {
    response.json({ mode: "local" });
    return;
  }
  const moduleId = idFrom(request.params.moduleId);
  const fileName = typeof request.body?.fileName === "string" ? request.body.fileName : "";
  const fileSize = request.body?.fileSize;
  const extension = extname(fileName).toLowerCase();
  if (
    !moduleId || ![".pdf", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm"].includes(extension) ||
    typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 20 * 1024 * 1024
  ) {
    response.status(400).json({ error: "Nama atau ukuran file materi tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    `SELECT 1 FROM modules m JOIN classes c ON c.id = m.class_id
     WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE`,
    [moduleId, getUserId(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  const target = await createPrivateUploadTarget("modules", getUserId(response), extension);
  if (!target) {
    response.status(503).json({ error: "Penyimpanan file belum dikonfigurasi." });
    return;
  }
  response.json({ mode: "direct", ...target });
});

teacherRouter.post("/modules/:moduleId/contents/upload-complete", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  const fileKey = typeof request.body?.fileKey === "string" ? request.body.fileKey : "";
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const durationMinutes = request.body?.durationMinutes === null || request.body?.durationMinutes === ""
    ? null
    : request.body?.durationMinutes;
  const isRequired = request.body?.isRequired;
  if (
    !moduleId || !isPrivateFileOwnedBy("modules", getUserId(response), fileKey) ||
    title.length < 2 || title.length > 180 ||
    (description !== null && (typeof description !== "string" || description.length > 5000)) ||
    (durationMinutes !== null && (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) ||
    (isRequired !== undefined && typeof isRequired !== "boolean")
  ) {
    response.status(400).json({ error: "Data unggahan materi tidak valid." });
    return;
  }

  let uploaded: ReturnType<typeof parseUploadedFile>;
  try {
    const contents = await readPrivateFile("modules", fileKey);
    const originalname = fileKey.split("/").at(-1) ?? "";
    uploaded = parseUploadedFile({ originalname, buffer: contents });
  } catch {
    uploaded = null;
  }
  if (!uploaded) {
    await deletePrivateFile("modules", fileKey).catch(() => undefined);
    response.status(400).json({ error: "Isi file materi tidak valid atau formatnya tidak didukung." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moduleResult = await client.query(
      `SELECT m.id FROM modules m JOIN classes c ON c.id = m.class_id
       WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE
       FOR UPDATE OF m`,
      [moduleId, getUserId(response)],
    );
    if (moduleResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      await deletePrivateFile("modules", fileKey);
      response.status(404).json({ error: "Modul tidak ditemukan." });
      return;
    }
    const result = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO module_contents
        (module_id, title, description, content_type, file_key, position, duration_minutes, is_required)
       SELECT $1, $2, $3, $4, $5, COALESCE(MAX(position), 0) + 1, $6, $7
       FROM module_contents WHERE module_id = $1
       RETURNING id`,
      [moduleId, title, description, uploaded.contentType, fileKey, durationMinutes, isRequired !== false],
    );
    if (isRequired !== false) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [moduleId, result.rows[0]?.id],
      );
    }
    await refreshModuleProgress(client, moduleId);
    await client.query("COMMIT");
    response.status(201).json({ id: result.rows[0]?.id });
  } catch (error) {
    await client.query("ROLLBACK");
    await deletePrivateFile("modules", fileKey).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.post(
  "/modules/:moduleId/contents/upload",
  handleModuleUpload,
  async (request, response) => {
    const moduleId = idFrom(request.params.moduleId);
    const file = request.file;
    const uploaded = file ? parseUploadedFile(file) : null;
    const title = typeof request.body.title === "string" ? request.body.title.trim() : "";
    const description = typeof request.body.description === "string"
      ? request.body.description.trim() || null
      : null;
    const durationRaw = request.body.durationMinutes;
    const durationMinutes = durationRaw === undefined || durationRaw === ""
      ? null
      : typeof durationRaw === "string" && /^\d{1,4}$/.test(durationRaw)
        ? Number(durationRaw)
        : Number.NaN;
    const isRequired = request.body.isRequired !== "false";
    if (
      !moduleId ||
      !file ||
      !uploaded ||
      title.length < 2 ||
      title.length > 180 ||
      (description !== null && description.length > 5000) ||
      (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) ||
      !["true", "false", undefined].includes(request.body.isRequired)
    ) {
      response.status(400).json({
        error: "Data unggahan tidak valid. File harus PDF, DOCX, JPG, PNG, GIF, WEBP, MP4, atau WEBM yang sesuai format.",
      });
      return;
    }

    const fileKey = `${randomUUID()}${uploaded.extension}`;
    const filePath = resolve(privateModuleStorageDirectory, fileKey);
    const client = await pool.connect();
    let fileWritten = false;
    try {
      await mkdir(privateModuleStorageDirectory, { recursive: true, mode: 0o700 });
      await chmod(privateModuleStorageDirectory, 0o700);
      await writeFile(filePath, file.buffer, { flag: "wx", mode: 0o600 });
      fileWritten = true;
      await client.query("BEGIN");
      const moduleResult = await client.query(
        `SELECT m.id FROM modules m JOIN classes c ON c.id = m.class_id
         WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE
         FOR UPDATE OF m`,
        [moduleId, getUserId(response)],
      );
      if (moduleResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        await unlink(filePath);
        fileWritten = false;
        response.status(404).json({ error: "Modul tidak ditemukan." });
        return;
      }
      const result = await client.query<QueryResultRow & { id: string }>(
        `INSERT INTO module_contents
          (module_id, title, description, content_type, file_key, position, duration_minutes, is_required)
         SELECT $1, $2, $3, $4, $5, COALESCE(MAX(position), 0) + 1, $6, $7
         FROM module_contents WHERE module_id = $1
         RETURNING id`,
        [moduleId, title, description, uploaded.contentType, fileKey, durationMinutes, isRequired],
      );
      if (isRequired) {
        await client.query(
          "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
          [moduleId, result.rows[0]?.id],
        );
      }
      await refreshModuleProgress(client, moduleId);
      await client.query("COMMIT");
      response.status(201).json({ id: result.rows[0]?.id });
    } catch (error) {
      await client.query("ROLLBACK");
      if (fileWritten) await unlink(filePath);
      throw error;
    } finally {
      client.release();
    }
  },
);

teacherRouter.post("/contents/:contentId/upload-url", async (request, response) => {
  if (!isPrivateSupabaseStorageEnabled()) {
    response.json({ mode: "local" });
    return;
  }
  const contentId = idFrom(request.params.contentId);
  const fileName = typeof request.body?.fileName === "string" ? request.body.fileName : "";
  const fileSize = request.body?.fileSize;
  const extension = extname(fileName).toLowerCase();
  if (
    !contentId || ![".pdf", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm"].includes(extension) ||
    typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 20 * 1024 * 1024
  ) {
    response.status(400).json({ error: "Nama atau ukuran file materi tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT mc.id FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
       AND m.is_active = TRUE AND c.is_active = TRUE AND c.teacher_id = $2`,
    [contentId, getUserId(response)],
  );
  if (!rows[0]) {
    response.status(404).json({ error: "File materi tidak ditemukan." });
    return;
  }
  const target = await createPrivateUploadTarget("modules", getUserId(response), extension);
  if (!target) {
    response.status(503).json({ error: "Penyimpanan file belum dikonfigurasi." });
    return;
  }
  response.json({ mode: "direct", ...target });
});

teacherRouter.put("/contents/:contentId/upload-complete", async (request, response) => {
  const contentId = idFrom(request.params.contentId);
  const fileKey = typeof request.body?.fileKey === "string" ? request.body.fileKey : "";
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const durationMinutes = request.body?.durationMinutes === null || request.body?.durationMinutes === ""
    ? null
    : request.body?.durationMinutes;
  const isRequired = request.body?.isRequired;
  if (
    !contentId || !isPrivateFileOwnedBy("modules", getUserId(response), fileKey) ||
    title.length < 2 || title.length > 180 ||
    (description !== null && (typeof description !== "string" || description.length > 5000)) ||
    (durationMinutes !== null && (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) ||
    (isRequired !== undefined && typeof isRequired !== "boolean")
  ) {
    response.status(400).json({ error: "Data penggantian file materi tidak valid." });
    return;
  }

  let uploaded: ReturnType<typeof parseUploadedFile>;
  try {
    const contents = await readPrivateFile("modules", fileKey);
    const originalname = fileKey.split("/").at(-1) ?? "";
    uploaded = parseUploadedFile({ originalname, buffer: contents });
  } catch {
    uploaded = null;
  }
  if (!uploaded) {
    await deletePrivateFile("modules", fileKey).catch(() => undefined);
    response.status(400).json({ error: "Isi file materi tidak valid atau formatnya tidak didukung." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & { module_id: string; file_key: string }>(
      `SELECT mc.module_id, mc.file_key
       FROM module_contents mc
       JOIN modules m ON m.id = mc.module_id
       JOIN classes c ON c.id = m.class_id
       WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
         AND m.is_active = TRUE AND c.is_active = TRUE AND c.teacher_id = $2
       FOR UPDATE OF mc`,
      [contentId, getUserId(response)],
    );
    const previous = rows[0];
    if (!previous) {
      await client.query("ROLLBACK");
      await deletePrivateFile("modules", fileKey);
      response.status(404).json({ error: "File materi tidak ditemukan." });
      return;
    }
    const required = isRequired !== false;
    await client.query(
      `UPDATE module_contents
       SET title = $1, description = $2, content_type = $3, body = NULL,
           external_url = NULL, file_key = $4, duration_minutes = $5, is_required = $6
       WHERE id = $7`,
      [title, description, uploaded.contentType, fileKey, durationMinutes, required, contentId],
    );
    await client.query("DELETE FROM module_requirements WHERE module_content_id = $1", [contentId]);
    if (required) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [previous.module_id, contentId],
      );
    }
    await client.query(
      `UPDATE student_content_progress
       SET status = 'NOT_STARTED', started_at = NULL, completed_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE module_content_id = $1`,
      [contentId],
    );
    await refreshModuleProgress(client, previous.module_id);
    await client.query("COMMIT");
    await deletePrivateFile("modules", previous.file_key).catch((cleanupError) => {
      console.error("File materi lama tidak dapat dibersihkan:", cleanupError);
    });
    response.json({ message: "File materi berhasil diperbarui." });
  } catch (error) {
    await client.query("ROLLBACK");
    await deletePrivateFile("modules", fileKey).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.put(
  "/contents/:contentId/upload",
  handleModuleUpload,
  async (request, response) => {
    const contentId = idFrom(request.params.contentId);
    const file = request.file;
    const uploaded = file ? parseUploadedFile(file) : null;
    const title = typeof request.body.title === "string" ? request.body.title.trim() : "";
    const description = typeof request.body.description === "string"
      ? request.body.description.trim() || null
      : null;
    const durationRaw = request.body.durationMinutes;
    const durationMinutes = durationRaw === undefined || durationRaw === ""
      ? null
      : typeof durationRaw === "string" && /^\d{1,4}$/.test(durationRaw)
        ? Number(durationRaw)
        : Number.NaN;
    const isRequired = request.body.isRequired !== "false";
    if (
      !contentId ||
      !file ||
      !uploaded ||
      title.length < 2 ||
      title.length > 180 ||
      (description !== null && description.length > 5000) ||
      (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) ||
      !["true", "false", undefined].includes(request.body.isRequired)
    ) {
      response.status(400).json({ error: "Data penggantian file materi tidak valid." });
      return;
    }

    const fileKey = `${randomUUID()}${uploaded.extension}`;
    const filePath = resolve(privateModuleStorageDirectory, fileKey);
    const client = await pool.connect();
    let fileWritten = false;
    try {
      await mkdir(privateModuleStorageDirectory, { recursive: true, mode: 0o700 });
      await chmod(privateModuleStorageDirectory, 0o700);
      await writeFile(filePath, file.buffer, { flag: "wx", mode: 0o600 });
      fileWritten = true;
      await client.query("BEGIN");
      const { rows } = await client.query<QueryResultRow & { module_id: string; file_key: string }>(
        `SELECT mc.module_id, mc.file_key
         FROM module_contents mc
         JOIN modules m ON m.id = mc.module_id
         JOIN classes c ON c.id = m.class_id
         WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
           AND m.is_active = TRUE AND c.is_active = TRUE AND c.teacher_id = $2
         FOR UPDATE OF mc`,
        [contentId, getUserId(response)],
      );
      const previous = rows[0];
      if (!previous) {
        await client.query("ROLLBACK");
        await unlink(filePath);
        fileWritten = false;
        response.status(404).json({ error: "File materi tidak ditemukan." });
        return;
      }
      await client.query(
        `UPDATE module_contents
         SET title = $1, description = $2, content_type = $3, body = NULL,
             external_url = NULL, file_key = $4, duration_minutes = $5, is_required = $6
         WHERE id = $7`,
        [title, description, uploaded.contentType, fileKey, durationMinutes, isRequired, contentId],
      );
      await client.query("DELETE FROM module_requirements WHERE module_content_id = $1", [contentId]);
      if (isRequired) {
        await client.query(
          "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
          [previous.module_id, contentId],
        );
      }
      await client.query(
        `UPDATE student_content_progress
         SET status = 'NOT_STARTED', started_at = NULL, completed_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE module_content_id = $1`,
        [contentId],
      );
      await refreshModuleProgress(client, previous.module_id);
      await client.query("COMMIT");
      fileWritten = false;
      try {
        await unlink(resolve(privateModuleStorageDirectory, previous.file_key));
      } catch (cleanupError) {
        if (!(typeof cleanupError === "object" && cleanupError !== null && "code" in cleanupError && cleanupError.code === "ENOENT")) {
          console.error("File materi lama tidak dapat dibersihkan:", cleanupError);
        }
      }
      response.json({ message: "File materi berhasil diperbarui." });
    } catch (error) {
      await client.query("ROLLBACK");
      if (fileWritten) await unlink(filePath);
      throw error;
    } finally {
      client.release();
    }
  },
);

teacherRouter.put("/contents/:contentId", async (request, response) => {
  const contentId = idFrom(request.params.contentId);
  const fields = parseContentFields(request.body);
  if (!contentId || !fields) {
    response.status(400).json({ error: "ID atau data materi tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<QueryResultRow & { module_id: string }>(
      `UPDATE module_contents mc
       SET title = $1, description = $2, content_type = $3, body = $4,
           external_url = $5, duration_minutes = $6, is_required = $7
       FROM modules m JOIN classes c ON c.id = m.class_id
       WHERE mc.id = $8 AND mc.module_id = m.id AND m.is_active = TRUE
         AND c.teacher_id = $9 AND c.is_active = TRUE AND mc.is_active = TRUE
       RETURNING mc.module_id`,
      [fields.title, fields.description, fields.contentType, fields.body, fields.externalUrl, fields.durationMinutes, fields.isRequired, contentId, getUserId(response)],
    );
    const content = result.rows[0];
    if (!content) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Materi tidak ditemukan." });
      return;
    }
    await client.query("DELETE FROM module_requirements WHERE module_content_id = $1", [contentId]);
    if (fields.isRequired) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [content.module_id, contentId],
      );
    }
    await client.query(
      `UPDATE student_content_progress
       SET status = 'NOT_STARTED', started_at = NULL, completed_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE module_content_id = $1`,
      [contentId],
    );
    await refreshModuleProgress(client, content.module_id);
    await client.query("COMMIT");
    response.json({ message: "Materi berhasil diperbarui." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.delete("/contents/:contentId", async (request, response) => {
  const contentId = idFrom(request.params.contentId);
  if (!contentId) {
    response.status(400).json({ error: "ID materi tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<QueryResultRow & { module_id: string }>(
      `UPDATE module_contents mc SET is_active = FALSE
       FROM modules m JOIN classes c ON c.id = m.class_id
       WHERE mc.id = $1 AND mc.module_id = m.id AND m.is_active = TRUE
         AND c.teacher_id = $2 AND c.is_active = TRUE AND mc.is_active = TRUE
       RETURNING mc.module_id`,
      [contentId, getUserId(response)],
    );
    const content = result.rows[0];
    if (!content) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Materi tidak ditemukan." });
      return;
    }
    await client.query("DELETE FROM module_requirements WHERE module_content_id = $1", [contentId]);
    await refreshModuleProgress(client, content.module_id);
    await client.query("COMMIT");
    response.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.get("/contents/:contentId/file", async (request, response) => {
  const contentId = idFrom(request.params.contentId);
  if (!contentId) {
    response.status(400).json({ error: "ID materi tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & { file_key: string; title: string }>(
    `SELECT mc.file_key, mc.title
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
       AND m.is_active = TRUE AND c.is_active = TRUE AND c.teacher_id = $2`,
    [contentId, getUserId(response)],
  );
  const file = rows[0];
  if (!file) {
    response.status(404).json({ error: "File materi tidak ditemukan." });
    return;
  }
  await sendPrivateFile(response, file.file_key, file.title);
});

const studentModuleQuery = `SELECT m.id, m.title, m.description, m.learning_objectives,
       m.position, m.duration_minutes, m.is_required,
       required_items.total AS required_count,
       completed_items.total AS completed_count,
       CASE WHEN required_items.total = 0 THEN 100
            ELSE ROUND(completed_items.total * 100.0 / required_items.total)::integer END AS progress_percent,
       (required_items.total = completed_items.total) AS is_complete,
       (previous_module.id IS NULL OR previous_module.is_complete = TRUE) AS is_unlocked,
       CASE
         WHEN previous_module.id IS NOT NULL AND previous_module.is_complete IS DISTINCT FROM TRUE THEN 'LOCKED'
         WHEN required_items.total = completed_items.total THEN 'COMPLETED'
         WHEN COALESCE(p.status, 'NOT_STARTED') IN ('IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED') THEN 'IN_PROGRESS'
         ELSE 'NOT_STARTED'
       END AS status
     FROM modules m
     JOIN classes c ON c.id = m.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     LEFT JOIN student_module_progress p ON p.module_id = m.id AND p.student_id = $2
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::integer AS total
       FROM module_contents mc
       WHERE mc.module_id = m.id AND mc.is_active = TRUE AND mc.is_required = TRUE
     ) content_required ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::integer AS total
       FROM assignments a
       WHERE a.module_id = m.id AND a.is_active = TRUE AND a.is_required = TRUE
     ) assignment_required ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::integer AS total
       FROM assessments a
       WHERE a.module_id = m.id AND a.is_active = TRUE AND a.is_required = TRUE
     ) assessment_required ON TRUE
     LEFT JOIN LATERAL (
       SELECT (content_required.total + assignment_required.total + assessment_required.total)::integer AS total
     ) required_items ON TRUE
     LEFT JOIN LATERAL (
       SELECT (
         (SELECT COUNT(*)::integer FROM module_contents mc
          JOIN student_content_progress scp ON scp.module_content_id = mc.id
            AND scp.student_id = $2 AND scp.status = 'COMPLETED'
          WHERE mc.module_id = m.id AND mc.is_active = TRUE AND mc.is_required = TRUE)
         + (SELECT COUNT(*)::integer FROM assignments a
            WHERE a.module_id = m.id AND a.is_active = TRUE AND a.is_required = TRUE
              AND EXISTS (SELECT 1 FROM assignment_submissions s
                          WHERE s.assignment_id = a.id AND s.student_id = $2))
         + (SELECT COUNT(*)::integer FROM assessments a
            WHERE a.module_id = m.id AND a.is_active = TRUE AND a.is_required = TRUE
              AND EXISTS (SELECT 1 FROM assessment_attempts aa
                          WHERE aa.assessment_id = a.id AND aa.student_id = $2
                            AND aa.status IN ('SUBMITTED', 'GRADED')))
       )::integer AS total
     ) completed_items ON TRUE
     LEFT JOIN LATERAL (
      SELECT prev.id, (prev_required.total = prev_completed.total) AS is_complete
       FROM modules prev
       LEFT JOIN LATERAL (
         SELECT (
           (SELECT COUNT(*)::integer FROM module_contents mc
            WHERE mc.module_id = prev.id AND mc.is_active = TRUE AND mc.is_required = TRUE)
           + (SELECT COUNT(*)::integer FROM assignments a
              WHERE a.module_id = prev.id AND a.is_active = TRUE AND a.is_required = TRUE)
           + (SELECT COUNT(*)::integer FROM assessments a
              WHERE a.module_id = prev.id AND a.is_active = TRUE AND a.is_required = TRUE)
         )::integer AS total
       ) prev_required ON TRUE
       LEFT JOIN LATERAL (
         SELECT (
           (SELECT COUNT(*)::integer FROM module_contents mc
            JOIN student_content_progress scp ON scp.module_content_id = mc.id
              AND scp.student_id = $2 AND scp.status = 'COMPLETED'
            WHERE mc.module_id = prev.id AND mc.is_active = TRUE AND mc.is_required = TRUE)
           + (SELECT COUNT(*)::integer FROM assignments a
              WHERE a.module_id = prev.id AND a.is_active = TRUE AND a.is_required = TRUE
                AND EXISTS (SELECT 1 FROM assignment_submissions s
                            WHERE s.assignment_id = a.id AND s.student_id = $2))
           + (SELECT COUNT(*)::integer FROM assessments a
              WHERE a.module_id = prev.id AND a.is_active = TRUE AND a.is_required = TRUE
                AND EXISTS (SELECT 1 FROM assessment_attempts aa
                            WHERE aa.assessment_id = a.id AND aa.student_id = $2
                              AND aa.status IN ('SUBMITTED', 'GRADED')))
         )::integer AS total
       ) prev_completed ON TRUE
       WHERE prev.class_id = m.class_id AND prev.is_active = TRUE AND prev.position < m.position
       ORDER BY prev.position DESC
       LIMIT 1
     ) previous_module ON TRUE
     WHERE m.class_id = $1 AND m.is_active = TRUE AND c.is_active = TRUE
     ORDER BY m.position`;

studentRouter.get("/classes", async (_request, response) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, sub.name AS subject
     FROM classes c
     JOIN subjects sub ON sub.id = c.subject_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.is_active = TRUE
     WHERE cs.student_id = $1 AND c.is_active = TRUE
     ORDER BY c.academic_year DESC, c.name`,
    [getUserId(response)],
  );
  response.json({ classes: rows });
});

studentRouter.get("/classes/:classId/modules", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows } = await pool.query<LearningModuleRow>(studentModuleQuery, [classId, getUserId(response)]);
  if (rows.length === 0) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM classes c JOIN class_students cs ON cs.class_id = c.id
       WHERE c.id = $1 AND c.is_active = TRUE AND cs.student_id = $2 AND cs.is_active = TRUE`,
      [classId, getUserId(response)],
    );
    if (rowCount !== 1) {
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
  }
  response.json({
    modules: rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      learningObjectives: row.learning_objectives,
      position: row.position,
      durationMinutes: row.duration_minutes,
      isRequired: row.is_required,
      requiredCount: Number(row.required_count),
      completedCount: Number(row.completed_count),
      progress: Number(row.progress_percent),
      completed: row.is_complete,
      unlocked: row.is_unlocked,
      status: row.status,
    })),
  });
});

studentRouter.get("/modules/:moduleId/contents", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  if (!moduleId) {
    response.status(400).json({ error: "ID modul tidak valid." });
    return;
  }
  const { rows: modules } = await pool.query<LearningModuleRow>(studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"), [moduleId, getUserId(response)]);
  const module = modules.find((item) => item.id === moduleId);
  if (!module) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  if (!module.is_unlocked) {
    response.status(423).json({ error: "Selesaikan modul sebelumnya untuk membuka modul ini.", code: "MODULE_LOCKED" });
    return;
  }
  const { rows } = await pool.query<ContentRow>(
    `SELECT mc.id, mc.module_id, mc.title, mc.description, mc.content_type,
            mc.body, mc.external_url, mc.file_key, mc.position, mc.duration_minutes, mc.is_required,
            lg.id AS game_id,
            COALESCE(scp.status = 'COMPLETED', FALSE) AS completed
     FROM module_contents mc
     LEFT JOIN learning_games lg ON lg.module_content_id = mc.id AND lg.is_active = TRUE
     LEFT JOIN student_content_progress scp
       ON scp.module_content_id = mc.id AND scp.student_id = $2
     WHERE mc.module_id = $1 AND mc.is_active = TRUE
     ORDER BY mc.position`,
    [moduleId, getUserId(response)],
  );
  response.json({
    contents: rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      contentType: row.content_type,
      body: row.body,
      externalUrl: row.external_url,
      fileUrl: row.file_key ? `/api/learning/contents/${row.id}/file` : null,
      position: row.position,
      durationMinutes: row.duration_minutes,
      isRequired: row.is_required,
      gameId: row.game_id,
      completed: row.completed,
    })),
  });
});

studentRouter.get("/contents/:contentId/file", async (request, response) => {
  const contentId = idFrom(request.params.contentId);
  if (!contentId) {
    response.status(400).json({ error: "ID materi tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & { module_id: string; file_key: string; title: string }>(
    `SELECT mc.module_id, mc.file_key, mc.title
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
       AND m.is_active = TRUE AND c.is_active = TRUE`,
    [contentId, getUserId(response)],
  );
  const file = rows[0];
  if (!file) {
    response.status(404).json({ error: "File materi tidak ditemukan." });
    return;
  }
  const { rows: modules } = await pool.query<LearningModuleRow>(
    studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"),
    [file.module_id, getUserId(response)],
  );
  const module = modules.find((item) => item.id === file.module_id);
  if (!module || !module.is_unlocked) {
    response.status(423).json({ error: "Modul terkunci. Selesaikan modul sebelumnya terlebih dahulu.", code: "MODULE_LOCKED" });
    return;
  }
  await sendPrivateFile(response, file.file_key, file.title);
});

studentRouter.post("/modules/:moduleId/open", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  if (!moduleId) {
    response.status(400).json({ error: "ID modul tidak valid." });
    return;
  }
  const { rows: modules } = await pool.query<LearningModuleRow>(
    studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"),
    [moduleId, getUserId(response)],
  );
  const module = modules.find((item) => item.id === moduleId);
  if (!module) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  if (!module.is_unlocked) {
    response.status(423).json({ error: "Selesaikan modul sebelumnya untuk membuka modul ini.", code: "MODULE_LOCKED" });
    return;
  }
  await pool.query(
    `INSERT INTO student_module_progress
       (student_id, module_id, status, progress_percent, started_at, completed_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP,
             CASE WHEN $3 = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT (student_id, module_id) DO UPDATE
     SET status = EXCLUDED.status,
         progress_percent = EXCLUDED.progress_percent,
         started_at = COALESCE(student_module_progress.started_at, CURRENT_TIMESTAMP),
         completed_at = EXCLUDED.completed_at,
         updated_at = CURRENT_TIMESTAMP`,
    [getUserId(response), moduleId, module.is_complete ? "COMPLETED" : "IN_PROGRESS", Number(module.progress)],
  );
  await pool.query(
    `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
     VALUES ($1, 'MODULE_OPENED', 'MODULE', $2)`,
    [getUserId(response), moduleId],
  );
  response.json({ moduleId, status: module.is_complete ? "COMPLETED" : "IN_PROGRESS" });
});

studentRouter.post("/contents/:contentId/complete", async (request, response) => {
  const contentId = idFrom(request.params.contentId);
  if (!contentId) {
    response.status(400).json({ error: "ID materi tidak valid." });
    return;
  }
  const { rows } = await pool.query<ContentRow & { started_at: Date | null }>(
    `SELECT mc.id, mc.module_id, mc.title, mc.description, mc.content_type,
            mc.body, mc.external_url, mc.file_key, mc.position, mc.duration_minutes, mc.is_required,
            lg.id AS game_id,
            scp.started_at, COALESCE(scp.status = 'COMPLETED', FALSE) AS completed
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     LEFT JOIN student_content_progress scp
       ON scp.module_content_id = mc.id AND scp.student_id = $2
     LEFT JOIN learning_games lg ON lg.module_content_id = mc.id AND lg.is_active = TRUE
     WHERE mc.id = $1 AND mc.is_active = TRUE AND m.is_active = TRUE AND c.is_active = TRUE`,
    [contentId, getUserId(response)],
  );
  const content = rows[0];
  if (!content) {
    response.status(404).json({ error: "Materi tidak ditemukan." });
    return;
  }
  const { rows: moduleRows } = await pool.query<LearningModuleRow>(
    studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"),
    [content.module_id, getUserId(response)],
  );
  const module = moduleRows.find((item) => item.id === content.module_id);
  if (!module || !module.is_unlocked) {
    response.status(423).json({ error: "Modul terkunci. Selesaikan modul sebelumnya terlebih dahulu.", code: "MODULE_LOCKED" });
    return;
  }
  if (content.completed) {
    response.json({ progress: Number(module.progress), moduleCompleted: module.is_complete });
    return;
  }
  if (["GAME", "QUIZ"].includes(content.content_type)) {
    response.status(409).json({ error: "Materi ini harus diselesaikan melalui aktivitas interaktifnya." });
    return;
  }
  if (!content.started_at) {
    response.status(409).json({ error: "Buka materi terlebih dahulu sebelum menyelesaikannya." });
    return;
  }
  const requiredSeconds = content.duration_minutes
    ? content.duration_minutes * 60
    : 10;
  const elapsedSeconds = (Date.now() - new Date(content.started_at).getTime()) / 1000;
  if (elapsedSeconds < requiredSeconds) {
    response.status(409).json({
      error: `Materi perlu dipelajari minimal ${Math.ceil(requiredSeconds - elapsedSeconds)} detik lagi.`,
      code: "CONTENT_DURATION_REQUIRED",
    });
    return;
  }

  await pool.query(
    `UPDATE student_content_progress
     SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE student_id = $1 AND module_content_id = $2`,
    [getUserId(response), contentId],
  );
  const { rows: progressRows } = await pool.query<QueryResultRow & { progress: number; completed: boolean }>(
    `WITH required_items AS (
       SELECT (
         (SELECT COUNT(*) FROM module_contents WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE)
         + (SELECT COUNT(*) FROM assignments WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE)
         + (SELECT COUNT(*) FROM assessments WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE)
       )::integer AS total
     ), completed_items AS (
       SELECT (
         (SELECT COUNT(*) FROM module_contents mc
          JOIN student_content_progress scp ON scp.module_content_id = mc.id
            AND scp.student_id = $1 AND scp.status = 'COMPLETED'
          WHERE mc.module_id = $2 AND mc.is_active = TRUE AND mc.is_required = TRUE)
         + (SELECT COUNT(*) FROM assignments a
            WHERE a.module_id = $2 AND a.is_active = TRUE AND a.is_required = TRUE
              AND EXISTS (SELECT 1 FROM assignment_submissions s
                          WHERE s.assignment_id = a.id AND s.student_id = $1))
         + (SELECT COUNT(*) FROM assessments a
            WHERE a.module_id = $2 AND a.is_active = TRUE AND a.is_required = TRUE
              AND EXISTS (SELECT 1 FROM assessment_attempts aa
                          WHERE aa.assessment_id = a.id AND aa.student_id = $1
                            AND aa.status IN ('SUBMITTED', 'GRADED')))
       )::integer AS total
     )
     SELECT CASE WHEN required_items.total = 0 THEN 100
                 ELSE ROUND(completed_items.total * 100.0 / required_items.total)::integer END AS progress,
            (required_items.total = completed_items.total) AS completed
     FROM required_items, completed_items`,
    [getUserId(response), content.module_id],
  );
  const current = progressRows[0];
  if (!current) throw new Error("Status progres modul tidak dapat dihitung.");
  await pool.query(
    `INSERT INTO student_module_progress
       (student_id, module_id, status, progress_percent, started_at, completed_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CASE WHEN $3 = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT (student_id, module_id) DO UPDATE
     SET status = $3, progress_percent = $4,
         completed_at = CASE WHEN $3 = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP`,
    [getUserId(response), content.module_id, current.completed ? "COMPLETED" : "IN_PROGRESS", current.progress],
  );
  if (current.completed) {
    await pool.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'MODULE_COMPLETED', 'MODULE', $2)`,
      [getUserId(response), content.module_id],
    );
  }
  response.json({ progress: current.progress, moduleCompleted: current.completed });
});

studentRouter.post("/modules/:moduleId/contents/:contentId/open", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  const contentId = idFrom(request.params.contentId);
  if (!moduleId || !contentId) {
    response.status(400).json({ error: "ID modul atau materi tidak valid." });
    return;
  }
  const { rows: modules } = await pool.query<LearningModuleRow>(
    studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"),
    [moduleId, getUserId(response)],
  );
  const module = modules.find((item) => item.id === moduleId);
  if (!module) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  if (!module.is_unlocked) {
    response.status(423).json({ error: "Selesaikan modul sebelumnya untuk membuka modul ini.", code: "MODULE_LOCKED" });
    return;
  }
  const { rows: contents } = await pool.query<ContentRow>(
    `SELECT mc.id, mc.module_id, mc.title, mc.description, mc.content_type,
          mc.body, mc.external_url, mc.file_key, mc.position, mc.duration_minutes, mc.is_required
     FROM module_contents mc
     WHERE mc.id = $1 AND mc.module_id = $2 AND mc.is_active = TRUE`,
    [contentId, moduleId],
  );
  const content = contents[0];
  if (!content) {
    response.status(404).json({ error: "Materi tidak ditemukan." });
    return;
  }
  await pool.query(
    `INSERT INTO student_content_progress (student_id, module_content_id, status, started_at)
     VALUES ($1, $2, 'IN_PROGRESS', CURRENT_TIMESTAMP)
     ON CONFLICT (student_id, module_content_id) DO UPDATE
     SET started_at = COALESCE(student_content_progress.started_at, CURRENT_TIMESTAMP),
         status = CASE WHEN student_content_progress.status = 'COMPLETED'
                       THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,
         updated_at = CURRENT_TIMESTAMP`,
    [getUserId(response), contentId],
  );
  response.json({
    content: {
      id: content.id,
      title: content.title,
      description: content.description,
      contentType: content.content_type,
      body: content.body,
      externalUrl: content.external_url,
      fileUrl: content.file_key ? `/api/learning/contents/${content.id}/file` : null,
      durationMinutes: content.duration_minutes,
      isRequired: content.is_required,
      position: content.position,
      completed: content.completed,
      startedAt: content.started_at,
      gameId: content.game_id,
    },
  });
});

export { studentRouter as studentModulesRouter, teacherRouter as teacherModulesRouter };
