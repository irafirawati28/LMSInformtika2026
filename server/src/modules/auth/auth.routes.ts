import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import type { QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import {
  requireAuthenticated,
  requireSession,
  type AuthenticatedUser,
} from "../../middleware/require-auth.js";

type Role = "TEACHER" | "STUDENT";

type LoginRow = QueryResultRow & {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  must_change_password: boolean;
  auth_version: number;
  full_name: string;
};

type ProfileRow = QueryResultRow & {
  id: string;
  username: string;
  role: Role;
  must_change_password: boolean;
  full_name: string;
};

type EditableProfile = {
  fullName: string;
  email: string | null;
  phone: string | null;
};

const parseEditableProfile = (body: unknown): EditableProfile | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value.fullName !== "string" ||
    (value.email !== null && typeof value.email !== "string") ||
    (value.phone !== null && typeof value.phone !== "string")
  ) return null;

  const fullName = value.fullName.trim();
  const email = typeof value.email === "string" ? value.email.trim() || null : null;
  const phone = typeof value.phone === "string" ? value.phone.trim() || null : null;
  if (
    fullName.length < 2 ||
    fullName.length > 150 ||
    (email !== null && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
    (phone !== null && (phone.length > 32 || !/^[+\d().\-\s]+$/.test(phone)))
  ) return null;
  return { fullName, email, phone };
};

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan login. Coba kembali beberapa menit lagi." },
});
const dummyHashPromise = bcrypt.hash(randomBytes(32).toString("hex"), 12);

const passwordIsValid = (password: unknown): password is string =>
  typeof password === "string" &&
  password.length > 0 &&
  Buffer.byteLength(password, "utf8") <= 72;

const finishSessionMutation = async (
  request: Request,
  user: {
    id: string;
    username: string;
    role: Role;
    authVersion: number;
  },
): Promise<void> =>
  new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      request.session.auth = {
        userId: user.id,
        username: user.username,
        role: user.role,
        authVersion: user.authVersion,
      };
      request.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });

router.post("/login", loginLimiter, async (request, response) => {
  const { username, password, role } = request.body as {
    username?: unknown;
    password?: unknown;
    role?: unknown;
  };
  if (
    typeof username !== "string" ||
    username.trim().length === 0 ||
    username.trim().length > 32 ||
    !passwordIsValid(password) ||
    (role !== "TEACHER" && role !== "STUDENT")
  ) {
    response.status(400).json({ error: "Data login tidak valid." });
    return;
  }

  const normalizedUsername = username.trim();
  if (role === "STUDENT" && !/^\d{10}$/.test(normalizedUsername)) {
    response.status(400).json({ error: "NISN harus terdiri dari 10 angka." });
    return;
  }

  const { rows } = await pool.query<LoginRow>(
    `SELECT u.id, u.username, u.password_hash, u.role, u.must_change_password,
            u.auth_version, COALESCE(t.full_name, s.full_name) AS full_name
     FROM users u
     LEFT JOIN teachers t ON t.user_id = u.id
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.username = $1 AND u.role = $2 AND u.is_active = TRUE
     LIMIT 1`,
    [normalizedUsername, role],
  );

  const user = rows[0];
  const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? (await dummyHashPromise));
  if (!user || !passwordMatches) {
    response.status(401).json({ error: "NIP/NISN atau password tidak sesuai." });
    return;
  }

  await pool.query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
  await finishSessionMutation(request, {
    id: user.id,
    username: user.username,
    role: user.role,
    authVersion: Number(user.auth_version),
  });

  response.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      mustChangePassword: Boolean(user.must_change_password),
    },
  });
});

router.get("/me", requireSession, async (_request, response) => {
  const authUser = response.locals.authUser as AuthenticatedUser;
  const { rows } = await pool.query<ProfileRow>(
    `SELECT u.id, u.username, u.role, u.must_change_password,
            COALESCE(t.full_name, s.full_name) AS full_name
     FROM users u
     LEFT JOIN teachers t ON t.user_id = u.id
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [authUser.id],
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
      mustChangePassword: Boolean(user.must_change_password),
    },
  });
});

router.get("/profile", requireAuthenticated, async (_request, response) => {
  const authUser = response.locals.authUser as AuthenticatedUser;
  if (authUser.role === "TEACHER") {
    const { rows } = await pool.query<QueryResultRow & {
      nip: string;
      full_name: string;
      email: string | null;
      phone: string | null;
    }>(
      `SELECT t.nip, t.full_name, t.email, t.phone
       FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = $1 AND u.is_active = TRUE`,
      [authUser.id],
    );
    const profile = rows[0];
    if (!profile) {
      response.status(404).json({ error: "Profil guru tidak ditemukan." });
      return;
    }
    response.json({
      profile: {
        role: authUser.role,
        username: authUser.username,
        identifier: profile.nip,
        fullName: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        schoolClass: null,
      },
    });
    return;
  }

  const { rows } = await pool.query<QueryResultRow & {
    nisn: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    school_class: string | null;
  }>(
    `SELECT s.nisn, s.full_name, s.email, s.phone, s.school_class
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.user_id = $1 AND u.is_active = TRUE`,
    [authUser.id],
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
      schoolClass: profile.school_class,
    },
  });
});

router.put("/profile", requireAuthenticated, async (request, response) => {
  const profile = parseEditableProfile(request.body);
  if (!profile) {
    response.status(400).json({ error: "Nama, email, atau nomor telepon tidak valid." });
    return;
  }
  const authUser = response.locals.authUser as AuthenticatedUser;
  const table = authUser.role === "TEACHER" ? "teachers" : "students";
  const { rowCount } = await pool.query(
    `UPDATE ${table}
     SET full_name = $1, email = $2, phone = $3
     WHERE user_id = $4`,
    [profile.fullName, profile.email, profile.phone, authUser.id],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Profil tidak ditemukan." });
    return;
  }
  response.json({ message: "Profil berhasil diperbarui.", fullName: profile.fullName });
});

router.post("/change-password", requireSession, async (request, response) => {
  const { currentPassword, newPassword } = request.body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
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

  const authUser = response.locals.authUser as AuthenticatedUser;
  const { rows } = await pool.query<QueryResultRow & { password_hash: string; auth_version: number }>(
    "SELECT password_hash, auth_version FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1",
    [authUser.id],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    response.status(400).json({ error: "Password saat ini tidak sesuai." });
    return;
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 12);
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = FALSE, auth_version = auth_version + 1
     WHERE id = $2 AND auth_version = $3`,
    [newPasswordHash, authUser.id, user.auth_version],
  );
  if (result.rowCount !== 1) {
    response.status(409).json({ error: "Akun berubah. Silakan login kembali." });
    return;
  }

  const updatedUser = {
    id: authUser.id,
    username: authUser.username,
    role: authUser.role,
    authVersion: Number(user.auth_version) + 1,
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
  await new Promise<void>((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
  response.clearCookie("kanal.sid");
  response.status(204).end();
});

export { router as authRouter };
