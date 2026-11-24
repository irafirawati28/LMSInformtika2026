import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, types } from "pg";
import { appConfig } from "../config/app-config.js";

if (!appConfig.databaseUrl) {
  throw new Error("DATABASE_URL Supabase wajib diatur di server/.env.");
}

if (appConfig.nodeEnv === "production" && !appConfig.databaseSsl) {
  throw new Error("DATABASE_SSL=true wajib digunakan untuk koneksi database production.");
}

types.setTypeParser(20, (value) => value);

const databaseUrl = new URL(appConfig.databaseUrl);
const caCertPath = appConfig.databaseCaCert ?? databaseUrl.searchParams.get("sslrootcert");
const serverRoot = fileURLToPath(new URL("../../", import.meta.url));
const ca = appConfig.databaseCaCertBase64
  ? Buffer.from(appConfig.databaseCaCertBase64, "base64").toString("utf8")
  : caCertPath ? readFileSync(resolve(serverRoot, caCertPath), "utf8") : undefined;
for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
  databaseUrl.searchParams.delete(parameter);
}

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: appConfig.databaseSsl ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
});
