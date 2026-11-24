import "dotenv/config";

const parsePort = (value: string | undefined, name: string, fallback: number): number => {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} harus berupa bilangan bulat antara 1 dan 65535.`);
  }
  return parsed;
};

const sessionSecret = process.env.SESSION_SECRET || "fallback-secret-at-least-32-chars-long-security-key";
if (!process.env.SESSION_SECRET) {
  console.warn("PERINGATAN: SESSION_SECRET belum diatur di environment variables. Menggunakan fallback.");
}

const rawFrontendOrigin = (
  process.env.FRONTEND_ORIGIN ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173")
).trim().replace(/\/+$/, "");

let parsedFrontendOrigin: URL;
try {
  parsedFrontendOrigin = new URL(rawFrontendOrigin);
} catch {
  parsedFrontendOrigin = new URL("http://localhost:5173");
}
const frontendOrigin = parsedFrontendOrigin.origin;

const databaseUrl = process.env.DATABASE_URL;
const databaseCaCert = process.env.DATABASE_CA_CERT;
const databaseCaCertBase64 = process.env.DATABASE_CA_CERT_BASE64;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "lms-private";
if (databaseUrl) {
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL harus berupa connection string PostgreSQL yang valid.");
  }
  if (
    parsedDatabaseUrl.protocol !== "postgres:" &&
    parsedDatabaseUrl.protocol !== "postgresql:"
  ) {
    throw new Error("DATABASE_URL harus menggunakan protokol PostgreSQL.");
  }
}
if (Boolean(supabaseUrl) !== Boolean(supabaseServiceRoleKey)) {
  throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diatur bersama.");
}
if (supabaseUrl) {
  let parsedSupabaseUrl: URL;
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

export const appConfig = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePort(process.env.PORT, "PORT", 3000),
  frontendOrigin,
  sessionSecret,
  databaseUrl,
  databaseCaCert,
  databaseCaCertBase64,
  databaseSsl: process.env.DATABASE_SSL === "true",
  supabaseUrl,
  supabaseServiceRoleKey,
  supabaseStorageBucket,
} as const;
