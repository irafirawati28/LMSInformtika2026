import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, types } from "pg";
import { appConfig } from "../config/app-config.js";

if (!appConfig.databaseUrl) {
  console.error("PERINGATAN: DATABASE_URL belum diatur di environment variables.");
}

const isProduction = appConfig.nodeEnv === "production";
const useSsl = appConfig.databaseSsl || isProduction;

types.setTypeParser(20, (value) => value);

const defaultDbUrl = "postgresql://localhost:5432/postgres";
const databaseUrl = new URL(appConfig.databaseUrl || defaultDbUrl);
const caCertPath = appConfig.databaseCaCert ?? databaseUrl.searchParams.get("sslrootcert");
const serverRoot = fileURLToPath(new URL("../../", import.meta.url));

let ca: string | undefined;
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
    ca = undefined;
  }
}

for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
  databaseUrl.searchParams.delete(parameter);
}

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: useSsl
    ? (ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false })
    : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
});
