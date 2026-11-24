import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, types } from "pg";
import { appConfig } from "../config/app-config.js";

const DEFAULT_SUPABASE_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

if (!appConfig.databaseUrl) {
  console.error("PERINGATAN: DATABASE_URL belum diatur di environment variables.");
}

const isProduction = appConfig.nodeEnv === "production";
const useSsl = appConfig.databaseSsl || isProduction;

types.setTypeParser(20, (value) => value);

const defaultDbUrl = "postgresql://localhost:5432/postgres";
const databaseUrl = new URL(appConfig.databaseUrl || defaultDbUrl);
const caCertPath = appConfig.databaseCaCert ?? databaseUrl.searchParams.get("sslrootcert");

let ca: string | undefined;
if (appConfig.databaseCaCertBase64) {
  try {
    ca = Buffer.from(appConfig.databaseCaCertBase64, "base64").toString("utf8");
  } catch (error) {
    console.error("Gagal mengurai DATABASE_CA_CERT_BASE64:", error);
  }
} else if (caCertPath) {
  try {
    ca = readFileSync(resolve(process.cwd(), caCertPath), "utf8");
  } catch {
    ca = undefined;
  }
}

// Fallback to embedded Supabase CA cert if connecting to Supabase
if (!ca && databaseUrl.hostname.includes("supabase.com")) {
  ca = DEFAULT_SUPABASE_CA;
}

for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
  databaseUrl.searchParams.delete(parameter);
}

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: useSsl
    ? (ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false })
    : false,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
