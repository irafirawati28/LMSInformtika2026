import session from "express-session";
import type { QueryResultRow } from "pg";
import { pool } from "../db/pool.js";

type SessionRow = QueryResultRow & {
  data: string | session.SessionData;
};

class PostgresSessionStore extends session.Store {
  override get(
    sessionId: string,
    callback: (error?: unknown, session?: session.SessionData | null) => void,
  ): void {
    void pool
      .query<SessionRow>(
        "SELECT data FROM sessions WHERE session_id = $1 AND expires > CURRENT_TIMESTAMP LIMIT 1",
        [sessionId],
      )
      .then(({ rows }) => {
        if (!rows[0]) {
          callback(undefined, null);
          return;
        }

        const parsed: unknown =
          typeof rows[0].data === "string"
            ? JSON.parse(rows[0].data)
            : rows[0].data;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          callback(new Error("Data session tersimpan memiliki format yang tidak valid."));
          return;
        }
        callback(undefined, parsed as session.SessionData);
      })
      .catch(callback);
  }

  override set(
    sessionId: string,
    sessionData: session.SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    const expiresAt = sessionData.cookie.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + (sessionData.cookie.maxAge ?? 30 * 60 * 1000);
    const expires = Math.floor(expiresAt / 1000);

    void pool
      .query(
        `INSERT INTO sessions (session_id, expires, data)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (session_id)
         DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data`,
        [sessionId, new Date(expires * 1000), JSON.stringify(sessionData)],
      )
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override touch(
    sessionId: string,
    sessionData: session.SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    const expiresAt = sessionData.cookie.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + (sessionData.cookie.maxAge ?? 30 * 60 * 1000);
    const expires = Math.floor(expiresAt / 1000);

    void pool
      .query("UPDATE sessions SET expires = $1 WHERE session_id = $2", [
        new Date(expires * 1000),
        sessionId,
      ])
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override destroy(sessionId: string, callback?: (error?: unknown) => void): void {
    void pool
      .query("DELETE FROM sessions WHERE session_id = $1", [sessionId])
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }
}

export const sessionMiddleware = new PostgresSessionStore();
