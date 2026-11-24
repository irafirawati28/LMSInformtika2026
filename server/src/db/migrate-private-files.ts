import { extname } from "node:path";
import type { QueryResultRow } from "pg";
import { pool } from "./pool.js";
import {
  createPrivateFileKey,
  deletePrivateFile,
  isPrivateSupabaseStorageEnabled,
  readPrivateFile,
  writePrivateFile,
} from "../shared/private-storage.js";

type LocalModuleFile = QueryResultRow & {
  id: string;
  file_key: string;
  teacher_id: string;
};

type LocalAssignmentFile = QueryResultRow & {
  id: string;
  file_key: string;
  student_id: string;
};

const contentTypeFor = (fileKey: string): string => {
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

const migrateFiles = async (): Promise<void> => {
  if (!isPrivateSupabaseStorageEnabled()) {
    throw new Error("Atur SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sebelum migrasi.");
  }

  const [moduleResult, assignmentResult] = await Promise.all([
    pool.query<LocalModuleFile>(
      `SELECT mc.id, mc.file_key, c.teacher_id
       FROM module_contents mc
       JOIN modules m ON m.id = mc.module_id
       JOIN classes c ON c.id = m.class_id
       WHERE mc.file_key IS NOT NULL AND mc.file_key NOT LIKE 'supabase:%'`,
    ),
    pool.query<LocalAssignmentFile>(
      `SELECT s.id, s.file_key, s.student_id
       FROM assignment_submissions s
       WHERE s.file_key IS NOT NULL AND s.file_key NOT LIKE 'supabase:%'`,
    ),
  ]);

  let migrated = 0;
  let failed = 0;
  const migrateOne = async (
    area: "modules" | "assignments",
    ownerId: string,
    rowId: string,
    oldKey: string,
    updateSql: string,
  ): Promise<void> => {
    let newKey: string | null = null;
    let databaseUpdated = false;
    try {
      const contents = await readPrivateFile(area, oldKey);
      newKey = createPrivateFileKey(area, ownerId, extname(oldKey));
      await writePrivateFile(area, newKey, contents, contentTypeFor(oldKey));
      const result = await pool.query(updateSql, [newKey, rowId, oldKey]);
      if (result.rowCount !== 1) throw new Error("Referensi database berubah saat migrasi.");
      databaseUpdated = true;
      migrated += 1;
      await deletePrivateFile(area, oldKey).catch((cleanupError) => {
        console.error(`Salinan lokal file ${area} ID ${rowId} tidak dapat dihapus:`, cleanupError);
      });
    } catch (error) {
      failed += 1;
      if (newKey && !databaseUpdated) await deletePrivateFile(area, newKey).catch(() => undefined);
      console.error(`File ${area} ID ${rowId} gagal dimigrasikan:`, error);
    }
  };

  for (const file of moduleResult.rows) {
    await migrateOne(
      "modules",
      file.teacher_id,
      file.id,
      file.file_key,
      "UPDATE module_contents SET file_key = $1 WHERE id = $2 AND file_key = $3",
    );
  }
  for (const file of assignmentResult.rows) {
    await migrateOne(
      "assignments",
      file.student_id,
      file.id,
      file.file_key,
      "UPDATE assignment_submissions SET file_key = $1 WHERE id = $2 AND file_key = $3",
    );
  }

  console.info(`Migrasi selesai: ${migrated} file dipindah, ${failed} gagal.`);
  if (failed > 0) process.exitCode = 1;
};

try {
  await migrateFiles();
} catch (error) {
  console.error("Migrasi file privat gagal:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
