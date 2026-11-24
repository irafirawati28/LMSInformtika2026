import { Router, type Response } from "express";
import type { QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import { requireStudent } from "../../middleware/require-student.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";

type AnnouncementRow = QueryResultRow & {
  id: string;
  class_id: string | null;
  class_name: string | null;
  title: string;
  body: string;
  published_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type AnnouncementInput = {
  classId: string | null;
  title: string;
  body: string;
  publishedAt: string | null;
};

const teacherRouter = Router();
const studentRouter = Router();
teacherRouter.use("/announcements", requireTeacher);
studentRouter.use("/announcements", requireStudent);

const idFrom = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;

const userIdFrom = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const parseAnnouncement = (body: unknown): AnnouncementInput | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const classId = value.classId === null ? null : idFrom(value.classId);
  if (
    (value.classId !== null && !classId) ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    (value.publishedAt !== null && typeof value.publishedAt !== "string")
  ) return null;

  const title = value.title.trim();
  const text = value.body.trim();
  let publishedAt: string | null = null;
  if (typeof value.publishedAt === "string") {
    const date = new Date(value.publishedAt);
    if (Number.isNaN(date.getTime())) return null;
    publishedAt = date.toISOString();
  }

  if (title.length < 3 || title.length > 180 || text.length < 1 || text.length > 10000) {
    return null;
  }
  return { classId, title, body: text, publishedAt };
};

const toAnnouncement = (row: AnnouncementRow) => ({
  id: row.id,
  classId: row.class_id,
  className: row.class_name,
  title: row.title,
  body: row.body,
  publishedAt: row.published_at,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const classBelongsToTeacher = async (classId: string, teacherId: string): Promise<boolean> => {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, teacherId],
  );
  return rowCount === 1;
};

teacherRouter.get("/announcements", async (_request, response) => {
  const { rows } = await pool.query<AnnouncementRow>(
    `SELECT a.id, a.class_id, c.name AS class_name, a.title, a.body,
            a.published_at, a.is_active, a.created_at, a.updated_at
     FROM announcements a
     LEFT JOIN classes c ON c.id = a.class_id
     WHERE a.created_by = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [userIdFrom(response)],
  );
  response.json({ announcements: rows.map(toAnnouncement) });
});

teacherRouter.post("/announcements", async (request, response) => {
  const input = parseAnnouncement(request.body);
  if (!input) {
    response.status(400).json({ error: "Judul, isi, cakupan kelas, atau waktu terbit tidak valid." });
    return;
  }
  const teacherId = userIdFrom(response);
  if (input.classId && !await classBelongsToTeacher(input.classId, teacherId)) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & { id: string }>(
    `INSERT INTO announcements (class_id, created_by, title, body, published_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz)
     RETURNING id`,
    [input.classId, teacherId, input.title, input.body, input.publishedAt],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Database tidak mengembalikan ID pengumuman.");
  response.status(201).json({ id });
});

teacherRouter.put("/announcements/:announcementId", async (request, response) => {
  const announcementId = idFrom(request.params.announcementId);
  const input = parseAnnouncement(request.body);
  if (!announcementId || !input) {
    response.status(400).json({ error: "ID atau data pengumuman tidak valid." });
    return;
  }
  const teacherId = userIdFrom(response);
  if (input.classId && !await classBelongsToTeacher(input.classId, teacherId)) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rowCount } = await pool.query(
    `UPDATE announcements
     SET class_id = $1, title = $2, body = $3, published_at = $4::timestamptz
     WHERE id = $5 AND created_by = $6 AND is_active = TRUE`,
    [input.classId, input.title, input.body, input.publishedAt, announcementId, teacherId],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Pengumuman tidak ditemukan." });
    return;
  }
  response.json({ message: "Pengumuman berhasil diperbarui." });
});

teacherRouter.delete("/announcements/:announcementId", async (request, response) => {
  const announcementId = idFrom(request.params.announcementId);
  if (!announcementId) {
    response.status(400).json({ error: "ID pengumuman tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    `UPDATE announcements SET is_active = FALSE
     WHERE id = $1 AND created_by = $2 AND is_active = TRUE`,
    [announcementId, userIdFrom(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Pengumuman tidak ditemukan." });
    return;
  }
  response.status(204).end();
});

studentRouter.get("/announcements", async (_request, response) => {
  const { rows } = await pool.query<AnnouncementRow & { teacher_name: string }>(
    `SELECT a.id, a.class_id, c.name AS class_name, a.title, a.body,
            a.published_at, a.is_active, a.created_at, a.updated_at,
            t.full_name AS teacher_name
     FROM announcements a
     JOIN teachers t ON t.user_id = a.created_by
     LEFT JOIN classes c ON c.id = a.class_id
     WHERE a.is_active = TRUE
       AND a.published_at IS NOT NULL AND a.published_at <= CURRENT_TIMESTAMP
       AND (
         a.class_id IS NULL
         OR EXISTS (
           SELECT 1 FROM class_students cs
           JOIN classes enrolled_class ON enrolled_class.id = cs.class_id
           WHERE cs.class_id = a.class_id AND cs.student_id = $1
             AND cs.is_active = TRUE AND enrolled_class.is_active = TRUE
         )
       )
     ORDER BY a.published_at DESC, a.id DESC`,
    [userIdFrom(response)],
  );
  response.json({
    announcements: rows.map((row) => ({ ...toAnnouncement(row), teacherName: row.teacher_name })),
  });
});

export {
  studentRouter as studentAnnouncementsRouter,
  teacherRouter as teacherAnnouncementsRouter,
};
