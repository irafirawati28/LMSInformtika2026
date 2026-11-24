import "dotenv/config";
import app from "./app.js";
import { appConfig } from "./config/app-config.js";
import { pool } from "./db/pool.js";

const startServer = async (): Promise<void> => {
  let retries = 5;
  while (retries > 0) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      retries -= 1;
      if (retries === 0) {
        throw error;
      }
      console.warn("Menghubungkan ke database Supabase... Mencoba kembali dalam 2 detik...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  app.listen(appConfig.port, () => {
    console.info(`KANAL LMS API berjalan pada http://localhost:${appConfig.port}`);
  });
};

startServer().catch((error: unknown) => {
  console.error("API tidak dapat dimulai. Periksa DATABASE_URL dan koneksi Supabase.", error);
  process.exitCode = 1;
});
