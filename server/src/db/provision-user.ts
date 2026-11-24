import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import type { QueryResultRow } from "pg";
import { pool } from "./pool.js";

type Role = "TEACHER" | "STUDENT";

const ask = async (prompt: string): Promise<string> => {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    return (await readline.question(prompt)).trim();
  } finally {
    readline.close();
  }
};

const askHidden = (prompt: string): Promise<string> => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Password guru harus dimasukkan dari terminal interaktif.");
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdout.write("\n");
    };
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Pembuatan akun dibatalkan."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " " && character <= "~" && value.length < 72) {
          value += character;
          stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
};

const provisionUser = async (
  role: Role,
  username: string,
  fullName: string,
  passwordHash: string,
  mustChangePassword: boolean,
): Promise<void> => {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const userResult = await connection.query<QueryResultRow & { id: string }>(
      `INSERT INTO users (username, password_hash, role, must_change_password)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [username, passwordHash, role, mustChangePassword],
    );
    const userId = userResult.rows[0]?.id;
    if (!userId) {
      throw new Error("Database tidak mengembalikan ID pengguna yang dibuat.");
    }
    if (role === "TEACHER") {
      await connection.query(
        "INSERT INTO teachers (user_id, nip, full_name) VALUES ($1, $2, $3)",
        [userId, username, fullName],
      );
    } else {
      await connection.query(
        "INSERT INTO students (user_id, nisn, full_name) VALUES ($1, $2, $3)",
        [userId, username, fullName],
      );
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
};

const main = async (): Promise<void> => {
  const roleInput = (await ask("Jenis akun (guru/siswa): ")).toLowerCase();
  if (roleInput !== "guru" && roleInput !== "siswa") {
    throw new Error("Jenis akun harus 'guru' atau 'siswa'.");
  }
  const role: Role = roleInput === "guru" ? "TEACHER" : "STUDENT";
  const username = await ask(role === "TEACHER" ? "NIP: " : "NISN (10 angka): ");
  if (
    (role === "STUDENT" && !/^\d{10}$/.test(username)) ||
    (role === "TEACHER" && !/^\d{1,32}$/.test(username))
  ) {
    throw new Error(role === "TEACHER" ? "NIP harus berisi 1 sampai 32 angka." : "NISN harus tepat 10 angka.");
  }

  const fullName = await ask("Nama lengkap: ");
  if (fullName.length < 2 || fullName.length > 150) {
    throw new Error("Nama lengkap harus berisi 2 sampai 150 karakter.");
  }

  let initialPassword = "12345";
  let mustChangePassword = role === "STUDENT";
  if (role === "TEACHER") {
    initialPassword = await askHidden("Password guru (tidak ditampilkan): ");
    const confirmation = await askHidden("Ulangi password guru: ");
    if (
      initialPassword !== confirmation ||
      initialPassword.length < 12 ||
      Buffer.byteLength(initialPassword, "utf8") > 72
    ) {
      throw new Error("Password tidak cocok atau tidak memenuhi batas minimal 12 karakter (maksimal 72 byte).");
    }
    mustChangePassword = false;
  }

  const passwordHash = await bcrypt.hash(initialPassword, 12);
  await provisionUser(role, username, fullName, passwordHash, mustChangePassword);
  console.info(
    role === "TEACHER"
      ? "Akun guru berhasil dibuat."
      : "Akun siswa berhasil dibuat. Password awal 12345 harus diganti saat login pertama.",
  );
};

main()
  .catch((error: unknown) => {
    console.error("Pembuatan akun gagal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
