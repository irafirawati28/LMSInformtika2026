import express from "express";
import helmet from "helmet";
import session from "express-session";
import { authRouter } from "./modules/auth/auth.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { classesRouter } from "./modules/classes/classes.routes.js";
import {
  studentModulesRouter,
  teacherModulesRouter,
} from "./modules/modules/modules.routes.js";
import {
  studentGamesRouter,
  teacherGamesRouter,
} from "./modules/games/games.routes.js";
import {
  studentAssignmentsRouter,
  teacherAssignmentsRouter,
} from "./modules/assignments/assignments.routes.js";
import {
  studentAttendanceRouter,
  teacherAttendanceRouter,
} from "./modules/attendance/attendance.routes.js";
import {
  studentGradesRouter,
  teacherGradesRouter,
} from "./modules/grades/grades.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import {
  studentAnnouncementsRouter,
  teacherAnnouncementsRouter,
} from "./modules/announcements/announcements.routes.js";
import { studentsRouter } from "./modules/students/students.routes.js";
import { sessionMiddleware } from "./middleware/session.js";
import { csrfProtection } from "./middleware/csrf.js";
import { appConfig } from "./config/app-config.js";
import { pool } from "./db/pool.js";
import { readFileSync } from "node:fs";

try {
  readFileSync(new URL("../package.json", import.meta.url), "utf8");
} catch {
  // Silent fallback if running in environments where package.json is moved
}

const app = express();
const supabaseOrigin = appConfig.supabaseUrl ? new URL(appConfig.supabaseUrl).origin : null;

app.disable("x-powered-by");
if (appConfig.nodeEnv === "production") {
  app.set("trust proxy", 1);
}
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])],
        frameSrc: ["'self'", "https://www.youtube-nocookie.com", ...(supabaseOrigin ? [supabaseOrigin] : [])],
        imgSrc: ["'self'", "data:", ...(supabaseOrigin ? [supabaseOrigin] : [])],
        mediaSrc: ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])],
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_request, response) => {
  let dbStatus = "unknown";
  try {
    if (appConfig.databaseUrl) {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Database connection timeout (3500ms)")), 3500),
        ),
      ]);
      dbStatus = "connected";
    } else {
      dbStatus = "missing_database_url";
    }
  } catch (error: any) {
    dbStatus = `error: ${error?.message || "failed"}`;
  }

  response.json({
    status: "ok",
    application: "KANAL INFORMATIKA IBU IRA",
    database: dbStatus,
    config: {
      hasDatabaseUrl: Boolean(appConfig.databaseUrl),
      hasCaCert: Boolean(appConfig.databaseCaCertBase64 || appConfig.databaseCaCert),
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
      hasSupabaseUrl: Boolean(appConfig.supabaseUrl),
      hasServiceRoleKey: Boolean(appConfig.supabaseServiceRoleKey),
      nodeEnv: appConfig.nodeEnv,
    },
  });
});

app.use(
  session({
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
      maxAge: 30 * 60 * 1000,
    },
  }),
);
app.use(csrfProtection);

app.use("/api/auth", authRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/classes", classesRouter);
app.use("/api/students", studentsRouter);
app.use("/api/learning", studentModulesRouter);
app.use("/api/learning", studentGamesRouter);
app.use("/api/learning", studentAssignmentsRouter);
app.use("/api/learning", studentAttendanceRouter);
app.use("/api/learning", studentGradesRouter);
app.use("/api/learning", studentAnnouncementsRouter);
app.use("/api", reportsRouter);
app.use("/api", teacherAnnouncementsRouter);
app.use("/api", teacherModulesRouter);
app.use("/api", teacherGamesRouter);
app.use("/api", teacherAssignmentsRouter);
app.use("/api", teacherAttendanceRouter);
app.use("/api", teacherGradesRouter);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (
      error instanceof SyntaxError &&
      "status" in error &&
      error.status === 400
    ) {
      response.status(400).json({ error: "Format JSON tidak valid." });
      return;
    }

    console.error("Kesalahan API tidak tertangani:", error);
    response.status(500).json({ error: "Terjadi kesalahan pada server." });
  },
);

export default app;
