import type { NextFunction, Request, Response } from "express";
import type { QueryResultRow } from "pg";
import { pool } from "../db/pool.js";

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: "TEACHER" | "STUDENT";
  mustChangePassword: boolean;
};

type AuthStateRow = QueryResultRow & {
  is_active: boolean;
  must_change_password: boolean;
  auth_version: number;
};

export const requireSession = async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  const auth = request.session.auth;
  if (!auth) {
    response.status(401).json({ error: "Silakan login untuk melanjutkan." });
    return;
  }

  const { rows } = await pool.query<AuthStateRow>(
    `SELECT is_active, must_change_password, auth_version
     FROM users WHERE id = $1 LIMIT 1`,
    [auth.userId],
  );
  const user = rows[0];
  if (
    !user ||
    !user.is_active ||
    Number(user.auth_version) !== auth.authVersion
  ) {
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    response.clearCookie("kanal.sid");
    response.status(401).json({ error: "Sesi tidak lagi berlaku. Silakan login kembali." });
    return;
  }

  response.locals.authUser = {
    id: auth.userId,
    username: auth.username,
    role: auth.role,
    mustChangePassword: Boolean(user.must_change_password),
  } satisfies AuthenticatedUser;
  next();
};

export const requireAuthenticated = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  void requireSession(request, response, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }

    const user = response.locals.authUser as AuthenticatedUser | undefined;
    if (!user) {
      return;
    }
    if (user.mustChangePassword) {
      response.status(403).json({
        error: "Ganti password awal sebelum mengakses fitur lainnya.",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      return;
    }
    next();
  }).catch(next);
};
