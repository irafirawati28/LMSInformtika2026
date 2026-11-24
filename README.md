# KANAL INFORMATIKA IBU IRA

Learning Management System untuk kegiatan pembelajaran SMK.

## Struktur

```text
client/                 React, Vite, TypeScript, Tailwind CSS
  src/
    app/                Komposisi aplikasi dan navigasi
    components/         Komponen UI bersama
    features/           Fitur berdasarkan area produk
    lib/                Utilitas frontend dan klien API
server/                 Express API, TypeScript
  src/
    config/             Konfigurasi aplikasi
    db/                 Koneksi dan utilitas akun database
    middleware/         Validasi, autentikasi, dan otorisasi
    modules/            Modul domain API
    shared/             Utilitas dan tipe lintas modul
  storage/              Penyimpanan berkas privat (tidak untuk publik)
supabase/
  migrations/           Skema PostgreSQL dan migrasi Supabase
```

## Prasyarat dan menjalankan

- Node.js 24 LTS dan npm. Node.js terpasang lokal untuk akun di
  `~/.local/kanal-node-v24.22.3/bin`; tambahkan direktori tersebut ke `PATH`
  jika perintah `node` dan `npm` ingin tersedia di terminal baru.
- Akun Supabase dengan database PostgreSQL.

1. Buat project di [Supabase](https://supabase.com/dashboard).
2. Dari **Project Settings → Database**, salin connection string **Transaction pooler** (port `6543`) agar koneksi backend dapat dipakai dari jaringan yang mendukung IPv4.
3. Terapkan migrasi berurutan melalui **SQL Editor** di dashboard Supabase:

   - Salin dan jalankan seluruh isi `supabase/migrations/202611160001_initial_schema.sql`.
   - Setelah berhasil, salin dan jalankan `supabase/migrations/202611160002_auth_sessions.sql`.
   - Setelah berhasil, salin dan jalankan `supabase/migrations/202611160003_class_management.sql`.
   - Setelah berhasil, salin dan jalankan `supabase/migrations/202611160004_learning_modules.sql`.
   - Setelah berhasil, salin dan jalankan `supabase/migrations/202611160005_learning_games.sql`.
   - Setelah berhasil, salin dan jalankan `supabase/migrations/202611160006_assignments_assessments.sql`.

Jangan gunakan Supabase `anon` key atau `service_role` key untuk koneksi SQL backend. API LMS terhubung langsung ke PostgreSQL menggunakan connection string private di server. RLS diaktifkan pada tabel untuk mencegah akses data anonim melalui Data API Supabase; backend menjaga pemeriksaan hak akses berbasis role dan kelas.

Siapkan konfigurasi lokal dan secret session sebelum menjalankan API:

```bash
cp server/.env.example server/.env
openssl rand -base64 48
```

Masukkan hasil perintah kedua sebagai `SESSION_SECRET` di `server/.env`, lalu
tempel connection string Transaction pooler lengkap dari dashboard Supabase ke
`DATABASE_URL`. Jika driver Node.js melaporkan error verifikasi sertifikat,
unduh CA certificate project dari **Project Settings → Database → SSL
Configuration**, simpan sebagai `server/supabase-ca.crt`, dan biarkan
`DATABASE_CA_CERT=./supabase-ca.crt` di `server/.env`. File sertifikat lokal ini
diabaikan Git. URL dan password database bersifat rahasia—jangan commit,
bagikan, atau masukkan ke frontend. Pertahankan `DATABASE_SSL=true`; jangan
menonaktifkan verifikasi sertifikat TLS.

```bash
npm install
npm run dev
```

Frontend tersedia di `http://localhost:5173`. API berjalan di `http://localhost:3000`; gunakan `GET /api/health` untuk pemeriksaan kesehatan.

Perintah pemeriksaan:

```bash
npm run typecheck
npm run build
```

## Deploy ke Vercel

Vercel menjalankan Express sebagai satu Function. Frontend Vite dibangun ke `public/` agar disajikan CDN Vercel, sedangkan semua endpoint tetap pada origin yang sama.

1. Pastikan keenam migrasi PostgreSQL di atas sudah diterapkan ke project Supabase.
2. Buat bucket Supabase Storage bernama `lms-private`, set sebagai **private**, dan batasi ukuran objek hingga 20 MB. Jangan membuat bucket publik.
3. Jika database sudah berisi unggahan lokal, cadangkan `server/storage/` terlebih dahulu. Atur kredensial database dan Storage pada `server/.env`, lalu jalankan `npm run migrate-files --workspace @kanal/server` dari komputer yang memiliki file lama. Periksa hasil migrasi sebelum menghapus cadangan.
4. Push repo ke GitHub dan impor repo itu di Vercel. Gunakan root directory repo (bukan `client/`), Framework Preset Express, dan Build Command `npm run build`.
5. Tambahkan environment variables berikut di Vercel (Production, Preview, Development sesuai kebutuhan):

  - `DATABASE_URL`: connection string Transaction Pooler Supabase.
  - `DATABASE_SSL`: `true`.
  - `SESSION_SECRET`: string acak minimal 32 karakter; buat lokal dengan `openssl rand -base64 48` dan masukkan langsung ke Vercel.
  - `SUPABASE_URL`: URL project Supabase.
  - `SUPABASE_SERVICE_ROLE_KEY`: service role/secret key, hanya di environment server Vercel; jangan gunakan di frontend atau commit ke Git.
  - `SUPABASE_STORAGE_BUCKET`: `lms-private`.
  - `FRONTEND_ORIGIN`: URL Production Vercel, misalnya `https://nama-aplikasi.vercel.app`.

  Jika koneksi Postgres memerlukan CA certificate, simpan sertifikat sebagai secret dan isi `DATABASE_CA_CERT_BASE64` dengan hasil `base64 < supabase-ca.crt`. Jangan menaruh connection string, key, atau sertifikat ke `VITE_*` variables.

6. Deploy, lalu cek `https://nama-aplikasi.vercel.app/api/health`. Buat atau perbarui akun guru, login, lalu uji kelas, unggah file materi dan tugas, serta buka file sebagai siswa.

Unggahan dari browser dikirim langsung menggunakan URL bertanda tangan ke bucket privat, bukan melewati batas body Vercel Function 4,5 MB. Endpoint file tetap memeriksa role/keanggotaan sebelum memberi URL unduh yang berlaku singkat. Project Supabase Free dapat dijeda setelah seminggu tidak aktif; batas dan harga dapat berubah, jadi tinjau [harga Supabase](https://supabase.com/pricing) dan [batas Vercel Functions](https://vercel.com/docs/functions/limitations) sebelum dipakai rutin.

Jangan menyimpan kredensial atau berkas unggahan di repository.

## Database Supabase (Tahap 3)

Skema PostgreSQL, foreign key, indeks, trigger waktu pembaruan, dan Row Level Security ada di `supabase/migrations/`. Tabel progres `module_requirements`, `student_content_progress`, dan `student_module_progress` menjadi dasar penghitungan progres di backend. Kunci jawaban asesmen tidak boleh dikirim ke klien siswa.

Tabel `module_requirements` menghubungkan setiap modul dengan satu konten, tugas, atau asesmen wajib. `student_content_progress` dan `student_module_progress` menyimpan status hasil validasi backend; nilai progres yang dikirim dari browser tidak boleh dianggap sumber kebenaran. Kunci jawaban asesmen disimpan terpisah dari jawaban siswa dan tidak boleh dikirim ke klien siswa.

## Autentikasi (Tahap 4)

- `POST /api/auth/login` menerima `{ "username": "NIP atau NISN", "password": "...", "role": "TEACHER atau STUDENT" }`.
- `GET /api/auth/me` mengembalikan profil sesi yang aktif.
- `POST /api/auth/change-password` menerima `{ "currentPassword": "...", "newPassword": "..." }`. Password baru minimal 12 karakter.
- `POST /api/auth/logout` menghapus session.

Login siswa memerlukan akun yang sudah dibuat dengan `username` sama dengan NISN serta `must_change_password = TRUE`; password awal `12345` wajib disimpan sebagai bcrypt hash, bukan teks biasa. Akun guru memakai NIP sebagai username. Siswa dapat dibuat oleh guru dari menu **Data Siswa** saat didaftarkan ke kelas; administrasi juga dapat menggunakan perintah provisioning di bawah. Setelah login, sesi disimpan di Supabase PostgreSQL dengan cookie `HttpOnly`, `SameSite=Strict`, timeout 30 menit, pembatasan percobaan login, validasi Origin, dan perlindungan `auth_version` agar pergantian/reset password membatalkan sesi lama.

Buat akun pertama/admin guru dan akun siswa dari terminal setelah database siap:

```bash
npm run provision-user --workspace @kanal/server
```

Password guru diminta tanpa ditampilkan dan wajib minimal 12 karakter. Akun siswa otomatis dibuat dengan hash bcrypt password awal `12345` dan diwajibkan mengganti password saat login pertama. Simpan password awal siswa dengan aman dan sampaikan secara pribadi kepada siswa.

Semua endpoint fitur baru wajib memakai middleware `requireAuthenticated`, yang menolak akun dengan password awal. Hanya `/api/auth/me`, `/api/auth/change-password`, dan `/api/auth/logout` yang dapat digunakan sebelum password diganti. Untuk production, ubah `FRONTEND_ORIGIN` ke origin HTTPS aplikasi dan gunakan `SESSION_SECRET` acak yang hanya tersimpan di environment server.

## Dashboard (Tahap 5)

Dashboard frontend tersedia setelah pengguna berhasil login; halaman menampilkan dashboard berbeda berdasarkan role. Endpoint `GET /api/dashboard` mengambil ringkasan langsung dari Supabase PostgreSQL, membatasi data guru pada kelas yang diajarnya dan data siswa pada kelas yang diikutinya. Dashboard siswa merangkum modul, tugas, asesmen, tenggat yang belum dikumpulkan, nilai terbaru, serta absensi. Dashboard guru menampilkan ringkasan siswa, kelas, modul, tugas, penyelesaian, kehadiran, tren nilai, dan aktivitas.

Dashboard memerlukan migrasi Supabase Tahap 3 dan akun yang telah dibuat menggunakan perintah provisioning. Menu **Manajemen Kelas** guru aktif setelah migrasi Tahap 6, **Materi Pembelajaran** setelah migrasi Tahap 7, **Games Interaktif** setelah migrasi Tahap 8, **Tugas dan Asesmen**/**Tugas Saya** setelah migrasi Tahap 9, dan **Absensi**/**Absensi Saya** setelah tahap absensi terpasang.

## Manajemen kelas (Tahap 6)

Menu **Manajemen Kelas** pada akun guru menyediakan pembuatan dan perubahan kelas, pengarsipan kelas, pendaftaran siswa berdasarkan NISN, pengeluaran siswa tanpa menghapus riwayat, serta ringkasan progres siswa. Daftar siswa dan seluruh perubahan dibatasi ke kelas milik guru yang sedang login. Mata pelajaran digunakan kembali tanpa membedakan kapitalisasi; migrasi `202611160003_class_management.sql` menambahkan indeks unik yang diperlukan.

Endpoint guru:

- `GET /api/classes` — daftar kelas beserta jumlah siswa, modul, tugas, dan asesmen.
- `POST /api/classes` dan `PUT /api/classes/:classId` — membuat atau mengubah kelas.
- `DELETE /api/classes/:classId` — menonaktifkan kelas tanpa menghapus riwayat.
- `GET /api/classes/:classId/students` — daftar siswa dan progres wajib.
- `POST /api/classes/:classId/students` — menambahkan siswa menggunakan `{ "nisn": "..." }`.
- `DELETE /api/classes/:classId/students/:studentId` — mengeluarkan siswa dari kelas tanpa menghapus riwayat.

Migrasi baru harus dijalankan satu kali setelah migrasi sebelumnya. Bila tabel `subjects` sudah memiliki nama duplikat yang hanya berbeda kapitalisasi, rapikan duplikat tersebut sebelum membuat indeks unik.

## Materi dan modul bertahap (Tahap 7)

Guru dapat menyusun modul berurutan pada kelas yang diajarnya, mengatur deskripsi, tujuan, estimasi belajar, status wajib, dan menambah atau menonaktifkan materi. Materi mendukung teks, tautan HTTPS, YouTube, serta unggahan PDF, DOCX, gambar, dan video (maksimum 20 MB). Unggahan disimpan sebagai berkas privat di `server/storage/modules/`, tidak disajikan sebagai direktori publik, dan hanya dapat diunduh melalui endpoint terautentikasi. Gunakan penyimpanan disk persisten untuk deployment agar berkas tidak hilang saat server diganti.

Siswa hanya melihat materi dari kelas yang diikutinya. Backend menentukan urutan buka berdasarkan persyaratan aktif di modul sebelumnya; endpoint buka, baca, unduh, dan penyelesaian memvalidasi keanggotaan kelas serta status kunci. Materi wajib yang selesai menyimpan progres di database. Waktu minimum belajar diperiksa server-side (10 detik bila guru tidak mengatur durasi). Game wajib diselesaikan melalui menu **Games Interaktif**; penyelesaian game/kuis tidak dapat dikirim melalui endpoint penyelesaian materi umum. Tugas dan asesmen yang ditautkan langsung ke modul ikut menjadi syarat buka tahap berikutnya.

Endpoint guru memakai awalan `/api`:

- `GET /api/classes/:classId/modules` — daftar modul dan materi pada kelas milik guru.
- `POST /api/classes/:classId/modules` — tambah modul di urutan paling akhir.
- `PUT /api/modules/:moduleId` / `DELETE /api/modules/:moduleId` — ubah atau nonaktifkan modul.
- `POST /api/modules/:moduleId/contents` — tambah materi teks atau tautan HTTPS.
- `POST /api/modules/:moduleId/contents/upload` — unggah file materi menggunakan `multipart/form-data` dengan field `file`, `title`, `description`, `durationMinutes`, dan `isRequired`.
- `POST /api/classes/:classId/modules/reorder` — atur urutan seluruh modul aktif dengan `{ "moduleIds": ["..."] }`.
- `PUT /api/contents/:contentId` / `DELETE /api/contents/:contentId` — ubah atau nonaktifkan materi teks/tautan/file.
- `PUT /api/contents/:contentId/upload` — ganti file materi yang diunggah.

Endpoint siswa berada di `/api/learning`: daftar kelas dan modul, membuka modul/materi, mengunduh file, serta mengirim penyelesaian materi. Status selesai tidak menerima nilai dari browser; API menghitungnya dari aktivitas, keanggotaan, urutan modul, dan waktu server.

## Games interaktif (Tahap 8)

Guru dapat membuat game kuis pilihan ganda pada modul dengan 1–20 soal, 2–6 pilihan per soal, instruksi, dan nilai kelulusan 1–100%. Kunci jawaban disimpan dalam konfigurasi server dan tidak dikirim kepada siswa. Siswa dapat mencoba kembali, melihat nilai, dan harus mencapai ambang lulus agar game wajib tercatat selesai. Percobaan dan jawaban tersimpan dalam `learning_game_attempts`; migrasi `202611160005_learning_games.sql` menambahkan tabel tersebut.

Penyelesaian game wajib dicatat dalam `student_content_progress` oleh backend. Siswa hanya dapat melihat atau mengirim game jika terdaftar dalam kelas dan seluruh prasyarat modul sebelumnya terpenuhi, termasuk materi, tugas, dan asesmen wajib. Untuk game yang lulus, progres modul dihitung ulang dan tahap selanjutnya terbuka jika semua persyaratan terpenuhi.

- Guru: menu **Games Interaktif**, pilih kelas dan modul, lalu buat atau nonaktifkan kuis.
- Siswa: menu yang sama menampilkan game pada modul yang sedang terbuka; jawaban dinilai di server, bukan berdasarkan skor kiriman browser.
- Endpoint guru: `POST /api/modules/:moduleId/games`, `GET /api/modules/:moduleId/games`. Pengarsipan menggunakan `DELETE /api/contents/:contentId`.
- Endpoint siswa: `GET /api/learning/modules/:moduleId/games`, `GET /api/learning/games/:gameId`, `POST /api/learning/games/:gameId/submit`.

## Tugas dan asesmen (Tahap 9)

Guru dapat membuat tugas teks, tautan HTTPS, atau unggah file; mengatur instruksi, tenggat, bobot, status wajib, penerimaan tugas terlambat, dan izin revisi; melihat hasil kiriman dan memberi nilai serta umpan balik. File siswa dibatasi 20 MB, format PDF/DOCX/JPG/PNG, diverifikasi berdasarkan signature, dan disimpan privat di `server/storage/assignments/`. Gunakan volume disk persisten saat deployment.

Asesmen mendukung pilihan ganda, benar/salah, isian singkat (cocok persis tanpa membedakan kapitalisasi), dan esai. Kunci jawaban tidak pernah dikirim ke browser siswa. Soal objektif dinilai otomatis; esai berstatus menunggu penilaian guru. Guru dapat mengatur jumlah percobaan, tenggat, nilai lulus, dan status wajib. Pengumpulan dan percobaan tersimpan per siswa, serta tugas/asesmen wajib yang ditautkan ke modul menjadi prasyarat progres modul.

- Guru: menu **Tugas dan Asesmen** untuk memilih kelas, membuat tugas/asesmen, melihat pengumpulan atau percobaan, menonaktifkan aktivitas, dan memberi nilai/umpan balik.
- Siswa: menu **Tugas Saya** untuk melihat tenggat/status, mengumpulkan jawaban via teks/link/file, mengerjakan asesmen, dan melihat nilai.
- Migrasi `202611160006_assignments_assessments.sql` menambahkan jenis pengumpulan tugas (`FILE`, `LINK`, `TEXT`) dan indeks pengumpulan/percobaan.
- Endpoint guru: `GET/POST /api/classes/:classId/assignments`, `GET /api/assignments/:assignmentId/submissions`, `PUT /api/assignment-submissions/:submissionId/grade`; daftar asesmen memakai `GET/POST /api/classes/:classId/assessments`, hasil `GET /api/assessments/:assessmentId/attempts`, penilaian `PUT /api/assessment-attempts/:attemptId/grade`. Aktivitas dinonaktifkan melalui `DELETE /api/assignments/:assignmentId` atau `DELETE /api/assessments/:assessmentId`.
- Endpoint siswa: `GET /api/learning/classes/:classId/assignments`, `POST /api/learning/assignments/:assignmentId/submissions` (JSON atau multipart field `file`), `GET /api/learning/classes/:classId/assessments`, `GET /api/learning/assessments/:assessmentId`, dan `POST /api/learning/assessments/:assessmentId/attempts`.

Terapkan keenam migrasi sesuai urutan sebelum menjalankan fitur di Supabase. Pengujian build/typecheck lokal tidak menggantikan pengujian integrasi terhadap database project.

## Absensi (Tahap 10)

Guru dapat membuat satu sesi absensi per kelas per tanggal, melihat daftar siswa aktif, menandai Hadir/Izin/Sakit/Alpa, menambahkan catatan, dan memperbarui catatan yang sudah disimpan. Sesi baru tidak mengisi status secara otomatis; guru harus memilih status setiap siswa (atau menggunakan **Tandai semua hadir**) agar tidak ada status Alpa yang terisi tanpa konfirmasi. Siswa hanya dapat melihat riwayat kelas yang masih diikutinya, termasuk sesi yang belum dicatat.

Persentase kehadiran siswa dihitung sebagai jumlah status **Hadir** dibagi jumlah catatan absensi yang sudah ditandai. Ringkasan juga menampilkan jumlah izin, sakit, dan alpa secara terpisah. Tabel absensi sudah dibuat oleh migrasi awal; tidak ada migrasi tambahan untuk tahap ini.

- Guru: pilih kelas, buat sesi berdasarkan tanggal, pilih siswa/status/catatan, lalu simpan; sesi lama dapat dipilih untuk memperbarui data.
- Siswa: pilih kelas pada menu **Absensi Saya** untuk melihat persentase dan riwayat.
- Endpoint guru: `GET/POST /api/classes/:classId/attendance-sessions`, `GET /api/attendance-sessions/:sessionId`, `PUT /api/attendance-sessions/:sessionId/records`.
- Endpoint siswa: `GET /api/learning/classes/:classId/attendance`.

## Pengelolaan nilai (Tahap 11)

Guru dapat melihat pengumpulan tugas dan percobaan asesmen per kelas, memberi atau mengubah nilai serta umpan balik, dan mengunduh workbook Excel (`.xlsx`) atau CSV. Rekap mencakup siswa, aktivitas, status, nilai, umpan balik, dan tanggal pengumpulan/penilaian. Bobot tugas tidak diperlakukan sebagai nilai maksimum; skala nilai disimpan bersama nilai yang diberikan. Siswa dapat melihat nilai terbit, umpan balik, dan aktivitas yang masih menunggu penilaian pada kelas yang diikutinya.

- Guru: buka menu **Pengelolaan Nilai**, pilih kelas, lalu gunakan **Nilai/Ubah** pada pengumpulan atau asesmen; unduh workbook Excel atau CSV.
- Siswa: buka menu **Nilai Saya** dan pilih kelas untuk melihat rekap nilai.
- Endpoint guru: `GET /api/classes/:classId/grades`, `GET /api/classes/:classId/grades/export.xlsx`, `GET /api/classes/:classId/grades/export.csv`; penilaian menggunakan endpoint yang sudah ada `PUT /api/assignment-submissions/:submissionId/grade` dan `PUT /api/assessment-attempts/:attemptId/grade`.
- Endpoint siswa: `GET /api/learning/classes/:classId/grades`.
- Tahap ini tidak memerlukan migrasi tambahan apabila enam migrasi awal sudah diterapkan. Akses API dibatasi oleh role, pemilik kelas, dan keanggotaan siswa; uji build/typecheck lokal tidak menggantikan uji integrasi dengan data kelas/nilai di Supabase.

## Laporan pembelajaran (Tahap 12)

Guru dapat melihat rekap per kelas untuk progres aktivitas wajib, modul, pengumpulan tugas, asesmen, kehadiran, dan rata-rata nilai yang sudah terbit. Rekap hanya mencakup siswa yang masih aktif di kelas; aktivitas wajib yang dihitung hanya modul/tugas/asesmen aktif yang ditandai wajib. Modul dihitung selesai saat progresnya `COMPLETED`; tugas dihitung terkumpul setelah ada pengiriman; asesmen dihitung selesai setelah dikirim. Status keseluruhan tetap **Menunggu penilaian** selama ada kiriman/aktivitas yang belum dinilai, dan berubah **Selesai** hanya jika semua aktivitas wajib tuntas tanpa penilaian tertunda atau tenggat yang terlewati. Pengiriman tugas berstatus terlambat, tugas wajib yang belum dikumpulkan setelah tenggat, asesmen wajib yang belum dikirim setelah tenggat, serta aktivitas wajib yang belum selesai ditandai merah sebagai terlambat/belum memenuhi ketentuan. Siswa di kelas tanpa aktivitas wajib ditandai terpisah, bukan sebagai siswa yang sudah menyelesaikan pembelajaran. Rata-rata nilai adalah rerata persentase seluruh nilai yang telah diterbitkan, bukan nilai akhir berbobot. Laporan dapat diunduh sebagai workbook Excel (`.xlsx`) atau CSV.

- Guru: buka menu **Laporan**, pilih kelas, lalu unduh Excel atau CSV bila diperlukan.
- Endpoint guru: `GET /api/classes/:classId/report`, `GET /api/classes/:classId/report/export.xlsx`, dan `GET /api/classes/:classId/report/export.csv`.
- Tidak ada migrasi tambahan. Endpoint memverifikasi role guru dan kepemilikan kelas.

## Pengumuman (Tahap 13)

Guru dapat membuat pengumuman untuk seluruh siswa atau satu kelas, menyimpan draf, menerbitkan langsung, menjadwalkan waktu terbit, mengubah, dan mengarsipkan pengumumannya. Siswa hanya melihat pengumuman aktif yang sudah terbit; pengumuman kelas hanya ditampilkan kepada siswa yang masih terdaftar pada kelas aktif tersebut. Tabel dan indeks pengumuman tersedia sejak migrasi awal, jadi tidak diperlukan migrasi tambahan.

- Guru dan siswa: buka menu **Pengumuman**.
- Endpoint guru: `GET/POST /api/announcements`, `PUT /api/announcements/:announcementId`, `DELETE /api/announcements/:announcementId` (arsip).
- Endpoint siswa: `GET /api/learning/announcements`.
- API guru membatasi perubahan ke pengumuman milik guru dan kelas yang diajarnya; API siswa memfilter kelas berdasarkan sesi login.

## Direktori siswa (Tahap 14)

Guru dapat mencari direktori siswa yang aktif pada kelas yang diajarnya berdasarkan nama/NISN, melihat kelas tempat siswa terdaftar, serta ringkasan progres aktivitas wajib. Siswa yang terdaftar pada beberapa kelas tetap muncul satu kali. Hasil dibatasi per halaman. Guru dapat membuat akun satu per satu atau mengimpor daftar siswa dengan Excel (`.xlsx`) maupun CSV dari menu **Data Siswa**. File harus memiliki kolom `NISN` dan `Nama Lengkap`, maksimal 500 baris dan 5 MB; NISN wajib 10 digit. NISN yang sudah terdaftar, duplikat, dan baris tidak valid dilewati serta dilaporkan, sementara akun lama tidak diubah. Akun baru didaftarkan ke kelas yang dipilih, memakai password awal `12345`, dan wajib menggantinya saat login pertama. Password harus disampaikan secara pribadi. Guru juga dapat mereset password akun siswa yang masih terdaftar di kelas aktif yang diajar; reset membatalkan sesi siswa yang sudah aktif.

- Guru: buka menu **Data Siswa**. Pilih **Unggah daftar** dan unduh template CSV bila diperlukan. Format NISN sebagai teks di Excel agar angka nol di depan tidak hilang. Tambahkan atau keluarkan siswa dari kelas melalui **Manajemen Kelas**.
- Endpoint guru: `GET /api/students?search=&page=1&pageSize=25`, `POST /api/students` (buat akun dan daftarkan ke kelas), `POST /api/students/import` (unggah Excel/CSV), `GET /api/students/template.csv`, `POST /api/students/:studentId/reset-password`.
- Endpoint hanya mencakup siswa aktif dalam kelas aktif milik guru yang sedang login; tidak memerlukan migrasi tambahan.

## Profil dan keamanan akun (Tahap 15)

Guru dan siswa dapat membuka menu **Pengaturan**/**Profil Saya** untuk melihat identitas akun, memperbarui nama, email, dan nomor telepon, serta mengganti password. NIP/NISN dan nama pengguna ditampilkan sebagai identitas login yang tidak dapat diubah dari halaman profil. Siswa juga dapat melihat kelas sekolah yang tersimpan. Perubahan password tetap diverifikasi dengan password saat ini, minimal 12 karakter, dan memperbarui sesi autentikasi.

- Endpoint profil: `GET/PUT /api/auth/profile`; hanya mengakses profil akun yang sedang login.
- Perubahan password memakai endpoint `POST /api/auth/change-password` yang sudah ada.
- Tidak ada migrasi tambahan; semua field profil sudah tersedia dalam skema awal.

## Kelas siswa (Tahap 16)

Siswa dapat membuka menu **Kelas Saya** untuk melihat kelas yang sedang diikuti, nama guru, mata pelajaran, dan progres modul wajib. Tombol **Buka materi kelas** membuka halaman materi dengan kelas yang dipilih, sementara validasi backend tetap memastikan siswa terdaftar dan modul berurutan tetap terkunci sesuai prasyarat.

- Data kelas memakai ringkasan siswa yang sudah dibatasi oleh sesi pada `GET /api/dashboard`.
- Tidak ada migrasi tambahan.
