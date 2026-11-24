// src/app.ts
import express from "express";
import helmet from "helmet";
import session2 from "express-session";

// src/modules/auth/auth.routes.ts
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";

// src/db/pool.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, types } from "pg";

// src/config/app-config.ts
import "dotenv/config";
var parsePort = (value, name, fallback) => {
  if (value === void 0 || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} harus berupa bilangan bulat antara 1 dan 65535.`);
  }
  return parsed;
};
var sessionSecret = process.env.SESSION_SECRET || "fallback-secret-at-least-32-chars-long-security-key";
if (!process.env.SESSION_SECRET) {
  console.warn("PERINGATAN: SESSION_SECRET belum diatur di environment variables. Menggunakan fallback.");
}
var rawFrontendOrigin = (process.env.FRONTEND_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173")).trim().replace(/\/+$/, "");
var parsedFrontendOrigin;
try {
  parsedFrontendOrigin = new URL(rawFrontendOrigin);
} catch {
  parsedFrontendOrigin = new URL("http://localhost:5173");
}
var frontendOrigin = parsedFrontendOrigin.origin;
var databaseUrl = process.env.DATABASE_URL;
var databaseCaCert = process.env.DATABASE_CA_CERT;
var databaseCaCertBase64 = process.env.DATABASE_CA_CERT_BASE64;
var supabaseUrl = process.env.SUPABASE_URL;
var supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
var supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "lms-private";
if (databaseUrl) {
  let parsedDatabaseUrl;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL harus berupa connection string PostgreSQL yang valid.");
  }
  if (parsedDatabaseUrl.protocol !== "postgres:" && parsedDatabaseUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL harus menggunakan protokol PostgreSQL.");
  }
}
if (Boolean(supabaseUrl) !== Boolean(supabaseServiceRoleKey)) {
  console.warn("PERINGATAN: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sebaiknya diatur bersama.");
}
if (supabaseUrl) {
  let parsedSupabaseUrl;
  try {
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL harus berupa URL yang valid.");
  }
  if (parsedSupabaseUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL harus menggunakan HTTPS.");
  }
}
if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(supabaseStorageBucket)) {
  throw new Error("SUPABASE_STORAGE_BUCKET tidak valid.");
}
if (process.env.NODE_ENV === "production" && (!supabaseUrl || !supabaseServiceRoleKey)) {
  console.warn("PERINGATAN: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diatur di production.");
}
var appConfig = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePort(process.env.PORT, "PORT", 3e3),
  frontendOrigin,
  sessionSecret,
  databaseUrl,
  databaseCaCert,
  databaseCaCertBase64,
  databaseSsl: process.env.DATABASE_SSL === "true",
  supabaseUrl,
  supabaseServiceRoleKey,
  supabaseStorageBucket
};

// src/db/pool.ts
if (!appConfig.databaseUrl) {
  console.error("PERINGATAN: DATABASE_URL belum diatur di environment variables.");
}
var isProduction = appConfig.nodeEnv === "production";
var useSsl = appConfig.databaseSsl || isProduction;
types.setTypeParser(20, (value) => value);
var defaultDbUrl = "postgresql://localhost:5432/postgres";
var databaseUrl2 = new URL(appConfig.databaseUrl || defaultDbUrl);
var caCertPath = appConfig.databaseCaCert ?? databaseUrl2.searchParams.get("sslrootcert");
var serverRoot = fileURLToPath(new URL("../../", import.meta.url));
var ca;
if (appConfig.databaseCaCertBase64) {
  try {
    ca = Buffer.from(appConfig.databaseCaCertBase64, "base64").toString("utf8");
  } catch (error) {
    console.error("Gagal mengurai DATABASE_CA_CERT_BASE64:", error);
  }
} else if (caCertPath) {
  try {
    ca = readFileSync(resolve(serverRoot, caCertPath), "utf8");
  } catch {
    ca = void 0;
  }
}
for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
  databaseUrl2.searchParams.delete(parameter);
}
var pool = new Pool({
  connectionString: databaseUrl2.toString(),
  ssl: useSsl ? ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 3e4,
  connectionTimeoutMillis: 2e4
});

// src/middleware/require-auth.ts
var requireSession = async (request, response, next) => {
  const auth = request.session.auth;
  if (!auth) {
    response.status(401).json({ error: "Silakan login untuk melanjutkan." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT is_active, must_change_password, auth_version
     FROM users WHERE id = $1 LIMIT 1`,
    [auth.userId]
  );
  const user = rows[0];
  if (!user || !user.is_active || Number(user.auth_version) !== auth.authVersion) {
    await new Promise((resolve5, reject) => {
      request.session.destroy((error) => error ? reject(error) : resolve5());
    });
    response.clearCookie("kanal.sid");
    response.status(401).json({ error: "Sesi tidak lagi berlaku. Silakan login kembali." });
    return;
  }
  response.locals.authUser = {
    id: auth.userId,
    username: auth.username,
    role: auth.role,
    mustChangePassword: Boolean(user.must_change_password)
  };
  next();
};
var requireAuthenticated = (request, response, next) => {
  void requireSession(request, response, (error) => {
    if (error) {
      next(error);
      return;
    }
    const user = response.locals.authUser;
    if (!user) {
      return;
    }
    if (user.mustChangePassword) {
      response.status(403).json({
        error: "Ganti password awal sebelum mengakses fitur lainnya.",
        code: "PASSWORD_CHANGE_REQUIRED"
      });
      return;
    }
    next();
  }).catch(next);
};

// src/modules/auth/auth.routes.ts
var parseEditableProfile = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body;
  if (typeof value.fullName !== "string" || value.email !== null && typeof value.email !== "string" || value.phone !== null && typeof value.phone !== "string") return null;
  const fullName = value.fullName.trim();
  const email = typeof value.email === "string" ? value.email.trim() || null : null;
  const phone = typeof value.phone === "string" ? value.phone.trim() || null : null;
  if (fullName.length < 2 || fullName.length > 150 || email !== null && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || phone !== null && (phone.length > 32 || !/^[+\d().\-\s]+$/.test(phone))) return null;
  return { fullName, email, phone };
};
var router = Router();
var loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan login. Coba kembali beberapa menit lagi." }
});
var dummyHashPromise = bcrypt.hash(randomBytes(32).toString("hex"), 12);
var passwordIsValid = (password) => typeof password === "string" && password.length > 0 && Buffer.byteLength(password, "utf8") <= 72;
var finishSessionMutation = async (request, user) => new Promise((resolve5, reject) => {
  request.session.regenerate((error) => {
    if (error) {
      reject(error);
      return;
    }
    request.session.auth = {
      userId: user.id,
      username: user.username,
      role: user.role,
      authVersion: user.authVersion
    };
    request.session.save((saveError) => saveError ? reject(saveError) : resolve5());
  });
});
router.post("/login", loginLimiter, async (request, response) => {
  const { username, password, role } = request.body;
  if (typeof username !== "string" || username.trim().length === 0 || username.trim().length > 32 || !passwordIsValid(password) || role !== "TEACHER" && role !== "STUDENT") {
    response.status(400).json({ error: "Data login tidak valid." });
    return;
  }
  const normalizedUsername = username.trim();
  if (role === "STUDENT" && !/^\d{10}$/.test(normalizedUsername)) {
    response.status(400).json({ error: "NISN harus terdiri dari 10 angka." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.password_hash, u.role, u.must_change_password,
            u.auth_version, COALESCE(t.full_name, s.full_name) AS full_name
     FROM users u
     LEFT JOIN teachers t ON t.user_id = u.id
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.username = $1 AND u.role = $2 AND u.is_active = TRUE
     LIMIT 1`,
    [normalizedUsername, role]
  );
  const user = rows[0];
  const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? await dummyHashPromise);
  if (!user || !passwordMatches) {
    response.status(401).json({ error: "NIP/NISN atau password tidak sesuai." });
    return;
  }
  await pool.query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
  await finishSessionMutation(request, {
    id: user.id,
    username: user.username,
    role: user.role,
    authVersion: Number(user.auth_version)
  });
  response.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      mustChangePassword: Boolean(user.must_change_password)
    }
  });
});
router.get("/me", requireSession, async (_request, response) => {
  const authUser = response.locals.authUser;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.role, u.must_change_password,
            COALESCE(t.full_name, s.full_name) AS full_name
     FROM users u
     LEFT JOIN teachers t ON t.user_id = u.id
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [authUser.id]
  );
  const user = rows[0];
  if (!user) {
    response.status(401).json({ error: "Akun tidak ditemukan." });
    return;
  }
  response.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      mustChangePassword: Boolean(user.must_change_password)
    }
  });
});
router.get("/profile", requireAuthenticated, async (_request, response) => {
  const authUser = response.locals.authUser;
  if (authUser.role === "TEACHER") {
    const { rows: rows2 } = await pool.query(
      `SELECT t.nip, t.full_name, t.email, t.phone
       FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = $1 AND u.is_active = TRUE`,
      [authUser.id]
    );
    const profile2 = rows2[0];
    if (!profile2) {
      response.status(404).json({ error: "Profil guru tidak ditemukan." });
      return;
    }
    response.json({
      profile: {
        role: authUser.role,
        username: authUser.username,
        identifier: profile2.nip,
        fullName: profile2.full_name,
        email: profile2.email,
        phone: profile2.phone,
        schoolClass: null
      }
    });
    return;
  }
  const { rows } = await pool.query(
    `SELECT s.nisn, s.full_name, s.email, s.phone, s.school_class
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.user_id = $1 AND u.is_active = TRUE`,
    [authUser.id]
  );
  const profile = rows[0];
  if (!profile) {
    response.status(404).json({ error: "Profil siswa tidak ditemukan." });
    return;
  }
  response.json({
    profile: {
      role: authUser.role,
      username: authUser.username,
      identifier: profile.nisn.trim(),
      fullName: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      schoolClass: profile.school_class
    }
  });
});
router.put("/profile", requireAuthenticated, async (request, response) => {
  const profile = parseEditableProfile(request.body);
  if (!profile) {
    response.status(400).json({ error: "Nama, email, atau nomor telepon tidak valid." });
    return;
  }
  const authUser = response.locals.authUser;
  const table = authUser.role === "TEACHER" ? "teachers" : "students";
  const { rowCount } = await pool.query(
    `UPDATE ${table}
     SET full_name = $1, email = $2, phone = $3
     WHERE user_id = $4`,
    [profile.fullName, profile.email, profile.phone, authUser.id]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Profil tidak ditemukan." });
    return;
  }
  response.json({ message: "Profil berhasil diperbarui.", fullName: profile.fullName });
});
router.post("/change-password", requireSession, async (request, response) => {
  const { currentPassword, newPassword } = request.body;
  if (!passwordIsValid(currentPassword) || !passwordIsValid(newPassword)) {
    response.status(400).json({ error: "Password harus berisi 1 sampai 72 byte." });
    return;
  }
  if (newPassword.length < 6) {
    response.status(400).json({ error: "Password baru minimal 6 karakter." });
    return;
  }
  if (currentPassword === newPassword) {
    response.status(400).json({ error: "Password baru harus berbeda dari password saat ini." });
    return;
  }
  const authUser = response.locals.authUser;
  const { rows } = await pool.query(
    "SELECT password_hash, auth_version FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1",
    [authUser.id]
  );
  const user = rows[0];
  if (!user || !await bcrypt.compare(currentPassword, user.password_hash)) {
    response.status(400).json({ error: "Password saat ini tidak sesuai." });
    return;
  }
  const newPasswordHash = await bcrypt.hash(newPassword, 12);
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = FALSE, auth_version = auth_version + 1
     WHERE id = $2 AND auth_version = $3`,
    [newPasswordHash, authUser.id, user.auth_version]
  );
  if (result.rowCount !== 1) {
    response.status(409).json({ error: "Akun berubah. Silakan login kembali." });
    return;
  }
  const updatedUser = {
    id: authUser.id,
    username: authUser.username,
    role: authUser.role,
    authVersion: Number(user.auth_version) + 1
  };
  await finishSessionMutation(request, updatedUser);
  response.json({ message: "Password berhasil diperbarui." });
});
router.post("/logout", async (request, response) => {
  if (!request.session) {
    response.clearCookie("kanal.sid");
    response.status(204).end();
    return;
  }
  await new Promise((resolve5, reject) => {
    request.session.destroy((error) => error ? reject(error) : resolve5());
  });
  response.clearCookie("kanal.sid");
  response.status(204).end();
});

// src/modules/dashboard/dashboard.routes.ts
import { Router as Router2 } from "express";
var router2 = Router2();
var toNumber = (value) => Number(value);
router2.get("/", requireAuthenticated, async (_request, response) => {
  const user = response.locals.authUser;
  if (user.role === "TEACHER") {
    const [overviewResult, gradeResult2, activityResult2] = await Promise.all([
      pool.query(
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
        [user.id, user.id, user.id, user.id, user.id, user.id, user.id]
      ),
      pool.query(
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
        [user.id]
      ),
      pool.query(
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
        [user.id]
      )
    ]);
    const overviewRows = overviewResult.rows;
    const gradeRows2 = gradeResult2.rows;
    const activityRows2 = activityResult2.rows;
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
        attendanceRate: toNumber(overview.total_attendance_records) === 0 ? 0 : Math.round(
          toNumber(overview.present_records) / toNumber(overview.total_attendance_records) * 100
        )
      },
      gradeTrend: gradeRows2.map((row) => ({
        month: row.month,
        averageScore: toNumber(row.average_score)
      })),
      recentActivities: activityRows2.map((activity) => ({
        id: activity.id,
        type: activity.event_type,
        name: activity.full_name,
        at: activity.created_at
      }))
    });
    return;
  }
  const [
    classResult,
    assignmentResult,
    gradeResult,
    attendanceResult,
    activityResult,
    progressResult
  ] = await Promise.all([
    pool.query(
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
      [user.id]
    ),
    pool.query(
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
      [user.id]
    ),
    pool.query(
      `SELECT g.id, COALESCE(a.title, ass.title) AS title, g.score, g.max_score, g.graded_at
         FROM grades g
         LEFT JOIN assignment_submissions sub ON sub.id = g.assignment_submission_id
         LEFT JOIN assignments a ON a.id = sub.assignment_id
         LEFT JOIN assessment_attempts aa ON aa.id = g.assessment_attempt_id
         LEFT JOIN assessments ass ON ass.id = aa.assessment_id
         WHERE g.student_id = $1
         ORDER BY g.graded_at DESC
         LIMIT 5`,
      [user.id]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT CASE WHEN ar.status = 'PRESENT' THEN ats.id END) AS present_records,
                COUNT(DISTINCT ats.id) AS total_records
         FROM class_students cs
         JOIN classes c ON c.id = cs.class_id AND c.is_active = TRUE
         JOIN attendance_sessions ats ON ats.class_id = c.id
         LEFT JOIN attendance_records ar
           ON ar.attendance_session_id = ats.id AND ar.student_id = cs.student_id
         WHERE cs.student_id = $1 AND cs.is_active = TRUE`,
      [user.id]
    ),
    pool.query(
      `SELECT al.id, al.event_type, s.full_name, al.created_at
         FROM activity_logs al
         JOIN students s ON s.user_id = al.user_id
         WHERE al.user_id = $1
         ORDER BY al.created_at DESC
         LIMIT 8`,
      [user.id]
    ),
    pool.query(
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
      [user.id, user.id, user.id, user.id, user.id, user.id, user.id]
    )
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
      progress: requiredActivities === 0 ? 0 : Math.round(completedActivities / requiredActivities * 100),
      outstandingAssignments,
      attendanceRate: !attendance || toNumber(attendance.total_records) === 0 ? 0 : Math.round(
        toNumber(attendance.present_records) / toNumber(attendance.total_records) * 100
      )
    },
    classes: classRows.map((learningClass) => {
      const required = toNumber(learningClass.required_modules);
      const completed = toNumber(learningClass.completed_modules);
      return {
        id: learningClass.id,
        name: learningClass.name,
        subject: learningClass.subject,
        teacher: learningClass.teacher_name,
        progress: required === 0 ? 0 : Math.round(completed / required * 100)
      };
    }),
    dueAssignments: assignmentRows.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      className: assignment.class_name,
      dueAt: assignment.due_at
    })),
    latestGrades: gradeRows.map((grade) => ({
      id: grade.id,
      title: grade.title,
      score: toNumber(grade.score),
      maxScore: toNumber(grade.max_score),
      gradedAt: grade.graded_at
    })),
    recentActivities: activityRows.map((activity) => ({
      id: activity.id,
      type: activity.event_type,
      at: activity.created_at
    }))
  });
});

// src/modules/classes/classes.routes.ts
import { Router as Router3 } from "express";

// src/middleware/require-teacher.ts
var requireTeacher = (request, response, next) => {
  requireAuthenticated(request, response, (error) => {
    if (error) {
      next(error);
      return;
    }
    const user = response.locals.authUser;
    if (!user) {
      return;
    }
    if (user.role !== "TEACHER") {
      response.status(403).json({ error: "Fitur ini hanya dapat diakses guru." });
      return;
    }
    next();
  });
};

// src/modules/classes/classes.routes.ts
var router3 = Router3();
router3.use(requireTeacher);
var getTeacherId = (response) => response.locals.authUser.id;
var parseId = (value) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
var parseClassFields = (body) => {
  if (!body || typeof body !== "object") return null;
  const value = body;
  if (typeof value.name !== "string" || typeof value.subject !== "string" || typeof value.academicYear !== "string" || value.semester !== "ODD" && value.semester !== "EVEN" || value.description !== void 0 && value.description !== null && typeof value.description !== "string") {
    return null;
  }
  const name = value.name.trim();
  const subject = value.subject.trim();
  const academicYear = value.academicYear.trim();
  const description = typeof value.description === "string" ? value.description.trim() || null : null;
  const [startYear, endYear] = academicYear.split("-").map(Number);
  if (name.length < 2 || name.length > 120 || subject.length < 2 || subject.length > 120 || !/^\d{4}-\d{4}$/.test(academicYear) || endYear !== startYear + 1 || description !== null && description.length > 2e3) {
    return null;
  }
  return {
    name,
    subject,
    academicYear,
    semester: value.semester,
    description
  };
};
router3.get("/", async (_request, response) => {
  const { rows } = await pool.query(
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
    [getTeacherId(response)]
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
      assessmentCount: Number(row.assessment_count)
    }))
  });
});
router3.post("/", async (request, response) => {
  const fields = parseClassFields(request.body);
  if (!fields) {
    response.status(400).json({
      error: "Lengkapi nama kelas, mata pelajaran, tahun ajaran berurutan, semester, dan deskripsi yang valid."
    });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const subjectResult = await client.query(
      `INSERT INTO subjects (name)
       VALUES ($1)
       ON CONFLICT ((LOWER(name))) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [fields.subject]
    );
    const subjectId = subjectResult.rows[0]?.id;
    if (!subjectId) {
      throw new Error("Database tidak mengembalikan mata pelajaran.");
    }
    const classResult = await client.query(
      `INSERT INTO classes (teacher_id, subject_id, name, academic_year, semester, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        getTeacherId(response),
        subjectId,
        fields.name,
        fields.academicYear,
        fields.semester,
        fields.description
      ]
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
router3.get("/:classId/students", async (request, response) => {
  const classId = parseId(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows: classRows } = await pool.query(
    "SELECT id FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, getTeacherId(response)]
  );
  if (classRows.length === 0) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
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
    [classId, getTeacherId(response)]
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
        progress: required === 0 ? 0 : Math.round(completed / required * 100),
        completed: required > 0 && completed === required
      };
    })
  });
});
router3.put("/:classId", async (request, response) => {
  const classId = parseId(request.params.classId);
  const fields = parseClassFields(request.body);
  if (!classId || !fields) {
    response.status(400).json({ error: "ID atau data kelas tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const subjectResult = await client.query(
      `INSERT INTO subjects (name)
       VALUES ($1)
       ON CONFLICT ((LOWER(name))) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [fields.subject]
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
        getTeacherId(response)
      ]
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
router3.delete("/:classId", async (request, response) => {
  const classId = parseId(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const result = await pool.query(
    `UPDATE classes SET is_active = FALSE
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, getTeacherId(response)]
  );
  if (result.rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  response.status(204).end();
});
router3.post("/:classId/students", async (request, response) => {
  const classId = parseId(request.params.classId);
  const nisn = request.body && typeof request.body.nisn === "string" ? request.body.nisn.trim() : "";
  if (!classId || !/^\d{10}$/.test(nisn)) {
    response.status(400).json({ error: "ID kelas atau NISN tidak valid." });
    return;
  }
  const { rows: classes } = await pool.query(
    `SELECT id FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, getTeacherId(response)]
  );
  if (classes.length === 0) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows: students } = await pool.query(
    `SELECT s.user_id
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.nisn = $1 AND u.is_active = TRUE`,
    [nisn]
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
    [classId, student.user_id]
  );
  if (result.rowCount !== 1) {
    response.status(409).json({ error: "Siswa sudah terdaftar di kelas ini." });
    return;
  }
  response.status(201).json({ message: "Siswa berhasil ditambahkan ke kelas." });
});
router3.delete(
  "/:classId/students/:studentId",
  async (request, response) => {
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
      [classId, studentId, getTeacherId(response)]
    );
    if (result.rowCount !== 1) {
      response.status(404).json({ error: "Siswa tidak ditemukan di kelas tersebut." });
      return;
    }
    response.status(204).end();
  }
);

// src/modules/modules/modules.routes.ts
import { Router as Router4 } from "express";
import { randomUUID as randomUUID2 } from "node:crypto";
import { chmod, mkdir as mkdir2, unlink as unlink2, writeFile as writeFile2 } from "node:fs/promises";
import { extname, resolve as resolve3 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import multer from "multer";

// src/shared/private-storage.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { createClient } from "@supabase/supabase-js";
var storageDirectories = {
  modules: resolve2(fileURLToPath2(new URL("../../storage/modules/", import.meta.url))),
  assignments: resolve2(fileURLToPath2(new URL("../../storage/assignments/", import.meta.url))),
  imports: resolve2(fileURLToPath2(new URL("../../storage/imports/", import.meta.url)))
};
var remotePrefix = "supabase:";
var supabase = appConfig.supabaseUrl && appConfig.supabaseServiceRoleKey ? createClient(appConfig.supabaseUrl, appConfig.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
}) : null;
var isPrivateSupabaseStorageEnabled = () => supabase !== null;
var createPrivateFileKey = (area, ownerId, extension) => {
  const safeExtension = /^\.[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : "";
  if (!safeExtension || !/^[1-9]\d{0,18}$/.test(ownerId)) {
    throw new Error("Tujuan penyimpanan file tidak valid.");
  }
  return `${remotePrefix}${area}/${ownerId}/${randomUUID()}${safeExtension}`;
};
var objectPathFromKey = (fileKey) => {
  if (!fileKey.startsWith(remotePrefix)) return null;
  const objectPath = fileKey.slice(remotePrefix.length);
  if (!objectPath || objectPath.startsWith("/") || objectPath.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  return objectPath;
};
var createPrivateUploadTarget = async (area, ownerId, extension) => {
  if (!supabase) return null;
  const fileKey = createPrivateFileKey(area, ownerId, extension);
  const objectPath = objectPathFromKey(fileKey);
  if (!objectPath) throw new Error("Tujuan unggahan tidak valid.");
  const { data, error } = await supabase.storage.from(appConfig.supabaseStorageBucket).createSignedUploadUrl(objectPath);
  if (error || !data?.signedUrl) {
    throw new Error("URL unggah privat tidak dapat dibuat.");
  }
  return { fileKey, uploadUrl: data.signedUrl };
};
var isPrivateFileOwnedBy = (area, ownerId, fileKey) => objectPathFromKey(fileKey)?.startsWith(`${area}/${ownerId}/`) === true;
var readPrivateFile = async (area, fileKey) => {
  const objectPath = objectPathFromKey(fileKey);
  if (fileKey.startsWith(remotePrefix)) {
    if (!objectPath || !supabase || !objectPath.startsWith(`${area}/`)) {
      throw Object.assign(new Error("File tidak ditemukan."), { code: "ENOENT" });
    }
    const { data, error } = await supabase.storage.from(appConfig.supabaseStorageBucket).download(objectPath);
    if (error || !data) {
      throw Object.assign(new Error("File tidak ditemukan."), { code: "ENOENT" });
    }
    return Buffer.from(await data.arrayBuffer());
  }
  if (fileKey !== resolve2(fileKey).split("/").pop()) {
    throw Object.assign(new Error("File tidak ditemukan."), { code: "ENOENT" });
  }
  const path = resolve2(storageDirectories[area], fileKey);
  if (!path.startsWith(`${storageDirectories[area]}/`)) {
    throw Object.assign(new Error("File tidak ditemukan."), { code: "ENOENT" });
  }
  return readFile(path);
};
var writePrivateFile = async (area, fileKey, contents, contentType) => {
  const objectPath = objectPathFromKey(fileKey);
  if (fileKey.startsWith(remotePrefix)) {
    if (!objectPath || !supabase || !objectPath.startsWith(`${area}/`)) {
      throw new Error("Tujuan penyimpanan file tidak valid.");
    }
    const { error } = await supabase.storage.from(appConfig.supabaseStorageBucket).upload(objectPath, contents, { contentType, upsert: false });
    if (error) throw new Error("File tidak dapat disimpan di Supabase Storage.");
    return;
  }
  if (fileKey !== resolve2(fileKey).split("/").pop()) {
    throw new Error("Nama file tidak valid.");
  }
  const directory = storageDirectories[area];
  const path = resolve2(directory, fileKey);
  if (!path.startsWith(`${directory}/`)) throw new Error("Nama file tidak valid.");
  await mkdir(directory, { recursive: true, mode: 448 });
  await writeFile(path, contents, { flag: "wx", mode: 384 });
};
var deletePrivateFile = async (area, fileKey) => {
  const objectPath = objectPathFromKey(fileKey);
  if (fileKey.startsWith(remotePrefix)) {
    if (!objectPath || !supabase || !objectPath.startsWith(`${area}/`)) return;
    const { error } = await supabase.storage.from(appConfig.supabaseStorageBucket).remove([objectPath]);
    if (error) throw new Error("File tidak dapat dihapus dari Supabase Storage.");
    return;
  }
  if (fileKey !== resolve2(fileKey).split("/").pop()) return;
  await unlink(resolve2(storageDirectories[area], fileKey));
};
var createPrivateDownloadUrl = async (area, fileKey, download = false) => {
  const objectPath = objectPathFromKey(fileKey);
  if (!fileKey.startsWith(remotePrefix)) return null;
  if (!objectPath || !supabase || !objectPath.startsWith(`${area}/`)) return null;
  const { data, error } = await supabase.storage.from(appConfig.supabaseStorageBucket).createSignedUrl(objectPath, 60, { download });
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
};

// src/middleware/require-student.ts
var requireStudent = (request, response, next) => {
  requireAuthenticated(request, response, (error) => {
    if (error) {
      next(error);
      return;
    }
    const user = response.locals.authUser;
    if (!user) return;
    if (user.role !== "STUDENT") {
      response.status(403).json({ error: "Fitur ini hanya dapat diakses siswa." });
      return;
    }
    next();
  });
};

// src/modules/modules/modules.routes.ts
var teacherRouter = Router4();
var studentRouter = Router4();
teacherRouter.use(requireTeacher);
studentRouter.use(requireStudent);
var moduleStorageDirectory = fileURLToPath3(
  new URL("../../../storage/modules/", import.meta.url)
);
var privateModuleStorageDirectory = resolve3(moduleStorageDirectory);
var moduleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    const extension = extname(file.originalname).toLowerCase();
    if (![".pdf", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm"].includes(extension)) {
      callback(new Error("Format file tidak didukung. Gunakan PDF, DOCX, JPG, PNG, GIF, WEBP, MP4, atau WEBM."));
      return;
    }
    callback(null, true);
  }
});
var parseUploadedFile = (file) => {
  const extension = extname(file.originalname).toLowerCase();
  const bytes = file.buffer;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isGif = bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  const isWebp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const isPdf = bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-";
  const isZip = bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4;
  const isMp4 = bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  const isWebm = bytes.length >= 4 && bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163;
  let hasDocxDocument = false;
  if (isZip) {
    const searchStart = Math.max(0, bytes.length - 65557);
    for (let endOffset = bytes.length - 22; endOffset >= searchStart; endOffset -= 1) {
      if (bytes.readUInt32LE(endOffset) !== 101010256) continue;
      const entries = bytes.readUInt16LE(endOffset + 10);
      let directoryOffset = bytes.readUInt32LE(endOffset + 16);
      if (directoryOffset >= bytes.length) break;
      for (let entry = 0; entry < entries; entry += 1) {
        if (directoryOffset + 46 > bytes.length || bytes.readUInt32LE(directoryOffset) !== 33639248) break;
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
var handleModuleUpload = (request, response, next) => {
  moduleUpload.single("file")(request, response, (error) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE" ? "Ukuran file maksimal 20 MB." : "File tidak dapat diproses."
      });
      return;
    }
    if (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "File tidak dapat diproses."
      });
      return;
    }
    next();
  });
};
var getFileMimeType = (fileKey) => {
  switch (extname(fileKey).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
};
var sendPrivateFile = async (response, fileKey, title) => {
  const extension = extname(fileKey).toLowerCase();
  const downloadName = `${title.replace(/[^a-zA-Z0-9 ._-]/g, "_").slice(0, 100) || "materi"}${extension}`;
  const signedUrl = await createPrivateDownloadUrl(
    "modules",
    fileKey,
    extension === ".docx" ? downloadName : false
  );
  if (signedUrl) {
    response.redirect(302, signedUrl);
    return;
  }
  let contents;
  try {
    contents = await readPrivateFile("modules", fileKey);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      response.status(404).json({ error: "File materi tidak ditemukan di penyimpanan." });
      return;
    }
    throw error;
  }
  response.set("Content-Type", getFileMimeType(fileKey)).set("Content-Length", String(contents.length)).set(
    "Content-Disposition",
    `${extension === ".docx" ? "attachment" : "inline"}; filename="${downloadName}"`
  ).set("X-Content-Type-Options", "nosniff").set("Cache-Control", "private, no-store").send(contents);
};
var idFrom = (value) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
var parseModuleFields = (body) => {
  if (!body || typeof body !== "object") return null;
  const value = body;
  if (typeof value.title !== "string" || value.description !== void 0 && value.description !== null && typeof value.description !== "string" || value.learningObjectives !== void 0 && value.learningObjectives !== null && typeof value.learningObjectives !== "string" || value.durationMinutes !== void 0 && value.durationMinutes !== null && typeof value.durationMinutes !== "number" || value.isRequired !== void 0 && typeof value.isRequired !== "boolean") return null;
  const title = value.title.trim();
  const description = typeof value.description === "string" ? value.description.trim() || null : null;
  const learningObjectives = typeof value.learningObjectives === "string" ? value.learningObjectives.trim() || null : null;
  const durationMinutes = typeof value.durationMinutes === "number" ? value.durationMinutes : null;
  if (title.length < 2 || title.length > 180 || description !== null && description.length > 5e3 || learningObjectives !== null && learningObjectives.length > 5e3 || durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) return null;
  return { title, description, learningObjectives, durationMinutes, isRequired: value.isRequired !== false };
};
var parseContentFields = (body) => {
  if (!body || typeof body !== "object") return null;
  const value = body;
  const validTypes = ["TEXT", "PDF", "DOCX", "IMAGE", "VIDEO", "LINK", "YOUTUBE"];
  if (typeof value.title !== "string" || typeof value.contentType !== "string" || !validTypes.includes(value.contentType) || value.description !== void 0 && value.description !== null && typeof value.description !== "string" || value.body !== void 0 && value.body !== null && typeof value.body !== "string" || value.externalUrl !== void 0 && value.externalUrl !== null && typeof value.externalUrl !== "string" || value.durationMinutes !== void 0 && value.durationMinutes !== null && typeof value.durationMinutes !== "number" || value.isRequired !== void 0 && typeof value.isRequired !== "boolean") return null;
  const title = value.title.trim();
  const description = typeof value.description === "string" ? value.description.trim() || null : null;
  const contentType = value.contentType;
  const bodyText = typeof value.body === "string" ? value.body.trim() || null : null;
  const externalUrl = typeof value.externalUrl === "string" ? value.externalUrl.trim() || null : null;
  const durationMinutes = typeof value.durationMinutes === "number" ? value.durationMinutes : null;
  if (title.length < 2 || title.length > 180 || description !== null && description.length > 5e3 || bodyText !== null && bodyText.length > 5e4 || externalUrl !== null && externalUrl.length > 2048 || durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) || (contentType === "TEXT" ? !bodyText : !externalUrl)) return null;
  if (externalUrl) {
    let url;
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
var getUserId = (response) => response.locals.authUser.id;
var refreshModuleProgress = async (client, moduleId) => {
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
    [moduleId]
  );
};
var moduleFieldsSql = `m.title, m.description, m.learning_objectives, m.duration_minutes, m.is_required`;
teacherRouter.get("/classes/:classId/modules", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows } = await pool.query(
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
    [classId, getUserId(response)]
  );
  const { rowCount } = await pool.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, getUserId(response)]
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
      contents: row.contents
    }))
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
      [classId, getUserId(response)]
    );
    if (classResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
    const result = await client.query(
      `INSERT INTO modules (class_id, title, description, learning_objectives, position, duration_minutes, is_required)
       SELECT $1, $2, $3, $4, COALESCE(MAX(position), 0) + 1, $5, $6
       FROM modules WHERE class_id = $1
       RETURNING id`,
      [classId, fields.title, fields.description, fields.learningObjectives, fields.durationMinutes, fields.isRequired]
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
  const moduleIds = request.body && typeof request.body === "object" ? request.body.moduleIds : null;
  if (!classId || !Array.isArray(moduleIds) || moduleIds.length > 500 || moduleIds.some((id) => idFrom(id) === null) || new Set(moduleIds).size !== moduleIds.length) {
    response.status(400).json({ error: "Urutan modul tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const classResult = await client.query(
      "SELECT id FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE FOR UPDATE",
      [classId, getUserId(response)]
    );
    if (classResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
    const { rows: activeRows } = await client.query(
      "SELECT id FROM modules WHERE class_id = $1 AND is_active = TRUE FOR UPDATE",
      [classId]
    );
    const activeIds = new Set(activeRows.map((row) => row.id));
    if (activeIds.size !== moduleIds.length || moduleIds.some((id) => !activeIds.has(id))) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Daftar modul berubah. Muat ulang sebelum mengatur urutannya." });
      return;
    }
    const { rows: maxRows } = await client.query(
      `SELECT COALESCE(MAX(position), 0) AS max_position,
              COALESCE(MAX(position) FILTER (WHERE is_active = FALSE), 0) AS inactive_max
       FROM modules WHERE class_id = $1`,
      [classId]
    );
    const maxPosition = Number(maxRows[0]?.max_position ?? 0);
    const inactiveMax = Number(maxRows[0]?.inactive_max ?? 0);
    const offset = maxPosition + activeRows.length + moduleIds.length + 1;
    await client.query(
      "UPDATE modules SET position = position + $2 WHERE class_id = $1 AND is_active = TRUE",
      [classId, offset]
    );
    await client.query(
      `UPDATE modules AS m
       SET position = $3 + ordered.ordinality::integer
       FROM unnest($2::bigint[]) WITH ORDINALITY AS ordered(id, ordinality)
       WHERE m.id = ordered.id AND m.class_id = $1 AND m.is_active = TRUE`,
      [classId, moduleIds, inactiveMax]
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
    [fields.title, fields.description, fields.learningObjectives, fields.durationMinutes, fields.isRequired, moduleId, getUserId(response)]
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
    [moduleId, getUserId(response)]
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
      [moduleId, getUserId(response)]
    );
    if (moduleResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Modul tidak ditemukan." });
      return;
    }
    const result = await client.query(
      `INSERT INTO module_contents
        (module_id, title, description, content_type, body, external_url, position, duration_minutes, is_required)
       SELECT $1, $2, $3, $4, $5, $6, COALESCE(MAX(position), 0) + 1, $7, $8
       FROM module_contents WHERE module_id = $1
       RETURNING id`,
      [moduleId, fields.title, fields.description, fields.contentType, fields.body, fields.externalUrl, fields.durationMinutes, fields.isRequired]
    );
    if (fields.isRequired) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [moduleId, result.rows[0]?.id]
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
  if (!moduleId || ![".pdf", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm"].includes(extension) || typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 20 * 1024 * 1024) {
    response.status(400).json({ error: "Nama atau ukuran file materi tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    `SELECT 1 FROM modules m JOIN classes c ON c.id = m.class_id
     WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE`,
    [moduleId, getUserId(response)]
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
  const durationMinutes = request.body?.durationMinutes === null || request.body?.durationMinutes === "" ? null : request.body?.durationMinutes;
  const isRequired = request.body?.isRequired;
  if (!moduleId || !isPrivateFileOwnedBy("modules", getUserId(response), fileKey) || title.length < 2 || title.length > 180 || description !== null && (typeof description !== "string" || description.length > 5e3) || durationMinutes !== null && (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) || isRequired !== void 0 && typeof isRequired !== "boolean") {
    response.status(400).json({ error: "Data unggahan materi tidak valid." });
    return;
  }
  let uploaded;
  try {
    const contents = await readPrivateFile("modules", fileKey);
    const originalname = fileKey.split("/").at(-1) ?? "";
    uploaded = parseUploadedFile({ originalname, buffer: contents });
  } catch {
    uploaded = null;
  }
  if (!uploaded) {
    await deletePrivateFile("modules", fileKey).catch(() => void 0);
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
      [moduleId, getUserId(response)]
    );
    if (moduleResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      await deletePrivateFile("modules", fileKey);
      response.status(404).json({ error: "Modul tidak ditemukan." });
      return;
    }
    const result = await client.query(
      `INSERT INTO module_contents
        (module_id, title, description, content_type, file_key, position, duration_minutes, is_required)
       SELECT $1, $2, $3, $4, $5, COALESCE(MAX(position), 0) + 1, $6, $7
       FROM module_contents WHERE module_id = $1
       RETURNING id`,
      [moduleId, title, description, uploaded.contentType, fileKey, durationMinutes, isRequired !== false]
    );
    if (isRequired !== false) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [moduleId, result.rows[0]?.id]
      );
    }
    await refreshModuleProgress(client, moduleId);
    await client.query("COMMIT");
    response.status(201).json({ id: result.rows[0]?.id });
  } catch (error) {
    await client.query("ROLLBACK");
    await deletePrivateFile("modules", fileKey).catch(() => void 0);
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
    const description = typeof request.body.description === "string" ? request.body.description.trim() || null : null;
    const durationRaw = request.body.durationMinutes;
    const durationMinutes = durationRaw === void 0 || durationRaw === "" ? null : typeof durationRaw === "string" && /^\d{1,4}$/.test(durationRaw) ? Number(durationRaw) : Number.NaN;
    const isRequired = request.body.isRequired !== "false";
    if (!moduleId || !file || !uploaded || title.length < 2 || title.length > 180 || description !== null && description.length > 5e3 || durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) || !["true", "false", void 0].includes(request.body.isRequired)) {
      response.status(400).json({
        error: "Data unggahan tidak valid. File harus PDF, DOCX, JPG, PNG, GIF, WEBP, MP4, atau WEBM yang sesuai format."
      });
      return;
    }
    const fileKey = `${randomUUID2()}${uploaded.extension}`;
    const filePath = resolve3(privateModuleStorageDirectory, fileKey);
    const client = await pool.connect();
    let fileWritten = false;
    try {
      await mkdir2(privateModuleStorageDirectory, { recursive: true, mode: 448 });
      await chmod(privateModuleStorageDirectory, 448);
      await writeFile2(filePath, file.buffer, { flag: "wx", mode: 384 });
      fileWritten = true;
      await client.query("BEGIN");
      const moduleResult = await client.query(
        `SELECT m.id FROM modules m JOIN classes c ON c.id = m.class_id
         WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE
         FOR UPDATE OF m`,
        [moduleId, getUserId(response)]
      );
      if (moduleResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        await unlink2(filePath);
        fileWritten = false;
        response.status(404).json({ error: "Modul tidak ditemukan." });
        return;
      }
      const result = await client.query(
        `INSERT INTO module_contents
          (module_id, title, description, content_type, file_key, position, duration_minutes, is_required)
         SELECT $1, $2, $3, $4, $5, COALESCE(MAX(position), 0) + 1, $6, $7
         FROM module_contents WHERE module_id = $1
         RETURNING id`,
        [moduleId, title, description, uploaded.contentType, fileKey, durationMinutes, isRequired]
      );
      if (isRequired) {
        await client.query(
          "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
          [moduleId, result.rows[0]?.id]
        );
      }
      await refreshModuleProgress(client, moduleId);
      await client.query("COMMIT");
      response.status(201).json({ id: result.rows[0]?.id });
    } catch (error) {
      await client.query("ROLLBACK");
      if (fileWritten) await unlink2(filePath);
      throw error;
    } finally {
      client.release();
    }
  }
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
  if (!contentId || ![".pdf", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm"].includes(extension) || typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 20 * 1024 * 1024) {
    response.status(400).json({ error: "Nama atau ukuran file materi tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT mc.id FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
       AND m.is_active = TRUE AND c.is_active = TRUE AND c.teacher_id = $2`,
    [contentId, getUserId(response)]
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
  const durationMinutes = request.body?.durationMinutes === null || request.body?.durationMinutes === "" ? null : request.body?.durationMinutes;
  const isRequired = request.body?.isRequired;
  if (!contentId || !isPrivateFileOwnedBy("modules", getUserId(response), fileKey) || title.length < 2 || title.length > 180 || description !== null && (typeof description !== "string" || description.length > 5e3) || durationMinutes !== null && (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) || isRequired !== void 0 && typeof isRequired !== "boolean") {
    response.status(400).json({ error: "Data penggantian file materi tidak valid." });
    return;
  }
  let uploaded;
  try {
    const contents = await readPrivateFile("modules", fileKey);
    const originalname = fileKey.split("/").at(-1) ?? "";
    uploaded = parseUploadedFile({ originalname, buffer: contents });
  } catch {
    uploaded = null;
  }
  if (!uploaded) {
    await deletePrivateFile("modules", fileKey).catch(() => void 0);
    response.status(400).json({ error: "Isi file materi tidak valid atau formatnya tidak didukung." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT mc.module_id, mc.file_key
       FROM module_contents mc
       JOIN modules m ON m.id = mc.module_id
       JOIN classes c ON c.id = m.class_id
       WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
         AND m.is_active = TRUE AND c.is_active = TRUE AND c.teacher_id = $2
       FOR UPDATE OF mc`,
      [contentId, getUserId(response)]
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
      [title, description, uploaded.contentType, fileKey, durationMinutes, required, contentId]
    );
    await client.query("DELETE FROM module_requirements WHERE module_content_id = $1", [contentId]);
    if (required) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [previous.module_id, contentId]
      );
    }
    await client.query(
      `UPDATE student_content_progress
       SET status = 'NOT_STARTED', started_at = NULL, completed_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE module_content_id = $1`,
      [contentId]
    );
    await refreshModuleProgress(client, previous.module_id);
    await client.query("COMMIT");
    await deletePrivateFile("modules", previous.file_key).catch((cleanupError) => {
      console.error("File materi lama tidak dapat dibersihkan:", cleanupError);
    });
    response.json({ message: "File materi berhasil diperbarui." });
  } catch (error) {
    await client.query("ROLLBACK");
    await deletePrivateFile("modules", fileKey).catch(() => void 0);
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
    const description = typeof request.body.description === "string" ? request.body.description.trim() || null : null;
    const durationRaw = request.body.durationMinutes;
    const durationMinutes = durationRaw === void 0 || durationRaw === "" ? null : typeof durationRaw === "string" && /^\d{1,4}$/.test(durationRaw) ? Number(durationRaw) : Number.NaN;
    const isRequired = request.body.isRequired !== "false";
    if (!contentId || !file || !uploaded || title.length < 2 || title.length > 180 || description !== null && description.length > 5e3 || durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) || !["true", "false", void 0].includes(request.body.isRequired)) {
      response.status(400).json({ error: "Data penggantian file materi tidak valid." });
      return;
    }
    const fileKey = `${randomUUID2()}${uploaded.extension}`;
    const filePath = resolve3(privateModuleStorageDirectory, fileKey);
    const client = await pool.connect();
    let fileWritten = false;
    try {
      await mkdir2(privateModuleStorageDirectory, { recursive: true, mode: 448 });
      await chmod(privateModuleStorageDirectory, 448);
      await writeFile2(filePath, file.buffer, { flag: "wx", mode: 384 });
      fileWritten = true;
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT mc.module_id, mc.file_key
         FROM module_contents mc
         JOIN modules m ON m.id = mc.module_id
         JOIN classes c ON c.id = m.class_id
         WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
           AND m.is_active = TRUE AND c.is_active = TRUE AND c.teacher_id = $2
         FOR UPDATE OF mc`,
        [contentId, getUserId(response)]
      );
      const previous = rows[0];
      if (!previous) {
        await client.query("ROLLBACK");
        await unlink2(filePath);
        fileWritten = false;
        response.status(404).json({ error: "File materi tidak ditemukan." });
        return;
      }
      await client.query(
        `UPDATE module_contents
         SET title = $1, description = $2, content_type = $3, body = NULL,
             external_url = NULL, file_key = $4, duration_minutes = $5, is_required = $6
         WHERE id = $7`,
        [title, description, uploaded.contentType, fileKey, durationMinutes, isRequired, contentId]
      );
      await client.query("DELETE FROM module_requirements WHERE module_content_id = $1", [contentId]);
      if (isRequired) {
        await client.query(
          "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
          [previous.module_id, contentId]
        );
      }
      await client.query(
        `UPDATE student_content_progress
         SET status = 'NOT_STARTED', started_at = NULL, completed_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE module_content_id = $1`,
        [contentId]
      );
      await refreshModuleProgress(client, previous.module_id);
      await client.query("COMMIT");
      fileWritten = false;
      try {
        await unlink2(resolve3(privateModuleStorageDirectory, previous.file_key));
      } catch (cleanupError) {
        if (!(typeof cleanupError === "object" && cleanupError !== null && "code" in cleanupError && cleanupError.code === "ENOENT")) {
          console.error("File materi lama tidak dapat dibersihkan:", cleanupError);
        }
      }
      response.json({ message: "File materi berhasil diperbarui." });
    } catch (error) {
      await client.query("ROLLBACK");
      if (fileWritten) await unlink2(filePath);
      throw error;
    } finally {
      client.release();
    }
  }
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
    const result = await client.query(
      `UPDATE module_contents mc
       SET title = $1, description = $2, content_type = $3, body = $4,
           external_url = $5, duration_minutes = $6, is_required = $7
       FROM modules m JOIN classes c ON c.id = m.class_id
       WHERE mc.id = $8 AND mc.module_id = m.id AND m.is_active = TRUE
         AND c.teacher_id = $9 AND c.is_active = TRUE AND mc.is_active = TRUE
       RETURNING mc.module_id`,
      [fields.title, fields.description, fields.contentType, fields.body, fields.externalUrl, fields.durationMinutes, fields.isRequired, contentId, getUserId(response)]
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
        [content.module_id, contentId]
      );
    }
    await client.query(
      `UPDATE student_content_progress
       SET status = 'NOT_STARTED', started_at = NULL, completed_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE module_content_id = $1`,
      [contentId]
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
    const result = await client.query(
      `UPDATE module_contents mc SET is_active = FALSE
       FROM modules m JOIN classes c ON c.id = m.class_id
       WHERE mc.id = $1 AND mc.module_id = m.id AND m.is_active = TRUE
         AND c.teacher_id = $2 AND c.is_active = TRUE AND mc.is_active = TRUE
       RETURNING mc.module_id`,
      [contentId, getUserId(response)]
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
  const { rows } = await pool.query(
    `SELECT mc.file_key, mc.title
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
       AND m.is_active = TRUE AND c.is_active = TRUE AND c.teacher_id = $2`,
    [contentId, getUserId(response)]
  );
  const file = rows[0];
  if (!file) {
    response.status(404).json({ error: "File materi tidak ditemukan." });
    return;
  }
  await sendPrivateFile(response, file.file_key, file.title);
});
var studentModuleQuery = `SELECT m.id, m.title, m.description, m.learning_objectives,
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
    [getUserId(response)]
  );
  response.json({ classes: rows });
});
studentRouter.get("/classes/:classId/modules", async (request, response) => {
  const classId = idFrom(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows } = await pool.query(studentModuleQuery, [classId, getUserId(response)]);
  if (rows.length === 0) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM classes c JOIN class_students cs ON cs.class_id = c.id
       WHERE c.id = $1 AND c.is_active = TRUE AND cs.student_id = $2 AND cs.is_active = TRUE`,
      [classId, getUserId(response)]
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
      status: row.status
    }))
  });
});
studentRouter.get("/modules/:moduleId/contents", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  if (!moduleId) {
    response.status(400).json({ error: "ID modul tidak valid." });
    return;
  }
  const { rows: modules } = await pool.query(studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"), [moduleId, getUserId(response)]);
  const module = modules.find((item) => item.id === moduleId);
  if (!module) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  if (!module.is_unlocked) {
    response.status(423).json({ error: "Selesaikan modul sebelumnya untuk membuka modul ini.", code: "MODULE_LOCKED" });
    return;
  }
  const { rows } = await pool.query(
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
    [moduleId, getUserId(response)]
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
      completed: row.completed
    }))
  });
});
studentRouter.get("/contents/:contentId/file", async (request, response) => {
  const contentId = idFrom(request.params.contentId);
  if (!contentId) {
    response.status(400).json({ error: "ID materi tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT mc.module_id, mc.file_key, mc.title
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE mc.id = $1 AND mc.file_key IS NOT NULL AND mc.is_active = TRUE
       AND m.is_active = TRUE AND c.is_active = TRUE`,
    [contentId, getUserId(response)]
  );
  const file = rows[0];
  if (!file) {
    response.status(404).json({ error: "File materi tidak ditemukan." });
    return;
  }
  const { rows: modules } = await pool.query(
    studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"),
    [file.module_id, getUserId(response)]
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
  const { rows: modules } = await pool.query(
    studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"),
    [moduleId, getUserId(response)]
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
    [getUserId(response), moduleId, module.is_complete ? "COMPLETED" : "IN_PROGRESS", Number(module.progress)]
  );
  await pool.query(
    `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
     VALUES ($1, 'MODULE_OPENED', 'MODULE', $2)`,
    [getUserId(response), moduleId]
  );
  response.json({ moduleId, status: module.is_complete ? "COMPLETED" : "IN_PROGRESS" });
});
studentRouter.post("/contents/:contentId/complete", async (request, response) => {
  const contentId = idFrom(request.params.contentId);
  if (!contentId) {
    response.status(400).json({ error: "ID materi tidak valid." });
    return;
  }
  const { rows } = await pool.query(
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
    [contentId, getUserId(response)]
  );
  const content = rows[0];
  if (!content) {
    response.status(404).json({ error: "Materi tidak ditemukan." });
    return;
  }
  const { rows: moduleRows } = await pool.query(
    studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"),
    [content.module_id, getUserId(response)]
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
  const requiredSeconds = content.duration_minutes ? content.duration_minutes * 60 : 10;
  const elapsedSeconds = (Date.now() - new Date(content.started_at).getTime()) / 1e3;
  if (elapsedSeconds < requiredSeconds) {
    response.status(409).json({
      error: `Materi perlu dipelajari minimal ${Math.ceil(requiredSeconds - elapsedSeconds)} detik lagi.`,
      code: "CONTENT_DURATION_REQUIRED"
    });
    return;
  }
  await pool.query(
    `UPDATE student_content_progress
     SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE student_id = $1 AND module_content_id = $2`,
    [getUserId(response), contentId]
  );
  const { rows: progressRows } = await pool.query(
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
    [getUserId(response), content.module_id]
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
    [getUserId(response), content.module_id, current.completed ? "COMPLETED" : "IN_PROGRESS", current.progress]
  );
  if (current.completed) {
    await pool.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'MODULE_COMPLETED', 'MODULE', $2)`,
      [getUserId(response), content.module_id]
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
  const { rows: modules } = await pool.query(
    studentModuleQuery.replace("WHERE m.class_id = $1", "WHERE m.class_id = (SELECT class_id FROM modules WHERE id = $1)"),
    [moduleId, getUserId(response)]
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
  const { rows: contents } = await pool.query(
    `SELECT mc.id, mc.module_id, mc.title, mc.description, mc.content_type,
          mc.body, mc.external_url, mc.file_key, mc.position, mc.duration_minutes, mc.is_required
     FROM module_contents mc
     WHERE mc.id = $1 AND mc.module_id = $2 AND mc.is_active = TRUE`,
    [contentId, moduleId]
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
    [getUserId(response), contentId]
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
      gameId: content.game_id
    }
  });
});

// src/modules/games/games.routes.ts
import { Router as Router5 } from "express";
var teacherRouter2 = Router5();
var studentRouter2 = Router5();
teacherRouter2.use(requireTeacher);
studentRouter2.use(requireStudent);
var idFrom2 = (value) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
var getUserId2 = (response) => response.locals.authUser.id;
var parseGameConfiguration = (value) => {
  if (!value || typeof value !== "object") return null;
  const raw = value;
  const instructions = typeof raw.instructions === "string" ? raw.instructions.trim() : "";
  const passScore = typeof raw.passScore === "number" ? raw.passScore : 70;
  let externalUrl;
  if (raw.externalUrl !== void 0 && raw.externalUrl !== null && raw.externalUrl !== "") {
    if (typeof raw.externalUrl !== "string" || raw.externalUrl.length > 2048) return null;
    try {
      const url = new URL(raw.externalUrl);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
      externalUrl = url.toString();
    } catch {
      return null;
    }
  }
  if (instructions.length > 2e3 || !Number.isInteger(passScore) || passScore < 1 || passScore > 100 || !Array.isArray(raw.questions) || raw.questions.length < 1 && !externalUrl || raw.questions.length > 20) return null;
  const ids = /* @__PURE__ */ new Set();
  const questions = [];
  for (const item of raw.questions) {
    if (!item || typeof item !== "object") return null;
    const question = item;
    if (typeof question.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(question.id) || ids.has(question.id) || typeof question.prompt !== "string" || question.prompt.trim().length < 3 || question.prompt.trim().length > 1e3 || !Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 6 || typeof question.answerId !== "string") return null;
    ids.add(question.id);
    const choiceIds = /* @__PURE__ */ new Set();
    const choices = [];
    for (const entry of question.choices) {
      if (!entry || typeof entry !== "object") return null;
      const choice = entry;
      if (typeof choice.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(choice.id) || choiceIds.has(choice.id) || typeof choice.text !== "string" || choice.text.trim().length < 1 || choice.text.trim().length > 500) return null;
      choiceIds.add(choice.id);
      choices.push({ id: choice.id, text: choice.text.trim() });
    }
    if (!choiceIds.has(question.answerId)) return null;
    questions.push({
      id: question.id,
      prompt: question.prompt.trim(),
      choices,
      answerId: question.answerId
    });
  }
  return { instructions, passScore, ...externalUrl ? { externalUrl } : {}, questions };
};
var refreshModuleProgress2 = async (client, moduleId) => {
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
    [moduleId]
  );
};
teacherRouter2.post("/modules/:moduleId/games", async (request, response) => {
  const moduleId = idFrom2(request.params.moduleId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const rawDuration = request.body?.durationMinutes;
  const durationMinutes = rawDuration === void 0 || rawDuration === null || rawDuration === "" ? null : typeof rawDuration === "number" ? rawDuration : Number.NaN;
  const configuration = parseGameConfiguration(request.body?.configuration);
  const isRequired = !configuration?.externalUrl && request.body?.isRequired !== false;
  if (!moduleId || title.length < 2 || title.length > 180 || description !== null && description.length > 5e3 || durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) || typeof request.body?.isRequired !== "undefined" && typeof request.body.isRequired !== "boolean" || !configuration) {
    response.status(400).json({ error: "Data game atau soal tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moduleResult = await client.query(
      `SELECT m.id FROM modules m JOIN classes c ON c.id = m.class_id
       WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE
       FOR UPDATE OF m`,
      [moduleId, getUserId2(response)]
    );
    if (moduleResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Modul tidak ditemukan." });
      return;
    }
    const contentResult = await client.query(
      `INSERT INTO module_contents
         (module_id, title, description, content_type, position, duration_minutes, is_required)
       SELECT $1, $2, $3, 'GAME', COALESCE(MAX(position), 0) + 1, $4, $5
       FROM module_contents WHERE module_id = $1
       RETURNING id`,
      [moduleId, title, description, durationMinutes, isRequired]
    );
    const contentId = contentResult.rows[0]?.id;
    if (!contentId) throw new Error("Database tidak mengembalikan ID game.");
    const gameResult = await client.query(
      `INSERT INTO learning_games (module_content_id, game_type, configuration)
       VALUES ($1, 'MULTIPLE_CHOICE', $2::jsonb)
       RETURNING id`,
      [contentId, JSON.stringify(configuration)]
    );
    if (isRequired) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [moduleId, contentId]
      );
    }
    await refreshModuleProgress2(client, moduleId);
    await client.query("COMMIT");
    response.status(201).json({ id: contentId, gameId: gameResult.rows[0]?.id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
teacherRouter2.get("/modules/:moduleId/games", async (request, response) => {
  const moduleId = idFrom2(request.params.moduleId);
  if (!moduleId) {
    response.status(400).json({ error: "ID modul tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT mc.id, mc.title, mc.description, mc.position, mc.is_required, mc.is_active,
            lg.id AS game_id,
            jsonb_array_length(lg.configuration->'questions') AS question_count,
            (lg.configuration->>'passScore')::integer AS pass_score,
            lg.configuration->>'externalUrl' AS external_url,
            (SELECT COUNT(*)::integer FROM class_students cs
             WHERE cs.class_id = c.id AND cs.is_active = TRUE) AS student_count,
            (SELECT COUNT(DISTINCT attempt.student_id)::integer
             FROM learning_game_attempts attempt
             JOIN class_students cs ON cs.student_id = attempt.student_id
               AND cs.class_id = c.id AND cs.is_active = TRUE
             WHERE attempt.learning_game_id = lg.id AND attempt.passed = TRUE) AS completed_count
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     JOIN learning_games lg ON lg.module_content_id = mc.id AND lg.is_active = TRUE
     WHERE mc.module_id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE
       AND m.is_active = TRUE AND mc.is_active = TRUE
     ORDER BY mc.position`,
    [moduleId, getUserId2(response)]
  );
  const { rowCount } = await pool.query(
    `SELECT 1 FROM modules m JOIN classes c ON c.id = m.class_id
     WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE`,
    [moduleId, getUserId2(response)]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  response.json({
    games: rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      title: row.title,
      description: row.description,
      position: row.position,
      isRequired: row.is_required,
      isActive: row.is_active,
      questionCount: row.question_count,
      passScore: row.pass_score,
      externalUrl: row.external_url,
      completedCount: row.completed_count,
      studentCount: row.student_count
    }))
  });
});
studentRouter2.get("/modules/:moduleId/games", async (request, response) => {
  const moduleId = idFrom2(request.params.moduleId);
  if (!moduleId) {
    response.status(400).json({ error: "ID modul tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT mc.id, mc.title, mc.description, mc.position, mc.is_required,
            lg.id AS game_id,
            jsonb_array_length(lg.configuration->'questions') AS question_count,
            (lg.configuration->>'passScore')::integer AS pass_score,
            lg.configuration->>'externalUrl' AS external_url,
            COALESCE(scp.status = 'COMPLETED', FALSE) AS completed
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id AND m.is_active = TRUE
     JOIN classes c ON c.id = m.class_id AND c.is_active = TRUE
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     JOIN learning_games lg ON lg.module_content_id = mc.id AND lg.is_active = TRUE
     LEFT JOIN student_content_progress scp
       ON scp.module_content_id = mc.id AND scp.student_id = $2
     WHERE mc.module_id = $1 AND mc.content_type = 'GAME' AND mc.is_active = TRUE
       AND (
         NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = c.id AND previous.is_active = TRUE
             AND previous.position < m.position
         )
         OR NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = c.id AND previous.is_active = TRUE
             AND previous.position < m.position
             AND (
               EXISTS (
                 SELECT 1 FROM module_contents prior_content
                 WHERE prior_content.module_id = previous.id
                   AND prior_content.is_active = TRUE AND prior_content.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM student_content_progress prior_progress
                     WHERE prior_progress.module_content_id = prior_content.id
                       AND prior_progress.student_id = $2 AND prior_progress.status = 'COMPLETED'
                   )
               )
               OR EXISTS (
                 SELECT 1 FROM assignments prior_assignment
                 WHERE prior_assignment.module_id = previous.id
                   AND prior_assignment.is_active = TRUE AND prior_assignment.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM assignment_submissions submission
                     WHERE submission.assignment_id = prior_assignment.id
                       AND submission.student_id = $2
                   )
               )
               OR EXISTS (
                 SELECT 1 FROM assessments prior_assessment
                 WHERE prior_assessment.module_id = previous.id
                   AND prior_assessment.is_active = TRUE AND prior_assessment.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM assessment_attempts attempt
                     WHERE attempt.assessment_id = prior_assessment.id
                       AND attempt.student_id = $2
                       AND attempt.status IN ('SUBMITTED', 'GRADED')
                   )
               )
             )
         )
       )
     ORDER BY mc.position`,
    [moduleId, getUserId2(response)]
  );
  if (rows.length === 0) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM modules m JOIN classes c ON c.id = m.class_id
       JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
       WHERE m.id = $1 AND m.is_active = TRUE AND c.is_active = TRUE`,
      [moduleId, getUserId2(response)]
    );
    if (rowCount !== 1) {
      response.status(404).json({ error: "Modul tidak ditemukan." });
      return;
    }
  }
  response.json({
    games: rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      title: row.title,
      description: row.description,
      position: row.position,
      isRequired: row.is_required,
      questionCount: row.question_count,
      passScore: row.pass_score,
      externalUrl: row.external_url,
      completed: row.completed
    }))
  });
});
studentRouter2.get("/games/:gameId", async (request, response) => {
  const gameId = idFrom2(request.params.gameId);
  if (!gameId) {
    response.status(400).json({ error: "ID game tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT lg.id, mc.id AS content_id, mc.module_id, lg.configuration,
            latest.score AS latest_score, latest.max_score AS latest_max_score,
            latest.passed AS latest_passed
     FROM learning_games lg
     JOIN module_contents mc ON mc.id = lg.module_content_id
     JOIN modules m ON m.id = mc.module_id AND m.is_active = TRUE
     JOIN classes c ON c.id = m.class_id AND c.is_active = TRUE
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     LEFT JOIN LATERAL (
       SELECT score, max_score, passed
       FROM learning_game_attempts
       WHERE learning_game_id = lg.id AND student_id = $2
       ORDER BY submitted_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE lg.id = $1 AND lg.is_active = TRUE AND mc.is_active = TRUE
       AND (
         NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = c.id AND previous.is_active = TRUE
             AND previous.position < m.position
         )
         OR NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = c.id AND previous.is_active = TRUE
             AND previous.position < m.position
             AND (
               EXISTS (
                 SELECT 1 FROM module_contents prior_content
                 WHERE prior_content.module_id = previous.id
                   AND prior_content.is_active = TRUE AND prior_content.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM student_content_progress prior_progress
                     WHERE prior_progress.module_content_id = prior_content.id
                       AND prior_progress.student_id = $2 AND prior_progress.status = 'COMPLETED'
                   )
               )
               OR EXISTS (
                 SELECT 1 FROM assignments prior_assignment
                 WHERE prior_assignment.module_id = previous.id
                   AND prior_assignment.is_active = TRUE AND prior_assignment.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM assignment_submissions submission
                     WHERE submission.assignment_id = prior_assignment.id
                       AND submission.student_id = $2
                   )
               )
               OR EXISTS (
                 SELECT 1 FROM assessments prior_assessment
                 WHERE prior_assessment.module_id = previous.id
                   AND prior_assessment.is_active = TRUE AND prior_assessment.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM assessment_attempts attempt
                     WHERE attempt.assessment_id = prior_assessment.id
                       AND attempt.student_id = $2
                       AND attempt.status IN ('SUBMITTED', 'GRADED')
                   )
               )
             )
         )
       )`,
    [gameId, getUserId2(response)]
  );
  const game = rows[0];
  if (!game) {
    response.status(404).json({ error: "Game tidak ditemukan atau modul masih terkunci." });
    return;
  }
  const { instructions, passScore, questions } = game.configuration;
  response.json({
    game: {
      id: game.id,
      contentId: game.content_id,
      moduleId: game.module_id,
      instructions,
      passScore,
      questions: questions.map(({ id, prompt, choices }) => ({ id, prompt, choices })),
      latestResult: game.latest_score === null ? null : {
        score: game.latest_score,
        maxScore: game.latest_max_score,
        passed: game.latest_passed
      }
    }
  });
});
studentRouter2.post("/games/:gameId/submit", async (request, response) => {
  const gameId = idFrom2(request.params.gameId);
  const rawAnswers = request.body?.answers;
  if (!gameId || !Array.isArray(rawAnswers) || rawAnswers.length > 20 || rawAnswers.some(
    (item) => !item || typeof item !== "object" || typeof item.questionId !== "string" || typeof item.choiceId !== "string"
  )) {
    response.status(400).json({ error: "Jawaban game tidak valid." });
    return;
  }
  const answers = rawAnswers;
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) {
    response.status(400).json({ error: "Terdapat jawaban soal yang duplikat." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT lg.id, mc.id AS content_id, mc.module_id, m.class_id,
              mc.is_required, lg.configuration
       FROM learning_games lg
       JOIN module_contents mc ON mc.id = lg.module_content_id AND mc.is_active = TRUE
       JOIN modules m ON m.id = mc.module_id AND m.is_active = TRUE
       JOIN classes c ON c.id = m.class_id AND c.is_active = TRUE
       JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
       WHERE lg.id = $1 AND lg.is_active = TRUE
         AND (
           NOT EXISTS (
             SELECT 1 FROM modules previous
             WHERE previous.class_id = c.id AND previous.is_active = TRUE
               AND previous.position < m.position
           )
           OR NOT EXISTS (
             SELECT 1 FROM modules previous
             WHERE previous.class_id = c.id AND previous.is_active = TRUE
               AND previous.position < m.position
               AND (
                 EXISTS (
                   SELECT 1 FROM module_contents prior_content
                   WHERE prior_content.module_id = previous.id
                     AND prior_content.is_active = TRUE AND prior_content.is_required = TRUE
                     AND NOT EXISTS (
                       SELECT 1 FROM student_content_progress prior_progress
                       WHERE prior_progress.module_content_id = prior_content.id
                         AND prior_progress.student_id = $2 AND prior_progress.status = 'COMPLETED'
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM assignments prior_assignment
                   WHERE prior_assignment.module_id = previous.id
                     AND prior_assignment.is_active = TRUE AND prior_assignment.is_required = TRUE
                     AND NOT EXISTS (
                       SELECT 1 FROM assignment_submissions submission
                       WHERE submission.assignment_id = prior_assignment.id
                         AND submission.student_id = $2
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM assessments prior_assessment
                   WHERE prior_assessment.module_id = previous.id
                     AND prior_assessment.is_active = TRUE AND prior_assessment.is_required = TRUE
                     AND NOT EXISTS (
                       SELECT 1 FROM assessment_attempts attempt
                       WHERE attempt.assessment_id = prior_assessment.id
                         AND attempt.student_id = $2
                         AND attempt.status IN ('SUBMITTED', 'GRADED')
                     )
                 )
               )
           )
         )
       FOR UPDATE OF lg`,
      [gameId, getUserId2(response)]
    );
    const game = rows[0];
    if (!game) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Game tidak ditemukan atau modul masih terkunci." });
      return;
    }
    if (game.configuration.questions.length === 0) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "Game tautan eksternal tidak menerima jawaban melalui LMS." });
      return;
    }
    const questionIds = new Set(game.configuration.questions.map((question) => question.id));
    if (answers.length !== questionIds.size || answers.some(
      (answer) => !questionIds.has(answer.questionId) || !game.configuration.questions.find((question) => question.id === answer.questionId)?.choices.some((choice) => choice.id === answer.choiceId)
    )) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "Jawaban harus mencakup setiap soal dengan pilihan yang tersedia." });
      return;
    }
    const correctCount = game.configuration.questions.reduce((total, question) => total + Number(answers.some(
      (answer) => answer.questionId === question.id && answer.choiceId === question.answerId
    )), 0);
    const maxScore = game.configuration.questions.length;
    const score = Math.round(correctCount / maxScore * 100);
    const passed = score >= game.configuration.passScore;
    const { rows: attemptRows } = await client.query(
      `INSERT INTO learning_game_attempts
         (learning_game_id, student_id, score, max_score, passed, answers)
       VALUES ($1, $2, $3, 100, $4, $5::jsonb)
       RETURNING id`,
      [
        game.id,
        getUserId2(response),
        score,
        passed,
        JSON.stringify(answers.map(({ questionId, choiceId }) => ({ questionId, choiceId })))
      ]
    );
    if (passed && game.is_required) {
      await client.query(
        `INSERT INTO student_content_progress
           (student_id, module_content_id, status, started_at, completed_at)
         VALUES ($1, $2, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (student_id, module_content_id) DO UPDATE
         SET status = 'COMPLETED',
             completed_at = COALESCE(student_content_progress.completed_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP`,
        [getUserId2(response), game.content_id]
      );
    }
    const { rows: moduleCounts } = await client.query(
      `SELECT
         ((SELECT COUNT(*) FROM module_contents
           WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE)
          + (SELECT COUNT(*) FROM assignments
             WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE)
          + (SELECT COUNT(*) FROM assessments
             WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE))::integer AS required_count,
         (SELECT COUNT(*) FROM module_contents mc
          JOIN student_content_progress scp ON scp.module_content_id = mc.id
            AND scp.student_id = $1 AND scp.status = 'COMPLETED'
          WHERE mc.module_id = $2 AND mc.is_active = TRUE AND mc.is_required = TRUE)
          + (SELECT COUNT(*) FROM assignments a
             WHERE a.module_id = $2 AND a.is_active = TRUE AND a.is_required = TRUE
               AND EXISTS (SELECT 1 FROM assignment_submissions submission
                           WHERE submission.assignment_id = a.id AND submission.student_id = $1))
          + (SELECT COUNT(*) FROM assessments a
             WHERE a.module_id = $2 AND a.is_active = TRUE AND a.is_required = TRUE
               AND EXISTS (SELECT 1 FROM assessment_attempts attempt
                           WHERE attempt.assessment_id = a.id AND attempt.student_id = $1
                             AND attempt.status IN ('SUBMITTED', 'GRADED')))::integer AS completed_count,
         (SELECT next_module.id FROM modules current
          JOIN modules next_module ON next_module.class_id = current.class_id
            AND next_module.position > current.position AND next_module.is_active = TRUE
          WHERE current.id = $2 AND current.is_active = TRUE
          ORDER BY next_module.position LIMIT 1) AS next_module_id`,
      [getUserId2(response), game.module_id]
    );
    const counts = moduleCounts[0];
    if (!counts) throw new Error("Progres modul tidak dapat dihitung.");
    const progress = counts.required_count === 0 ? 100 : Math.round(counts.completed_count / counts.required_count * 100);
    const moduleCompleted = counts.completed_count === counts.required_count;
    await client.query(
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
      [getUserId2(response), game.module_id, moduleCompleted ? "COMPLETED" : "IN_PROGRESS", progress]
    );
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'GAME_COMPLETED', 'GAME', $2, $3::jsonb)`,
      [getUserId2(response), game.id, JSON.stringify({ score, passed })]
    );
    await client.query("COMMIT");
    response.json({
      attemptId: attemptRows[0]?.id,
      score,
      maxScore: 100,
      passed,
      passScore: game.configuration.passScore,
      moduleProgress: progress,
      moduleCompleted,
      nextModuleUnlocked: moduleCompleted && counts.next_module_id !== null
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

// src/modules/assignments/assignments.routes.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { extname as extname2, resolve as resolve4 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
import { Router as Router6 } from "express";
import multer2 from "multer";
var teacherRouter3 = Router6();
var studentRouter3 = Router6();
teacherRouter3.use(requireTeacher);
studentRouter3.use(requireStudent);
var privateAssignmentStorage = resolve4(
  fileURLToPath4(new URL("../../../storage/assignments/", import.meta.url))
);
var assignmentUpload = multer2({
  storage: multer2.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    if (![".pdf", ".docx", ".jpg", ".jpeg", ".png"].includes(extname2(file.originalname).toLowerCase())) {
      callback(new Error("Format tugas tidak didukung. Gunakan PDF, DOCX, JPG, atau PNG."));
      return;
    }
    callback(null, true);
  }
});
var idFrom3 = (value) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
var userIdFrom = (response) => response.locals.authUser.id;
var dateFrom = (value) => {
  if (value === void 0 || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return void 0;
  return new Date(value).toISOString();
};
var assignmentSubmissionType = (value) => value === "FILE" || value === "LINK" || value === "TEXT" ? value : null;
var parseQuestions = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const questions = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw;
    const type = item.type;
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    const points = item.points === void 0 ? 1 : item.points;
    if (!["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"].includes(String(type)) || prompt.length < 3 || prompt.length > 2e3 || typeof points !== "number" || !Number.isFinite(points) || points <= 0 || points > 100) return null;
    let options = null;
    let answerKey = null;
    if (type === "MULTIPLE_CHOICE") {
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6) return null;
      options = [];
      const optionIds = /* @__PURE__ */ new Set();
      for (const option of item.options) {
        if (!option || typeof option !== "object") return null;
        const choice = option;
        if (typeof choice.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(choice.id) || optionIds.has(choice.id) || typeof choice.text !== "string" || choice.text.trim().length < 1 || choice.text.trim().length > 500) return null;
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
      type,
      prompt,
      options,
      answerKey,
      points
    });
    void index;
  }
  return questions;
};
var moduleIsUnlocked = async (client, moduleId, studentId) => {
  const { rows } = await client.query(
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
    [moduleId, studentId]
  );
  return rows[0]?.unlocked === true;
};
var refreshModuleProgress3 = async (client, moduleId) => {
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
    [moduleId]
  );
};
var validateSubmissionFile = (fileName, bytes) => {
  const extension = extname2(fileName).toLowerCase();
  let containsWordDocument = false;
  if (extension === ".docx" && bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4) {
    const searchStart = Math.max(0, bytes.length - 65557);
    for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
      if (offset + 22 > bytes.length || bytes.readUInt32LE(offset) !== 101010256) continue;
      const entries = bytes.readUInt16LE(offset + 10);
      let directoryOffset = bytes.readUInt32LE(offset + 16);
      for (let index = 0; index < entries; index += 1) {
        if (directoryOffset + 46 > bytes.length || bytes.readUInt32LE(directoryOffset) !== 33639248) break;
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
  const valid = extension === ".pdf" ? bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-" : extension === ".jpg" || extension === ".jpeg" ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : extension === ".png" ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : extension === ".docx" ? containsWordDocument : false;
  return valid ? extension : null;
};
var handleUpload = (request, response, next) => {
  assignmentUpload.single("file")(request, response, (error) => {
    if (error instanceof multer2.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE" ? "Ukuran file maksimal 20 MB." : "File tidak dapat diproses."
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
var sendSubmissionFile = async (response, fileKey) => {
  const signedUrl = await createPrivateDownloadUrl("assignments", fileKey, true);
  if (signedUrl) {
    response.redirect(302, signedUrl);
    return;
  }
  let contents;
  try {
    contents = await readPrivateFile("assignments", fileKey);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      response.status(404).json({ error: "File tugas tidak ditemukan di penyimpanan." });
      return;
    }
    throw error;
  }
  const mimeType = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png"
  };
  response.set("Content-Type", mimeType[extname2(fileKey).toLowerCase()] ?? "application/octet-stream").set("Content-Disposition", `attachment; filename="${fileKey}"`).set("Content-Length", String(contents.length)).set("X-Content-Type-Options", "nosniff").set("Cache-Control", "private, no-store").send(contents);
};
teacherRouter3.get("/classes/:classId/assignments", async (request, response) => {
  const classId = idFrom3(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    `SELECT 1 FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom(response)]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
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
    [classId, userIdFrom(response)]
  );
  response.json({ assignments: rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    moduleId: row.module_id,
    moduleTitle: row.module_title,
    startsAt: row.starts_at,
    dueAt: row.due_at,
    weight: Number(row.weight),
    isRequired: row.is_required,
    allowLateSubmission: row.allow_late_submission,
    allowRevision: row.allow_revision,
    submissionType: row.submission_type,
    submissionCount: row.submission_count
  })) });
});
teacherRouter3.post("/classes/:classId/assignments", async (request, response) => {
  const classId = idFrom3(request.params.classId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const instructions = typeof request.body?.instructions === "string" ? request.body.instructions.trim() || null : null;
  const moduleId = request.body?.moduleId === "" || request.body?.moduleId === null ? null : request.body?.moduleId === void 0 ? null : idFrom3(request.body.moduleId);
  const startsAt = dateFrom(request.body?.startsAt);
  const dueAt = dateFrom(request.body?.dueAt);
  const submissionType = assignmentSubmissionType(request.body?.submissionType);
  const weight = request.body?.weight === void 0 ? 50 : request.body.weight;
  if (!classId || title.length < 2 || title.length > 180 || description !== null && description.length > 5e3 || instructions !== null && instructions.length > 1e4 || request.body?.moduleId !== void 0 && request.body?.moduleId !== null && request.body?.moduleId !== "" && !moduleId || startsAt === void 0 || dueAt === void 0 || startsAt && dueAt && Date.parse(startsAt) > Date.parse(dueAt) || !submissionType || typeof weight !== "number" || !Number.isFinite(weight) || weight < 50 || weight > 100 || request.body?.isRequired !== void 0 && typeof request.body.isRequired !== "boolean" || request.body?.allowLateSubmission !== void 0 && typeof request.body.allowLateSubmission !== "boolean" || request.body?.allowRevision !== void 0 && typeof request.body.allowRevision !== "boolean") {
    response.status(400).json({ error: "Data tugas tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
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
        classId,
        moduleId,
        title,
        description,
        instructions,
        startsAt,
        dueAt,
        weight,
        request.body.isRequired !== false,
        request.body.allowLateSubmission === true,
        request.body.allowRevision === true,
        submissionType,
        userIdFrom(response)
      ]
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
        [assignment.module_id, assignment.id]
      );
      await refreshModuleProgress3(client, assignment.module_id);
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'ASSIGNMENT_CREATED', 'ASSIGNMENT', $2)`,
      [userIdFrom(response), assignment.id]
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
teacherRouter3.put("/assignments/:assignmentId", async (request, response) => {
  const assignmentId = idFrom3(request.params.assignmentId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const instructions = typeof request.body?.instructions === "string" ? request.body.instructions.trim() || null : null;
  const moduleId = request.body?.moduleId === "" || request.body?.moduleId === null ? null : request.body?.moduleId === void 0 ? null : idFrom3(request.body.moduleId);
  const startsAt = dateFrom(request.body?.startsAt);
  const dueAt = dateFrom(request.body?.dueAt);
  const submissionType = assignmentSubmissionType(request.body?.submissionType);
  const weight = request.body?.weight;
  if (!assignmentId || title.length < 2 || title.length > 180 || description !== null && description.length > 5e3 || instructions !== null && instructions.length > 1e4 || request.body?.moduleId !== void 0 && request.body?.moduleId !== null && request.body?.moduleId !== "" && !moduleId || startsAt === void 0 || dueAt === void 0 || startsAt && dueAt && Date.parse(startsAt) > Date.parse(dueAt) || !submissionType || typeof weight !== "number" || !Number.isFinite(weight) || weight < 50 || weight > 100 || request.body?.isRequired !== void 0 && typeof request.body.isRequired !== "boolean" || request.body?.allowLateSubmission !== void 0 && typeof request.body.allowLateSubmission !== "boolean" || request.body?.allowRevision !== void 0 && typeof request.body.allowRevision !== "boolean") {
    response.status(400).json({ error: "Data tugas tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existingRows } = await client.query(
      `SELECT a.class_id, a.module_id, a.submission_type,
              EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.assignment_id = a.id) AS has_submissions
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
       WHERE a.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND a.is_active = TRUE
       FOR UPDATE OF a`,
      [assignmentId, userIdFrom(response)]
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
    const { rows: updatedRows } = await client.query(
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
        assignmentId,
        moduleId,
        title,
        description,
        instructions,
        startsAt,
        dueAt,
        weight,
        request.body.isRequired !== false,
        request.body.allowLateSubmission === true,
        request.body.allowRevision === true,
        submissionType,
        userIdFrom(response)
      ]
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
        [updated.module_id, assignmentId]
      );
    }
    for (const moduleToRefresh of new Set([existing.module_id, updated.module_id].filter((id) => id !== null))) {
      await refreshModuleProgress3(client, moduleToRefresh);
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
teacherRouter3.delete("/assignments/:assignmentId", async (request, response) => {
  const assignmentId = idFrom3(request.params.assignmentId);
  if (!assignmentId) {
    response.status(400).json({ error: "ID tugas tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE assignments a SET is_active = FALSE
       FROM classes c
       WHERE a.id = $1 AND a.class_id = c.id AND c.teacher_id = $2
         AND c.is_active = TRUE AND a.is_active = TRUE
       RETURNING a.module_id`,
      [assignmentId, userIdFrom(response)]
    );
    const assignment = rows[0];
    if (!assignment) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Tugas tidak ditemukan." });
      return;
    }
    await client.query("DELETE FROM module_requirements WHERE assignment_id = $1", [assignmentId]);
    if (assignment.module_id) await refreshModuleProgress3(client, assignment.module_id);
    await client.query("COMMIT");
    response.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
teacherRouter3.get("/assignments/:assignmentId/submissions", async (request, response) => {
  const assignmentId = idFrom3(request.params.assignmentId);
  if (!assignmentId) {
    response.status(400).json({ error: "ID tugas tidak valid." });
    return;
  }
  const { rows } = await pool.query(
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
    [assignmentId, userIdFrom(response)]
  );
  const { rowCount } = await pool.query(
    `SELECT 1 FROM assignments a JOIN classes c ON c.id = a.class_id
     WHERE a.id = $1 AND c.teacher_id = $2`,
    [assignmentId, userIdFrom(response)]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Tugas tidak ditemukan." });
    return;
  }
  response.json({ submissions: rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    fullName: row.full_name,
    nisn: row.nisn.trim(),
    type: row.submission_type,
    fileUrl: row.file_key ? `/api/assignment-submissions/${row.id}/file` : null,
    link: row.external_url,
    text: row.response_text,
    status: row.status,
    submittedAt: row.submitted_at,
    score: row.score === null ? null : Number(row.score),
    maxScore: row.max_score === null ? null : Number(row.max_score),
    feedback: row.feedback
  })) });
});
teacherRouter3.put("/assignment-submissions/:submissionId/grade", async (request, response) => {
  const submissionId = idFrom3(request.params.submissionId);
  const score = request.body?.score;
  const maxScore = request.body?.maxScore;
  const feedback = typeof request.body?.feedback === "string" ? request.body.feedback.trim() || null : null;
  if (!submissionId || typeof score !== "number" || !Number.isFinite(score) || typeof maxScore !== "number" || !Number.isFinite(maxScore) || score < 0 || maxScore <= 0 || score > maxScore || feedback !== null && feedback.length > 5e3) {
    response.status(400).json({ error: "Nilai atau umpan balik tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT s.student_id, s.id AS submission_id, a.module_id
       FROM assignment_submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN classes c ON c.id = a.class_id
       WHERE s.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE`,
      [submissionId, userIdFrom(response)]
    );
    const submission = rows[0];
    if (!submission) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Pengumpulan tugas tidak ditemukan." });
      return;
    }
    await client.query(
      `UPDATE assignment_submissions SET status = 'GRADED' WHERE id = $1`,
      [submissionId]
    );
    await client.query(
      `INSERT INTO grades
         (student_id, assignment_submission_id, graded_by, score, max_score, feedback)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (assignment_submission_id) DO UPDATE
       SET graded_by = EXCLUDED.graded_by, score = EXCLUDED.score,
           max_score = EXCLUDED.max_score, feedback = EXCLUDED.feedback, graded_at = CURRENT_TIMESTAMP`,
      [submission.student_id, submissionId, userIdFrom(response), score, maxScore, feedback]
    );
    if (submission.module_id) await refreshModuleProgress3(client, submission.module_id);
    await client.query("COMMIT");
    response.json({ message: "Nilai tugas tersimpan." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
teacherRouter3.get("/classes/:classId/assessments", async (request, response) => {
  const classId = idFrom3(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    `SELECT 1 FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom(response)]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.description, a.module_id, m.title AS module_title,
            a.starts_at, a.due_at, a.max_attempts, a.pass_score, a.is_required,
            (SELECT COUNT(*)::integer FROM questions q WHERE q.assessment_id = a.id) AS question_count,
            (SELECT COUNT(*)::integer FROM assessment_attempts aa WHERE aa.assessment_id = a.id) AS attempt_count
     FROM assessments a JOIN classes c ON c.id = a.class_id
     LEFT JOIN modules m ON m.id = a.module_id
     WHERE a.class_id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND a.is_active = TRUE
     ORDER BY a.due_at NULLS LAST, a.created_at DESC`,
    [classId, userIdFrom(response)]
  );
  response.json({ assessments: rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    moduleId: row.module_id,
    moduleTitle: row.module_title,
    startsAt: row.starts_at,
    dueAt: row.due_at,
    maxAttempts: row.max_attempts,
    passScore: row.pass_score === null ? null : Number(row.pass_score),
    isRequired: row.is_required,
    questionCount: row.question_count,
    attemptCount: row.attempt_count
  })) });
});
teacherRouter3.post("/classes/:classId/assessments", async (request, response) => {
  const classId = idFrom3(request.params.classId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description = typeof request.body?.description === "string" ? request.body.description.trim() || null : null;
  const moduleId = request.body?.moduleId === "" || request.body?.moduleId === null ? null : request.body?.moduleId === void 0 ? null : idFrom3(request.body.moduleId);
  const startsAt = dateFrom(request.body?.startsAt);
  const dueAt = dateFrom(request.body?.dueAt);
  const maxAttempts = request.body?.maxAttempts === void 0 ? 1 : request.body.maxAttempts;
  const passScore = request.body?.passScore === "" || request.body?.passScore === void 0 ? null : request.body?.passScore;
  const questions = parseQuestions(request.body?.questions);
  if (!classId || title.length < 2 || title.length > 180 || description !== null && description.length > 5e3 || request.body?.moduleId !== void 0 && request.body?.moduleId !== null && request.body?.moduleId !== "" && !moduleId || startsAt === void 0 || dueAt === void 0 || startsAt && dueAt && Date.parse(startsAt) > Date.parse(dueAt) || typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 || passScore !== null && (typeof passScore !== "number" || !Number.isFinite(passScore) || passScore < 0 || passScore > 100) || request.body?.isRequired !== void 0 && typeof request.body.isRequired !== "boolean" || !questions) {
    response.status(400).json({ error: "Data asesmen atau soal tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO assessments
         (class_id, module_id, title, description, starts_at, due_at, max_attempts, pass_score, is_required)
       SELECT c.id, m.id, $3, $4, $5, $6, $7, $8, $9
       FROM classes c
       LEFT JOIN modules m ON m.id = $2 AND m.class_id = c.id AND m.is_active = TRUE
       WHERE c.id = $1 AND c.teacher_id = $10 AND c.is_active = TRUE
         AND ($2::bigint IS NULL OR m.id IS NOT NULL)
       RETURNING id, module_id`,
      [
        classId,
        moduleId,
        title,
        description,
        startsAt,
        dueAt,
        maxAttempts,
        passScore,
        request.body.isRequired !== false,
        userIdFrom(response)
      ]
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
          assessment.id,
          question.type,
          question.prompt,
          question.options === null ? null : JSON.stringify(question.options),
          question.answerKey === null ? null : JSON.stringify(question.answerKey),
          question.points,
          position + 1
        ]
      );
    }
    if (assessment.module_id && request.body.isRequired !== false) {
      await client.query(
        "INSERT INTO module_requirements (module_id, assessment_id) VALUES ($1, $2)",
        [assessment.module_id, assessment.id]
      );
      await refreshModuleProgress3(client, assessment.module_id);
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'ASSESSMENT_CREATED', 'ASSESSMENT', $2)`,
      [userIdFrom(response), assessment.id]
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
teacherRouter3.delete("/assessments/:assessmentId", async (request, response) => {
  const assessmentId = idFrom3(request.params.assessmentId);
  if (!assessmentId) {
    response.status(400).json({ error: "ID asesmen tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE assessments a SET is_active = FALSE
       FROM classes c
       WHERE a.id = $1 AND a.class_id = c.id AND c.teacher_id = $2
         AND c.is_active = TRUE AND a.is_active = TRUE
       RETURNING a.module_id`,
      [assessmentId, userIdFrom(response)]
    );
    const assessment = rows[0];
    if (!assessment) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Asesmen tidak ditemukan." });
      return;
    }
    await client.query("DELETE FROM module_requirements WHERE assessment_id = $1", [assessmentId]);
    if (assessment.module_id) await refreshModuleProgress3(client, assessment.module_id);
    await client.query("COMMIT");
    response.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
teacherRouter3.get("/assessments/:assessmentId/attempts", async (request, response) => {
  const assessmentId = idFrom3(request.params.assessmentId);
  if (!assessmentId) {
    response.status(400).json({ error: "ID asesmen tidak valid." });
    return;
  }
  const { rows } = await pool.query(
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
    [assessmentId, userIdFrom(response)]
  );
  const { rowCount } = await pool.query(
    `SELECT 1 FROM assessments a JOIN classes c ON c.id = a.class_id
     WHERE a.id = $1 AND c.teacher_id = $2`,
    [assessmentId, userIdFrom(response)]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Asesmen tidak ditemukan." });
    return;
  }
  response.json({ attempts: rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    fullName: row.full_name,
    nisn: row.nisn.trim(),
    attemptNumber: row.attempt_number,
    status: row.status,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    score: row.score === null ? null : Number(row.score),
    maxScore: row.max_score === null ? null : Number(row.max_score),
    feedback: row.feedback,
    answers: row.answers.map((answer) => ({ ...answer, points: Number(answer.points) }))
  })) });
});
teacherRouter3.put("/assessment-attempts/:attemptId/grade", async (request, response) => {
  const attemptId = idFrom3(request.params.attemptId);
  const score = request.body?.score;
  const maxScore = request.body?.maxScore;
  const feedback = typeof request.body?.feedback === "string" ? request.body.feedback.trim() || null : null;
  if (!attemptId || typeof score !== "number" || !Number.isFinite(score) || typeof maxScore !== "number" || !Number.isFinite(maxScore) || score < 0 || maxScore <= 0 || score > maxScore || feedback !== null && feedback.length > 5e3) {
    response.status(400).json({ error: "Nilai atau umpan balik tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT aa.student_id, a.module_id, c.teacher_id
       FROM assessment_attempts aa JOIN assessments a ON a.id = aa.assessment_id
       JOIN classes c ON c.id = a.class_id
       WHERE aa.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE`,
      [attemptId, userIdFrom(response)]
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
      [attempt.student_id, attemptId, userIdFrom(response), score, maxScore, feedback]
    );
    if (attempt.module_id) await refreshModuleProgress3(client, attempt.module_id);
    await client.query("COMMIT");
    response.json({ message: "Nilai asesmen tersimpan." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
var loadStudentClass = async (classId, studentId) => {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM classes c JOIN class_students cs ON cs.class_id = c.id
     WHERE c.id = $1 AND c.is_active = TRUE AND cs.student_id = $2 AND cs.is_active = TRUE`,
    [classId, studentId]
  );
  return rowCount === 1;
};
studentRouter3.get("/classes/:classId/assignments", async (request, response) => {
  const classId = idFrom3(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  if (!await loadStudentClass(classId, studentId)) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
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
    [classId, studentId]
  );
  const assignments = [];
  for (const row of rows) {
    const unlocked = !row.module_id || await moduleIsUnlocked(pool, row.module_id, studentId);
    assignments.push({
      id: row.id,
      title: row.title,
      description: row.description,
      instructions: row.instructions,
      moduleId: row.module_id,
      moduleTitle: row.module_title,
      startsAt: row.starts_at,
      dueAt: row.due_at,
      submissionType: row.submission_type,
      isRequired: row.is_required,
      allowLateSubmission: row.allow_late_submission,
      allowRevision: row.allow_revision,
      unlocked,
      submission: row.submission_id ? {
        id: row.submission_id,
        attemptNumber: row.attempt_number,
        status: row.status,
        submittedAt: row.submitted_at,
        score: row.score === null ? null : Number(row.score),
        maxScore: row.max_score === null ? null : Number(row.max_score),
        feedback: row.feedback,
        fileUrl: row.file_key ? `/api/learning/assignment-submissions/${row.submission_id}/file` : null,
        link: row.external_url,
        text: row.response_text
      } : null
    });
  }
  response.json({ assignments });
});
studentRouter3.post("/assignments/:assignmentId/submission-upload-url", async (request, response) => {
  if (!isPrivateSupabaseStorageEnabled()) {
    response.json({ mode: "local" });
    return;
  }
  const assignmentId = idFrom3(request.params.assignmentId);
  const studentId = userIdFrom(response);
  const fileName = typeof request.body?.fileName === "string" ? request.body.fileName : "";
  const fileSize = request.body?.fileSize;
  const extension = extname2(fileName).toLowerCase();
  if (!assignmentId || ![".pdf", ".docx", ".jpg", ".jpeg", ".png"].includes(extension) || typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 20 * 1024 * 1024) {
    response.status(400).json({ error: "Nama atau ukuran file tugas tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT a.module_id, a.submission_type, a.starts_at, a.due_at,
            a.allow_late_submission, a.allow_revision, (a.is_active AND c.is_active) AS active
     FROM assignments a JOIN classes c ON c.id = a.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE a.id = $1`,
    [assignmentId, studentId]
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
  const { rows: previousRows } = await pool.query(
    `SELECT attempt_number FROM assignment_submissions
     WHERE assignment_id = $1 AND student_id = $2
     ORDER BY attempt_number DESC LIMIT 1`,
    [assignmentId, studentId]
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
studentRouter3.post("/assignments/:assignmentId/submissions", handleUpload, async (request, response) => {
  const assignmentId = idFrom3(request.params.assignmentId);
  const studentId = userIdFrom(response);
  if (!assignmentId) {
    response.status(400).json({ error: "ID tugas tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT a.class_id, a.module_id, a.submission_type, a.starts_at, a.due_at,
            a.allow_late_submission, a.allow_revision, (a.is_active AND c.is_active) AS active
     FROM assignments a JOIN classes c ON c.id = a.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE a.id = $1`,
    [assignmentId, studentId]
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
  const { rows: previousRows } = await pool.query(
    `SELECT attempt_number FROM assignment_submissions
     WHERE assignment_id = $1 AND student_id = $2
     ORDER BY attempt_number DESC LIMIT 1`,
    [assignmentId, studentId]
  );
  if (previousRows.length > 0 && !assignment.allow_revision) {
    response.status(409).json({ error: "Pengumpulan ulang tidak diizinkan untuk tugas ini." });
    return;
  }
  const attemptNumber = (previousRows[0]?.attempt_number ?? 0) + 1;
  let fileKey = null;
  let externalUrl = null;
  let responseText = null;
  if (assignment.submission_type === "FILE") {
    const file = request.file;
    const uploadedFileKey = typeof request.body?.fileKey === "string" ? request.body.fileKey : "";
    let fileContents = file?.buffer ?? null;
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
      if (uploadedFileKey) await deletePrivateFile("assignments", uploadedFileKey).catch(() => void 0);
      response.status(400).json({ error: "Unggah PDF, DOCX, JPG, atau PNG yang valid." });
      return;
    }
    if (file) {
      fileKey = `${randomUUID3()}${extension}`;
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
    if (!text || text.length > 5e4) {
      response.status(400).json({ error: "Jawaban wajib diisi dan maksimal 50.000 karakter." });
      return;
    }
    responseText = text;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: inserted } = await client.query(
      `INSERT INTO assignment_submissions
         (assignment_id, student_id, attempt_number, submission_type, file_key,
          external_url, response_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        assignmentId,
        studentId,
        attemptNumber,
        assignment.submission_type,
        fileKey,
        externalUrl,
        responseText,
        late ? "LATE" : "SUBMITTED"
      ]
    );
    if (assignment.module_id) await refreshModuleProgress3(client, assignment.module_id);
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'ASSIGNMENT_SUBMITTED', 'ASSIGNMENT', $2)`,
      [studentId, assignmentId]
    );
    await client.query("COMMIT");
    response.status(201).json({
      id: inserted[0]?.id,
      attemptNumber,
      status: late ? "LATE" : "SUBMITTED",
      submittedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (fileKey) await deletePrivateFile("assignments", fileKey).catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
});
var loadStudentAssessment = async (assessmentId, studentId) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.class_id, a.module_id, a.starts_at, a.due_at, a.max_attempts,
            (a.is_active AND c.is_active) AS active,
            (SELECT COUNT(*)::integer FROM assessment_attempts aa
             WHERE aa.assessment_id = a.id AND aa.student_id = $2
               AND aa.status IN ('SUBMITTED', 'GRADED')) AS attempt_count
     FROM assessments a JOIN classes c ON c.id = a.class_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE a.id = $1`,
    [assessmentId, studentId]
  );
  return rows[0];
};
studentRouter3.get("/classes/:classId/assessments", async (request, response) => {
  const classId = idFrom3(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  if (!await loadStudentClass(classId, studentId)) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
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
    [classId, studentId]
  );
  const assessments = [];
  for (const row of rows) {
    const unlocked = !row.module_id || await moduleIsUnlocked(pool, row.module_id, studentId);
    assessments.push({
      id: row.id,
      title: row.title,
      description: row.description,
      moduleId: row.module_id,
      moduleTitle: row.module_title,
      startsAt: row.starts_at,
      dueAt: row.due_at,
      maxAttempts: row.max_attempts,
      attemptCount: row.attempt_count,
      passScore: row.pass_score === null ? null : Number(row.pass_score),
      isRequired: row.is_required,
      questionCount: row.question_count,
      unlocked,
      status: row.latest_status,
      score: row.score === null ? null : Number(row.score),
      maxScore: row.max_score === null ? null : Number(row.max_score),
      feedback: row.feedback
    });
  }
  response.json({ assessments });
});
studentRouter3.get("/assessments/:assessmentId", async (request, response) => {
  const assessmentId = idFrom3(request.params.assessmentId);
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
  const { rows: questions } = await pool.query(
    `SELECT id, question_type, prompt, options, points
     FROM questions WHERE assessment_id = $1 ORDER BY position`,
    [assessmentId]
  );
  response.json({ assessment: {
    id: assessment.id,
    startsAt: assessment.starts_at,
    dueAt: assessment.due_at,
    maxAttempts: assessment.max_attempts,
    questions: questions.map((question) => ({
      id: question.id,
      type: question.question_type,
      prompt: question.prompt,
      options: question.options,
      points: Number(question.points)
    }))
  } });
});
studentRouter3.post("/assessments/:assessmentId/attempts", async (request, response) => {
  const assessmentId = idFrom3(request.params.assessmentId);
  const rawAnswers = request.body?.answers;
  if (!assessmentId || !Array.isArray(rawAnswers) || rawAnswers.length < 1 || rawAnswers.length > 100 || rawAnswers.some(
    (item) => !item || typeof item !== "object" || typeof item.questionId !== "string" || !Object.hasOwn(item, "answer")
  )) {
    response.status(400).json({ error: "Jawaban asesmen tidak valid." });
    return;
  }
  const studentId = userIdFrom(response);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT a.id, a.module_id, a.starts_at, a.due_at, a.max_attempts, a.class_id,
              c.teacher_id
       FROM assessments a JOIN classes c ON c.id = a.class_id
       JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
       WHERE a.id = $1 AND a.is_active = TRUE AND c.is_active = TRUE
       FOR UPDATE OF a`,
      [assessmentId, studentId]
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
    const { rows: previous } = await client.query(
      `SELECT COUNT(*)::integer AS attempts FROM assessment_attempts
       WHERE assessment_id = $1 AND student_id = $2 AND status IN ('SUBMITTED', 'GRADED')`,
      [assessmentId, studentId]
    );
    const attemptNumber = Number(previous[0]?.attempts ?? 0) + 1;
    if (attemptNumber > assessment.max_attempts) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Batas jumlah percobaan asesmen tercapai." });
      return;
    }
    const { rows: questions } = await client.query(
      `SELECT id, question_type, answer_key, points, options FROM questions
       WHERE assessment_id = $1 ORDER BY position`,
      [assessmentId]
    );
    const answerMap = /* @__PURE__ */ new Map();
    for (const item of rawAnswers) {
      if (answerMap.has(item.questionId)) {
        await client.query("ROLLBACK");
        response.status(400).json({ error: "Terdapat jawaban soal yang duplikat." });
        return;
      }
      answerMap.set(item.questionId, item.answer);
    }
    if (questions.length === 0 || answerMap.size !== questions.length || questions.some((question) => !answerMap.has(question.id))) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "Jawaban harus mencakup seluruh soal asesmen." });
      return;
    }
    const { rows: attempts } = await client.query(
      `INSERT INTO assessment_attempts (assessment_id, student_id, attempt_number, status, submitted_at)
       VALUES ($1, $2, $3, 'SUBMITTED', CURRENT_TIMESTAMP) RETURNING id`,
      [assessmentId, studentId, attemptNumber]
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
      let awarded = null;
      if (question.question_type === "ESSAY") {
        if (typeof answer !== "string" || !answer.trim() || answer.trim().length > 1e4) {
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
        if (question.question_type === "MULTIPLE_CHOICE" && (!Array.isArray(question.options) || !question.options.some(
          (option) => typeof option === "object" && option !== null && "id" in option && option.id === answer
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
        if (question.question_type === "SHORT_ANSWER" && (typeof answer !== "string" || !answer.trim() || answer.trim().length > 1e3)) {
          await client.query("ROLLBACK");
          response.status(400).json({ error: "Jawaban singkat wajib diisi dan maksimal 1.000 karakter." });
          return;
        }
        const key = question.answer_key;
        const isCorrect = question.question_type === "SHORT_ANSWER" ? typeof answer === "string" && typeof key === "string" && answer.trim().toLocaleLowerCase("id-ID") === key.trim().toLocaleLowerCase("id-ID") : answer === key;
        awarded = isCorrect ? points : 0;
        earned += awarded;
      }
      await client.query(
        `INSERT INTO assessment_answers (attempt_id, question_id, answer, awarded_points)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [attemptId, question.id, JSON.stringify(answer), awarded]
      );
    }
    if (!hasEssay) {
      await client.query("UPDATE assessment_attempts SET status = 'GRADED' WHERE id = $1", [attemptId]);
      await client.query(
        `INSERT INTO grades (student_id, assessment_attempt_id, graded_by, score, max_score)
         VALUES ($1, $2, $3, $4, $5)`,
        [studentId, attemptId, assessment.teacher_id, earned, maximum]
      );
    }
    if (assessment.module_id) await refreshModuleProgress3(client, assessment.module_id);
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'ASSESSMENT_SUBMITTED', 'ASSESSMENT', $2, $3::jsonb)`,
      [studentId, assessmentId, JSON.stringify({ attemptNumber })]
    );
    await client.query("COMMIT");
    response.status(201).json({
      attemptId,
      attemptNumber,
      status: hasEssay ? "SUBMITTED" : "GRADED",
      score: hasEssay ? null : earned,
      maxScore: hasEssay ? null : maximum,
      awaitingTeacher: hasEssay
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
studentRouter3.get("/assignment-submissions/:submissionId/file", async (request, response) => {
  const submissionId = idFrom3(request.params.submissionId);
  if (!submissionId) {
    response.status(400).json({ error: "ID pengumpulan tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT s.file_key FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN class_students cs ON cs.class_id = a.class_id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE s.id = $1 AND s.student_id = $2 AND a.is_active = TRUE`,
    [submissionId, userIdFrom(response)]
  );
  if (!rows[0]) {
    response.status(404).json({ error: "File pengumpulan tidak ditemukan." });
    return;
  }
  await sendSubmissionFile(response, rows[0].file_key);
});
teacherRouter3.get("/assignment-submissions/:submissionId/file", async (request, response) => {
  const submissionId = idFrom3(request.params.submissionId);
  if (!submissionId) {
    response.status(400).json({ error: "ID pengumpulan tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT s.file_key FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN classes c ON c.id = a.class_id
     WHERE s.id = $1 AND c.teacher_id = $2`,
    [submissionId, userIdFrom(response)]
  );
  if (!rows[0]) {
    response.status(404).json({ error: "File pengumpulan tidak ditemukan." });
    return;
  }
  await sendSubmissionFile(response, rows[0].file_key);
});

// src/modules/attendance/attendance.routes.ts
import { Router as Router7 } from "express";
var statuses = /* @__PURE__ */ new Set(["PRESENT", "PERMISSION", "SICK", "ABSENT"]);
var teacherRouter4 = Router7();
var studentRouter4 = Router7();
teacherRouter4.use(requireTeacher);
studentRouter4.use(requireStudent);
var idFrom4 = (value) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
var userIdFrom2 = (response) => response.locals.authUser.id;
var parseSessionDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
};
var parseAttendance = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null;
  const seen = /* @__PURE__ */ new Set();
  const records = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw;
    const studentId = idFrom4(item.studentId);
    if (!studentId || typeof item.status !== "string" || !statuses.has(item.status) || item.notes !== void 0 && item.notes !== null && typeof item.notes !== "string" || typeof item.notes === "string" && item.notes.trim().length > 500) return null;
    if (seen.has(studentId)) return null;
    seen.add(studentId);
    records.push({
      studentId,
      status: item.status,
      notes: typeof item.notes === "string" ? item.notes.trim() || null : null
    });
  }
  return records;
};
var ensureTeacherClass = async (client, classId, teacherId) => {
  const { rowCount } = await client.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, teacherId]
  );
  return rowCount === 1;
};
teacherRouter4.get("/classes/:classId/attendance-sessions", async (request, response) => {
  const classId = idFrom4(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const teacherId = userIdFrom2(response);
  const { rowCount } = await pool.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, teacherId]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT ats.id, ats.session_date::text, ats.title, ats.notes,
            (SELECT COUNT(*)::integer FROM class_students cs
             WHERE cs.class_id = ats.class_id AND cs.is_active = TRUE) AS student_count,
            (SELECT COUNT(*)::integer FROM attendance_records ar
             WHERE ar.attendance_session_id = ats.id) AS marked_count
     FROM attendance_sessions ats
     WHERE ats.class_id = $1
     ORDER BY ats.session_date DESC, ats.id DESC`,
    [classId]
  );
  response.json({ sessions: rows.map((row) => ({
    id: row.id,
    date: row.session_date,
    title: row.title,
    notes: row.notes,
    studentCount: row.student_count,
    markedCount: row.marked_count
  })) });
});
teacherRouter4.post("/classes/:classId/attendance-sessions", async (request, response) => {
  const classId = idFrom4(request.params.classId);
  const sessionDate = parseSessionDate(request.body?.date);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() || null : null;
  const notes = typeof request.body?.notes === "string" ? request.body.notes.trim() || null : null;
  if (!classId || !sessionDate || request.body?.title !== void 0 && request.body?.title !== null && typeof request.body.title !== "string" || request.body?.notes !== void 0 && request.body?.notes !== null && typeof request.body.notes !== "string" || title !== null && title.length > 180 || notes !== null && notes.length > 5e3) {
    response.status(400).json({ error: "Tanggal, judul, atau catatan sesi tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await ensureTeacherClass(client, classId, userIdFrom2(response))) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
    const { rows } = await client.query(
      `INSERT INTO attendance_sessions (class_id, created_by, session_date, title, notes)
       VALUES ($1, $2, $3::date, $4, $5)
       ON CONFLICT (class_id, session_date) DO NOTHING
       RETURNING id`,
      [classId, userIdFrom2(response), sessionDate, title, notes]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Sesi absensi untuk kelas pada tanggal tersebut sudah ada." });
      return;
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id)
       VALUES ($1, 'ATTENDANCE_SESSION_CREATED', 'ATTENDANCE_SESSION', $2)`,
      [userIdFrom2(response), rows[0].id]
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
teacherRouter4.get("/attendance-sessions/:sessionId", async (request, response) => {
  const sessionId = idFrom4(request.params.sessionId);
  if (!sessionId) {
    response.status(400).json({ error: "ID sesi absensi tidak valid." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT ats.class_id, ats.session_date::text, ats.title, ats.notes
     FROM attendance_sessions ats JOIN classes c ON c.id = ats.class_id
     WHERE ats.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE`,
    [sessionId, userIdFrom2(response)]
  );
  const session3 = rows[0];
  if (!session3) {
    response.status(404).json({ error: "Sesi absensi tidak ditemukan." });
    return;
  }
  const { rows: students } = await pool.query(
    `SELECT s.user_id AS id, s.nisn, s.full_name, ar.status, ar.notes AS record_notes
     FROM class_students cs JOIN students s ON s.user_id = cs.student_id
     LEFT JOIN attendance_records ar
       ON ar.attendance_session_id = $2 AND ar.student_id = s.user_id
     WHERE cs.class_id = $1 AND cs.is_active = TRUE
     ORDER BY s.full_name`,
    [session3.class_id, sessionId]
  );
  response.json({
    session: {
      id: sessionId,
      classId: session3.class_id,
      date: session3.session_date,
      title: session3.title,
      notes: session3.notes
    },
    students: students.map((student) => ({
      id: student.id,
      nisn: student.nisn.trim(),
      fullName: student.full_name,
      status: student.status,
      notes: student.record_notes
    }))
  });
});
teacherRouter4.put("/attendance-sessions/:sessionId/records", async (request, response) => {
  const sessionId = idFrom4(request.params.sessionId);
  const records = parseAttendance(request.body?.records);
  if (!sessionId || !records) {
    response.status(400).json({ error: "Data kehadiran tidak valid atau terdapat siswa duplikat." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT ats.class_id
       FROM attendance_sessions ats JOIN classes c ON c.id = ats.class_id
       WHERE ats.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE
       FOR UPDATE OF ats`,
      [sessionId, userIdFrom2(response)]
    );
    const attendanceSession = rows[0];
    if (!attendanceSession) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Sesi absensi tidak ditemukan." });
      return;
    }
    const { rows: roster } = await client.query(
      "SELECT student_id AS id FROM class_students WHERE class_id = $1 AND is_active = TRUE",
      [attendanceSession.class_id]
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
        [sessionId, record.studentId, record.status, record.notes]
      );
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'ATTENDANCE_RECORDED', 'ATTENDANCE_SESSION', $2, $3::jsonb)`,
      [userIdFrom2(response), sessionId, JSON.stringify({ updatedCount: records.length })]
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
studentRouter4.get("/classes/:classId/attendance", async (request, response) => {
  const classId = idFrom4(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const studentId = userIdFrom2(response);
  const { rows: classes } = await pool.query(
    `SELECT c.id, c.name, sub.name AS subject, t.full_name AS teacher
     FROM classes c
     JOIN subjects sub ON sub.id = c.subject_id
     JOIN teachers t ON t.user_id = c.teacher_id
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE c.id = $1 AND c.is_active = TRUE`,
    [classId, studentId]
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT ats.id, ats.session_date::text, ats.title, ar.status, ar.notes, ar.marked_at
     FROM attendance_sessions ats
     LEFT JOIN attendance_records ar
       ON ar.attendance_session_id = ats.id AND ar.student_id = $2
     WHERE ats.class_id = $1
     ORDER BY ats.session_date DESC, ats.id DESC`,
    [classId, studentId]
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
      attendanceRate: total === 0 ? 0 : Math.round(present / total * 100)
    },
    records: rows.map((row) => ({
      sessionId: row.id,
      date: row.session_date,
      title: row.title,
      status: row.status,
      notes: row.notes,
      markedAt: row.marked_at
    }))
  });
});

// src/modules/grades/grades.routes.ts
import { Router as Router8 } from "express";

// src/shared/excel-workbook.ts
import ExcelJS from "exceljs";
async function createExcelWorkbook(sheetName, headers, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KANAL INFORMATIKA IBU IRA";
  workbook.created = /* @__PURE__ */ new Date();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = headers.map((header, index) => ({
    header,
    key: `column${index}`,
    width: Math.min(Math.max(header.length + 3, 14), 36)
  }));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF173B5E" }
  };
  for (const row of rows) {
    worksheet.addRow(row.map(
      (cell) => typeof cell === "string" && /^[\s]*[=+\-@]/.test(cell) ? `'${cell}` : cell
    ));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// src/modules/grades/grades.routes.ts
var teacherRouter5 = Router8();
var studentRouter5 = Router8();
teacherRouter5.use(requireTeacher);
studentRouter5.use(requireStudent);
var idFrom5 = (value) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
var userIdFrom3 = (response) => response.locals.authUser.id;
var teacherGradesQuery = `
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
var toGradeItem = (row) => ({
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
  attemptNumber: row.attempt_number
});
var escapeCsv = (value) => {
  let text = value === null || value === void 0 ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
var gradeExportHeaders = [
  "NISN",
  "Nama siswa",
  "Jenis",
  "Aktivitas",
  "Percobaan",
  "Status",
  "Nilai",
  "Nilai maksimum",
  "Umpan balik",
  "Tanggal pengumpulan",
  "Tanggal penilaian"
];
var gradeExportRows = (items) => items.map((item) => [
  item.nisn,
  item.fullName,
  item.type === "ASSIGNMENT" ? "Tugas" : "Asesmen",
  item.title,
  item.attemptNumber,
  item.status,
  item.score,
  item.maxScore,
  item.feedback,
  item.submittedAt?.toISOString() ?? "",
  item.gradedAt?.toISOString() ?? ""
]);
var csvRows = (items) => {
  const rows = gradeExportRows(items);
  return `\uFEFFsep=;\r
${[gradeExportHeaders, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\r\n")}`;
};
teacherRouter5.get("/classes/:classId/grades/export.csv", async (request, response) => {
  const classId = idFrom5(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows: classes } = await pool.query(
    `SELECT name FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom3(response)]
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
    teacherGradesQuery,
    [classId, userIdFrom3(response)]
  );
  const filename = classInfo.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "kelas";
  response.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="nilai-${filename}.csv"`).set("Cache-Control", "private, no-store").send(csvRows(rows.map(toGradeItem)));
});
teacherRouter5.get("/classes/:classId/grades/export.xlsx", async (request, response) => {
  const classId = idFrom5(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows: classes } = await pool.query(
    `SELECT name FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom3(response)]
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
    teacherGradesQuery,
    [classId, userIdFrom3(response)]
  );
  const filename = classInfo.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "kelas";
  const workbook = await createExcelWorkbook(
    "Nilai",
    gradeExportHeaders,
    gradeExportRows(rows.map(toGradeItem))
  );
  response.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").set("Content-Disposition", `attachment; filename="nilai-${filename}.xlsx"`).set("Cache-Control", "private, no-store").send(workbook);
});
teacherRouter5.get("/classes/:classId/grades", async (request, response) => {
  const classId = idFrom5(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const { rows: classes } = await pool.query(
    `SELECT id, name FROM classes
     WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE`,
    [classId, userIdFrom3(response)]
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
    teacherGradesQuery,
    [classId, userIdFrom3(response)]
  );
  const { rows: activityRows } = await pool.query(
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
    [classId, userIdFrom3(response)]
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
      gamesTotal: row.game_count
    }))
  });
});
studentRouter5.get("/classes/:classId/grades", async (request, response) => {
  const classId = idFrom5(request.params.classId);
  if (!classId) {
    response.status(400).json({ error: "ID kelas tidak valid." });
    return;
  }
  const studentId = userIdFrom3(response);
  const { rows: classes } = await pool.query(
    `SELECT c.id, c.name FROM classes c
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     WHERE c.id = $1 AND c.is_active = TRUE`,
    [classId, studentId]
  );
  const classInfo = classes[0];
  if (!classInfo) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
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
    [studentId, classId]
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
    attemptNumber: row.attempt_number
  }));
  const percentScores = grades.map((grade) => grade.score !== null && grade.maxScore !== null && grade.maxScore > 0 ? grade.score / grade.maxScore * 100 : null).filter((value) => value !== null);
  const gradedItems = grades.filter((grade) => grade.score !== null).length;
  response.json({
    class: classInfo,
    summary: {
      gradedItems,
      pendingItems: grades.length - gradedItems,
      averagePercent: percentScores.length === 0 ? null : Math.round(percentScores.reduce((total, score) => total + score, 0) / percentScores.length)
    },
    grades
  });
});

// src/modules/reports/reports.routes.ts
import { Router as Router9 } from "express";
var router4 = Router9();
router4.use(requireTeacher);
var idFrom6 = (value) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
var teacherIdFrom = (response) => response.locals.authUser.id;
var reportQuery = `
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
var mapStudent = (row) => {
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
  const completed = requiredActivities > 0 && completedActivities === requiredActivities && pendingReviews === 0 && overdueActivities === 0;
  const status = requiredActivities === 0 ? "NO_REQUIREMENTS" : overdueActivities > 0 ? "OVERDUE" : pendingReviews > 0 ? "PENDING_REVIEW" : completedActivities === requiredActivities ? "COMPLETED" : "INCOMPLETE";
  const markedAttendance = Number(row.marked_attendance);
  const presentAttendance = Number(row.present_attendance);
  return {
    id: row.id,
    nisn: row.nisn.trim(),
    fullName: row.full_name,
    requiredActivities,
    completedActivities,
    progressPercent: requiredActivities === 0 ? 0 : Math.round(completedActivities / requiredActivities * 100),
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
    attendancePercent: markedAttendance === 0 ? null : Math.round(presentAttendance / markedAttendance * 100),
    gradedItems: Number(row.graded_items),
    averageGradePercent: row.average_grade_percent === null ? null : Number(row.average_grade_percent),
    scoredGames: Number(row.scored_games),
    averageGamePercent: row.average_game_percent === null ? null : Number(row.average_game_percent)
  };
};
var escapeCsv2 = (value) => {
  let text = value === null || value === void 0 ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
var reportExportHeaders = [
  "NISN",
  "Nama siswa",
  "Progres wajib (%)",
  "Aktivitas selesai",
  "Aktivitas wajib",
  "Modul selesai",
  "Modul wajib",
  "Tugas terkumpul",
  "Tugas wajib",
  "Menunggu penilaian",
  "Terlambat",
  "Asesmen selesai",
  "Asesmen wajib",
  "Kehadiran (%)",
  "Hadir",
  "Absensi tercatat",
  "Rata-rata nilai (%)",
  "Jumlah nilai",
  "Rata-rata game (%)",
  "Game dinilai",
  "Status penyelesaian"
];
var reportExportRows = (students) => students.map((student) => [
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
  student.status === "NO_REQUIREMENTS" ? "Belum ada aktivitas wajib" : student.status === "COMPLETED" ? "Selesai" : student.status === "PENDING_REVIEW" ? "Menunggu penilaian" : student.status === "OVERDUE" ? "Terlambat" : "Belum memenuhi ketentuan"
]);
var toCsv = (students) => {
  const rows = reportExportRows(students);
  return `\uFEFFsep=;\r
${[reportExportHeaders, ...rows].map((row) => row.map(escapeCsv2).join(";")).join("\r\n")}`;
};
var loadReport = async (classId, teacherId) => {
  const { rows: classes } = await pool.query(
    `SELECT c.id, c.name, sub.name AS subject, c.academic_year, c.semester
     FROM classes c
     JOIN subjects sub ON sub.id = c.subject_id
     WHERE c.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE`,
    [classId, teacherId]
  );
  const classInfo = classes[0];
  if (!classInfo) return null;
  const { rows } = await pool.query(reportQuery, [classId, teacherId]);
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
      (student) => student.requiredActivities > 0 && !student.completed
    ).length,
    studentsWithoutRequiredActivities: students.filter(
      (student) => student.requiredActivities === 0
    ).length,
    pendingReviewStudents: students.filter((student) => student.status === "PENDING_REVIEW").length,
    overdueStudents: students.filter((student) => student.status === "OVERDUE").length,
    averageProgress: requiredActivities === 0 ? 0 : Math.round(completedActivities / requiredActivities * 100),
    averageGradePercent: studentsWithGrades.length === 0 ? null : Math.round(
      students.reduce(
        (total, student) => total + (student.averageGradePercent ?? 0) * student.gradedItems,
        0
      ) / gradedItems
    ),
    averageGamePercent: scoredGames === 0 ? null : Math.round(
      students.reduce(
        (total, student) => total + (student.averageGamePercent ?? 0) * student.scoredGames,
        0
      ) / scoredGames
    ),
    attendancePercent: markedAttendance === 0 ? null : Math.round(presentAttendance / markedAttendance * 100)
  };
  return {
    class: {
      id: classInfo.id,
      name: classInfo.name,
      subject: classInfo.subject,
      academicYear: classInfo.academic_year,
      semester: classInfo.semester
    },
    summary,
    students
  };
};
router4.get("/classes/:classId/report/export.csv", async (request, response) => {
  const classId = idFrom6(request.params.classId);
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
  response.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="laporan-${filename}.csv"`).set("Cache-Control", "private, no-store").send(toCsv(report.students));
});
router4.get("/classes/:classId/report/export.xlsx", async (request, response) => {
  const classId = idFrom6(request.params.classId);
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
    reportExportRows(report.students)
  );
  response.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").set("Content-Disposition", `attachment; filename="laporan-${filename}.xlsx"`).set("Cache-Control", "private, no-store").send(workbook);
});
router4.get("/classes/:classId/report", async (request, response) => {
  const classId = idFrom6(request.params.classId);
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

// src/modules/announcements/announcements.routes.ts
import { Router as Router10 } from "express";
var teacherRouter6 = Router10();
var studentRouter6 = Router10();
teacherRouter6.use("/announcements", requireTeacher);
studentRouter6.use("/announcements", requireStudent);
var idFrom7 = (value) => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;
var userIdFrom4 = (response) => response.locals.authUser.id;
var parseAnnouncement = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body;
  const classId = value.classId === null ? null : idFrom7(value.classId);
  if (value.classId !== null && !classId || typeof value.title !== "string" || typeof value.body !== "string" || value.publishedAt !== null && typeof value.publishedAt !== "string") return null;
  const title = value.title.trim();
  const text = value.body.trim();
  let publishedAt = null;
  if (typeof value.publishedAt === "string") {
    const date = new Date(value.publishedAt);
    if (Number.isNaN(date.getTime())) return null;
    publishedAt = date.toISOString();
  }
  if (title.length < 3 || title.length > 180 || text.length < 1 || text.length > 1e4) {
    return null;
  }
  return { classId, title, body: text, publishedAt };
};
var toAnnouncement = (row) => ({
  id: row.id,
  classId: row.class_id,
  className: row.class_name,
  title: row.title,
  body: row.body,
  publishedAt: row.published_at,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
var classBelongsToTeacher = async (classId, teacherId) => {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, teacherId]
  );
  return rowCount === 1;
};
teacherRouter6.get("/announcements", async (_request, response) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.class_id, c.name AS class_name, a.title, a.body,
            a.published_at, a.is_active, a.created_at, a.updated_at
     FROM announcements a
     LEFT JOIN classes c ON c.id = a.class_id
     WHERE a.created_by = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [userIdFrom4(response)]
  );
  response.json({ announcements: rows.map(toAnnouncement) });
});
teacherRouter6.post("/announcements", async (request, response) => {
  const input = parseAnnouncement(request.body);
  if (!input) {
    response.status(400).json({ error: "Judul, isi, cakupan kelas, atau waktu terbit tidak valid." });
    return;
  }
  const teacherId = userIdFrom4(response);
  if (input.classId && !await classBelongsToTeacher(input.classId, teacherId)) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rows } = await pool.query(
    `INSERT INTO announcements (class_id, created_by, title, body, published_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz)
     RETURNING id`,
    [input.classId, teacherId, input.title, input.body, input.publishedAt]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Database tidak mengembalikan ID pengumuman.");
  response.status(201).json({ id });
});
teacherRouter6.put("/announcements/:announcementId", async (request, response) => {
  const announcementId = idFrom7(request.params.announcementId);
  const input = parseAnnouncement(request.body);
  if (!announcementId || !input) {
    response.status(400).json({ error: "ID atau data pengumuman tidak valid." });
    return;
  }
  const teacherId = userIdFrom4(response);
  if (input.classId && !await classBelongsToTeacher(input.classId, teacherId)) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const { rowCount } = await pool.query(
    `UPDATE announcements
     SET class_id = $1, title = $2, body = $3, published_at = $4::timestamptz
     WHERE id = $5 AND created_by = $6 AND is_active = TRUE`,
    [input.classId, input.title, input.body, input.publishedAt, announcementId, teacherId]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Pengumuman tidak ditemukan." });
    return;
  }
  response.json({ message: "Pengumuman berhasil diperbarui." });
});
teacherRouter6.delete("/announcements/:announcementId", async (request, response) => {
  const announcementId = idFrom7(request.params.announcementId);
  if (!announcementId) {
    response.status(400).json({ error: "ID pengumuman tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    `UPDATE announcements SET is_active = FALSE
     WHERE id = $1 AND created_by = $2 AND is_active = TRUE`,
    [announcementId, userIdFrom4(response)]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Pengumuman tidak ditemukan." });
    return;
  }
  response.status(204).end();
});
studentRouter6.get("/announcements", async (_request, response) => {
  const { rows } = await pool.query(
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
    [userIdFrom4(response)]
  );
  response.json({
    announcements: rows.map((row) => ({ ...toAnnouncement(row), teacherName: row.teacher_name }))
  });
});

// src/modules/students/students.routes.ts
import { Router as Router11 } from "express";
import { Readable } from "node:stream";
import bcrypt2 from "bcryptjs";
import ExcelJS2 from "exceljs";
import multer3 from "multer";
var router5 = Router11();
router5.use(requireTeacher);
var studentImportUpload = multer3({
  storage: multer3.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    if (![".csv", ".xlsx"].includes(file.originalname.slice(file.originalname.lastIndexOf(".")).toLowerCase())) {
      callback(new Error("Gunakan file Excel (.xlsx) atau CSV (.csv)."));
      return;
    }
    callback(null, true);
  }
});
var teacherIdFrom2 = (response) => response.locals.authUser.id;
var parseNewStudent = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body;
  if (typeof value.nisn !== "string" || typeof value.fullName !== "string" || typeof value.classId !== "string") return null;
  const nisn = value.nisn.trim();
  const fullName = value.fullName.trim();
  const classId = value.classId;
  if (!/^\d{10}$/.test(nisn) || fullName.length < 2 || fullName.length > 150 || !/^[1-9]\d{0,18}$/.test(classId)) return null;
  return { nisn, fullName, classId };
};
var isUniqueViolation = (error) => typeof error === "object" && error !== null && "code" in error && error.code === "23505";
var parsePage = (value, fallback) => {
  if (value === void 0) return fallback;
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
var cellText = (value) => {
  if (value === null || value === void 0) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return "";
  if (value instanceof Date) return "";
  if (typeof value !== "object") return "";
  if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  return "";
};
var parseStudentSheet = async (file) => {
  const workbook = new ExcelJS2.Workbook();
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
  const columns = /* @__PURE__ */ new Map();
  header.eachCell((cell, column) => {
    const key = cellText(cell.value).replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z]/g, "");
    if (key) columns.set(key, column);
  });
  const nisnColumn = columns.get("nisn");
  const nameColumn = columns.get("nama") ?? columns.get("namalengkap") ?? columns.get("fullname");
  if (!nisnColumn || !nameColumn) {
    throw new Error("Kolom wajib tidak ditemukan. Gunakan judul kolom NISN dan Nama Lengkap.");
  }
  const rows = [];
  const errors = [];
  const seenNisn = /* @__PURE__ */ new Set();
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
var handleStudentImportUpload = (request, response, next) => {
  studentImportUpload.single("file")(request, response, (error) => {
    if (error instanceof multer3.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE" ? "Ukuran file maksimal 5 MB." : "File tidak dapat diproses."
      });
      return;
    }
    if (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "File tidak dapat diproses."
      });
      return;
    }
    next();
  });
};
router5.get("/template.csv", (_request, response) => {
  response.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", 'attachment; filename="template-daftar-siswa.csv"').send("\uFEFFNISN,Nama Lengkap\r\n");
});
router5.post("/import/upload-url", async (request, response) => {
  if (!isPrivateSupabaseStorageEnabled()) {
    response.json({ mode: "local" });
    return;
  }
  const classId = request.body?.classId;
  const fileName = typeof request.body?.fileName === "string" ? request.body.fileName : "";
  const fileSize = request.body?.fileSize;
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (typeof classId !== "string" || !/^[1-9]\d{0,18}$/.test(classId) || ![".csv", ".xlsx"].includes(extension) || typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 5 * 1024 * 1024) {
    response.status(400).json({ error: "File atau kelas impor tidak valid." });
    return;
  }
  const { rowCount } = await pool.query(
    "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE",
    [classId, teacherIdFrom2(response)]
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Kelas tidak ditemukan." });
    return;
  }
  const target = await createPrivateUploadTarget("imports", teacherIdFrom2(response), extension);
  if (!target) {
    response.status(503).json({ error: "Penyimpanan file belum dikonfigurasi." });
    return;
  }
  response.json({ mode: "direct", ...target });
});
router5.post("/import", handleStudentImportUpload, async (request, response) => {
  const uploadedKey = typeof request.body?.fileKey === "string" ? request.body.fileKey : "";
  let remoteFileKey = null;
  let file = request.file ?? null;
  if (!file && uploadedKey && isPrivateFileOwnedBy("imports", teacherIdFrom2(response), uploadedKey)) {
    try {
      file = {
        originalname: uploadedKey.split("/").at(-1) ?? "",
        buffer: await readPrivateFile("imports", uploadedKey)
      };
      remoteFileKey = uploadedKey;
    } catch {
      await deletePrivateFile("imports", uploadedKey).catch(() => void 0);
    }
  }
  const removeTemporaryUpload = async () => {
    if (remoteFileKey) await deletePrivateFile("imports", remoteFileKey).catch(() => void 0);
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
  let parsed;
  try {
    parsed = await parseStudentSheet(file);
  } catch {
    await removeTemporaryUpload();
    response.status(400).json({
      error: "File tidak dapat dibaca. Pastikan formatnya benar dan berisi kolom NISN serta Nama Lengkap."
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount: classCount } = await client.query(
      "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE FOR SHARE",
      [classId, teacherIdFrom2(response)]
    );
    if (classCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
    const passwordHash = await bcrypt2.hash("12345", 12);
    let imported = 0;
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const student = parsed.rows[index];
      if (!student) continue;
      const savepoint = `student_import_${index}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const { rows: users } = await client.query(
          `INSERT INTO users (username, password_hash, role, must_change_password)
           VALUES ($1, $2, 'STUDENT', TRUE)
           RETURNING id`,
          [student.nisn, passwordHash]
        );
        const studentId = users[0]?.id;
        if (!studentId) throw new Error("Database tidak mengembalikan ID akun siswa.");
        await client.query(
          "INSERT INTO students (user_id, nisn, full_name) VALUES ($1, $2, $3)",
          [studentId, student.nisn, student.fullName]
        );
        await client.query(
          "INSERT INTO class_students (class_id, student_id) VALUES ($1, $2)",
          [classId, studentId]
        );
        await client.query(
          `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
           VALUES ($1, 'STUDENT_ACCOUNT_CREATED', 'STUDENT', $2, $3::jsonb)`,
          [teacherIdFrom2(response), studentId, JSON.stringify({ classId, source: "bulk_import" })]
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
          error: "NISN sudah terdaftar; akun siswa tidak dibuat ulang."
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
router5.post("/", async (request, response) => {
  const input = parseNewStudent(request.body);
  if (!input) {
    response.status(400).json({ error: "NISN, nama siswa, atau kelas tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount: classCount } = await client.query(
      "SELECT 1 FROM classes WHERE id = $1 AND teacher_id = $2 AND is_active = TRUE FOR SHARE",
      [input.classId, teacherIdFrom2(response)]
    );
    if (classCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Kelas tidak ditemukan." });
      return;
    }
    const passwordHash = await bcrypt2.hash("12345", 12);
    const { rows: users } = await client.query(
      `INSERT INTO users (username, password_hash, role, must_change_password)
       VALUES ($1, $2, 'STUDENT', TRUE)
       RETURNING id`,
      [input.nisn, passwordHash]
    );
    const studentId = users[0]?.id;
    if (!studentId) throw new Error("Database tidak mengembalikan ID akun siswa.");
    await client.query(
      "INSERT INTO students (user_id, nisn, full_name) VALUES ($1, $2, $3)",
      [studentId, input.nisn, input.fullName]
    );
    await client.query(
      "INSERT INTO class_students (class_id, student_id) VALUES ($1, $2)",
      [input.classId, studentId]
    );
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'STUDENT_ACCOUNT_CREATED', 'STUDENT', $2, $3::jsonb)`,
      [teacherIdFrom2(response), studentId, JSON.stringify({ classId: input.classId })]
    );
    await client.query("COMMIT");
    response.status(201).json({
      id: studentId,
      message: "Akun siswa dibuat dan didaftarkan ke kelas. Password awal harus diganti saat login pertama.",
      initialPassword: "12345"
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
router5.post("/:studentId/reset-password", async (request, response) => {
  const studentId = typeof request.params.studentId === "string" && /^[1-9]\d{0,18}$/.test(request.params.studentId) ? request.params.studentId : null;
  if (!studentId) {
    response.status(400).json({ error: "ID siswa tidak valid." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
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
      [studentId, teacherIdFrom2(response)]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Siswa tidak ditemukan pada kelas aktif yang kamu ajar." });
      return;
    }
    const passwordHash = await bcrypt2.hash("12345", 12);
    await client.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = TRUE, auth_version = auth_version + 1
       WHERE id = $2`,
      [passwordHash, studentId]
    );
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'STUDENT_PASSWORD_RESET', 'STUDENT', $2, '{}'::jsonb)`,
      [teacherIdFrom2(response), studentId]
    );
    await client.query("COMMIT");
    response.json({
      message: "Password siswa berhasil direset. Siswa wajib menggantinya saat login.",
      initialPassword: "12345"
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
router5.get("/", async (request, response) => {
  const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
  const page = parsePage(request.query.page, 1);
  const pageSize = parsePage(request.query.pageSize, 25);
  if (search.length > 100 || page === null || page < 1 || pageSize === null || pageSize < 1 || pageSize > 100) {
    response.status(400).json({ error: "Parameter pencarian atau halaman tidak valid." });
    return;
  }
  const teacherId = teacherIdFrom2(response);
  const [countResult, studentResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT s.user_id)::integer AS total
       FROM students s
       JOIN users u ON u.id = s.user_id AND u.is_active = TRUE
       JOIN class_students cs ON cs.student_id = s.user_id AND cs.is_active = TRUE
       JOIN classes c ON c.id = cs.class_id AND c.teacher_id = $1 AND c.is_active = TRUE
       WHERE ($2 = '' OR POSITION(LOWER($2) IN LOWER(s.full_name)) > 0
              OR POSITION($2 IN s.nisn) > 0)`,
      [teacherId, search]
    ),
    pool.query(
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
      [teacherId, search, pageSize, (page - 1) * pageSize]
    )
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
        progressPercent: requiredActivities === 0 ? 0 : Math.round(completedActivities / requiredActivities * 100)
      };
    }),
    pagination: {
      page,
      pageSize,
      total: Number(countResult.rows[0]?.total ?? 0),
      pageCount: Math.ceil(Number(countResult.rows[0]?.total ?? 0) / pageSize)
    }
  });
});

// src/middleware/session.ts
import session from "express-session";
var PostgresSessionStore = class extends session.Store {
  get(sessionId, callback) {
    void pool.query(
      "SELECT data FROM sessions WHERE session_id = $1 AND expires > CURRENT_TIMESTAMP LIMIT 1",
      [sessionId]
    ).then(({ rows }) => {
      if (!rows[0]) {
        callback(void 0, null);
        return;
      }
      const parsed = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        callback(new Error("Data session tersimpan memiliki format yang tidak valid."));
        return;
      }
      callback(void 0, parsed);
    }).catch(callback);
  }
  set(sessionId, sessionData, callback) {
    const expiresAt = sessionData.cookie.expires ? new Date(sessionData.cookie.expires).getTime() : Date.now() + (sessionData.cookie.maxAge ?? 30 * 60 * 1e3);
    const expires = Math.floor(expiresAt / 1e3);
    void pool.query(
      `INSERT INTO sessions (session_id, expires, data)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (session_id)
         DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data`,
      [sessionId, new Date(expires * 1e3), JSON.stringify(sessionData)]
    ).then(() => callback?.()).catch((error) => callback?.(error));
  }
  touch(sessionId, sessionData, callback) {
    const expiresAt = sessionData.cookie.expires ? new Date(sessionData.cookie.expires).getTime() : Date.now() + (sessionData.cookie.maxAge ?? 30 * 60 * 1e3);
    const expires = Math.floor(expiresAt / 1e3);
    void pool.query("UPDATE sessions SET expires = $1 WHERE session_id = $2", [
      new Date(expires * 1e3),
      sessionId
    ]).then(() => callback?.()).catch((error) => callback?.(error));
  }
  destroy(sessionId, callback) {
    void pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]).then(() => callback?.()).catch((error) => callback?.(error));
  }
};
var sessionMiddleware = new PostgresSessionStore();

// src/middleware/csrf.ts
var safeMethods = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS"]);
var csrfProtection = (request, response, next) => {
  if (safeMethods.has(request.method)) {
    next();
    return;
  }
  const origin = request.get("origin");
  const requestOrigin = `${request.protocol}://${request.get("host")}`;
  const isVercel = Boolean(origin && origin.endsWith(".vercel.app"));
  if (origin && origin !== appConfig.frontendOrigin && origin !== requestOrigin && !isVercel) {
    response.status(403).json({ error: "Origin permintaan tidak diizinkan." });
    return;
  }
  next();
};

// src/app.ts
var app = express();
var supabaseOrigin = appConfig.supabaseUrl ? new URL(appConfig.supabaseUrl).origin : null;
app.disable("x-powered-by");
if (appConfig.nodeEnv === "production") {
  app.set("trust proxy", 1);
}
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'", ...supabaseOrigin ? [supabaseOrigin] : []],
        frameSrc: ["'self'", "https://www.youtube-nocookie.com", ...supabaseOrigin ? [supabaseOrigin] : []],
        imgSrc: ["'self'", "data:", ...supabaseOrigin ? [supabaseOrigin] : []],
        mediaSrc: ["'self'", ...supabaseOrigin ? [supabaseOrigin] : []]
      }
    }
  })
);
app.use(express.json({ limit: "1mb" }));
app.get("/api/health", async (_request, response) => {
  let dbStatus = "unknown";
  try {
    if (appConfig.databaseUrl) {
      await pool.query("SELECT 1");
      dbStatus = "connected";
    } else {
      dbStatus = "missing_database_url";
    }
  } catch (error) {
    dbStatus = `error: ${error?.message || "failed"}`;
  }
  response.json({
    status: "ok",
    application: "KANAL INFORMATIKA IBU IRA",
    database: dbStatus,
    config: {
      hasDatabaseUrl: Boolean(appConfig.databaseUrl),
      hasCaCert: Boolean(appConfig.databaseCaCertBase64),
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
      hasSupabaseUrl: Boolean(appConfig.supabaseUrl),
      hasServiceRoleKey: Boolean(appConfig.supabaseServiceRoleKey),
      nodeEnv: appConfig.nodeEnv
    }
  });
});
app.use(
  session2({
    name: "kanal.sid",
    secret: appConfig.sessionSecret,
    store: sessionMiddleware,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: appConfig.nodeEnv === "production",
      sameSite: "strict",
      maxAge: 30 * 60 * 1e3
    }
  })
);
app.use(csrfProtection);
app.use("/api/auth", router);
app.use("/api/dashboard", router2);
app.use("/api/classes", router3);
app.use("/api/students", router5);
app.use("/api/learning", studentRouter);
app.use("/api/learning", studentRouter2);
app.use("/api/learning", studentRouter3);
app.use("/api/learning", studentRouter4);
app.use("/api/learning", studentRouter5);
app.use("/api/learning", studentRouter6);
app.use("/api", router4);
app.use("/api", teacherRouter6);
app.use("/api", teacherRouter);
app.use("/api", teacherRouter2);
app.use("/api", teacherRouter3);
app.use("/api", teacherRouter4);
app.use("/api", teacherRouter5);
app.use(
  (error, _request, response, _next) => {
    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      response.status(400).json({ error: "Format JSON tidak valid." });
      return;
    }
    console.error("Kesalahan API tidak tertangani:", error);
    response.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
);
var app_default = app;
export {
  app_default as default
};
