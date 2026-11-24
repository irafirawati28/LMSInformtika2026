import { useEffect, useState } from "react";
import { apiRequest, type LearningClass } from "../../lib/api";

type DirectoryStudent = {
  id: string;
  nisn: string;
  fullName: string;
  classes: string;
  classCount: number;
  requiredActivities: number;
  completedActivities: number;
  progressPercent: number;
};

type StudentPage = {
  students: DirectoryStudent[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
};

type StudentImportResult = {
  imported: number;
  skipped: number;
  errors: { row: number; nisn: string; error: string }[];
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";

export default function StudentsPage() {
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<StudentPage | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [nisn, setNisn] = useState("");
  const [fullName, setFullName] = useState("");
  const [classId, setClassId] = useState("");
  const [importClassId, setImportClassId] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFileKey, setImportFileKey] = useState(0);
  const [importResult, setImportResult] = useState<StudentImportResult | null>(null);
  const [initialPassword, setInitialPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<{ classes: LearningClass[] }>("/api/classes")
      .then(({ classes: items }) => {
        if (active) {
          setClasses(items);
          setClassId(items[0]?.id ?? "");
          setImportClassId(items[0]?.id ?? "");
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        search: search.trim(),
        page: String(page),
        pageSize: "25",
      });
      setIsLoading(true);
      setError("");
      apiRequest<StudentPage>(`/api/students?${params.toString()}`)
        .then((response) => {
          if (active) setResult(response);
        })
        .catch((loadError: unknown) => {
          if (active) setError(errorMessage(loadError));
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
    }, search ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, page]);

  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const reloadFirstPage = async () => {
    const params = new URLSearchParams({
      search: "",
      page: "1",
      pageSize: "25",
    });
    const response = await apiRequest<StudentPage>(`/api/students?${params.toString()}`);
    setResult(response);
  };

  const createStudent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setNotice("");
    setInitialPassword("");
    try {
      const created = await apiRequest<{ message: string; initialPassword: string }>("/api/students", {
        method: "POST",
        body: JSON.stringify({ nisn, fullName, classId }),
      });
      setInitialPassword(created.initialPassword);
      setNotice(created.message);
      setNisn("");
      setFullName("");
      setPage(1);
      setSearch("");
      await reloadFirstPage();
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setIsSaving(false);
    }
  };

  const importStudents = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!importFile) {
      setError("Pilih file Excel atau CSV terlebih dahulu.");
      return;
    }

    setIsImporting(true);
    setError("");
    setNotice("");
    setInitialPassword("");
    setImportResult(null);
    const formData = new FormData();
    formData.set("classId", importClassId);
    formData.set("file", importFile);
    try {
      const target = await apiRequest<{
        mode: "local" | "direct";
        fileKey?: string;
        uploadUrl?: string;
      }>("/api/students/import/upload-url", {
        method: "POST",
        body: JSON.stringify({
          classId: importClassId,
          fileName: importFile.name,
          fileSize: importFile.size,
        }),
      });
      let imported: StudentImportResult;
      if (target.mode === "direct" && target.fileKey && target.uploadUrl) {
        const uploaded = await fetch(target.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": importFile.type || "application/octet-stream" },
          body: importFile,
        });
        if (!uploaded.ok) throw new Error("File daftar gagal diunggah ke penyimpanan.");
        imported = await apiRequest<StudentImportResult>("/api/students/import", {
          method: "POST",
          body: JSON.stringify({ classId: importClassId, fileKey: target.fileKey }),
        });
      } else {
        imported = await apiRequest<StudentImportResult>("/api/students/import", {
          method: "POST",
          body: formData,
        });
      }
      setImportResult(imported);
      setNotice(
        `Impor selesai: ${imported.imported} akun dibuat, ${imported.skipped} baris dilewati. Password awal semua akun baru adalah 12345; siswa wajib menggantinya saat login pertama.`,
      );
      setImportFile(null);
      setImportFileKey((key) => key + 1);
      setSearch("");
      setPage(1);
      await reloadFirstPage();
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setIsImporting(false);
    }
  };

  const resetPassword = async (student: DirectoryStudent) => {
    if (!window.confirm(`Reset password untuk ${student.fullName}? Semua sesi login siswa akan berakhir.`)) return;
    setError("");
    setNotice("");
    setInitialPassword("");
    try {
      const result = await apiRequest<{ message: string; initialPassword: string }>(
        `/api/students/${student.id}/reset-password`,
        { method: "POST" },
      );
      setNotice(`${result.message} Sampaikan password awal ${result.initialPassword} secara pribadi kepada ${student.fullName}.`);
    } catch (resetError) {
      setError(errorMessage(resetError));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-blue-800">Direktori kelas yang diajar</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Data Siswa</h1>
          <p className="mt-2 text-sm text-slate-500">Cari siswa berdasarkan nama atau NISN dan pantau progres aktivitas wajibnya.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => { setImportOpen((open) => !open); setImportResult(null); setError(""); setNotice(""); }} disabled={classes.length === 0} title={classes.length === 0 ? "Buat kelas terlebih dahulu" : undefined} className="w-full rounded-xl border border-blue-800 px-4 py-3 text-sm font-bold text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
            {importOpen ? "Tutup impor" : "⬆ Unggah daftar"}
          </button>
          <button type="button" onClick={() => { setCreateOpen((open) => !open); setInitialPassword(""); setError(""); setNotice(""); }} disabled={classes.length === 0} title={classes.length === 0 ? "Buat kelas terlebih dahulu" : undefined} className="w-full rounded-xl bg-blue-800 px-4 py-3 text-sm font-bold text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
            {createOpen ? "Tutup formulir" : "＋ Buat akun siswa"}
          </button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}{initialPassword && <p className="mt-2 font-bold">Password awal: <code className="rounded bg-emerald-100 px-2 py-1">{initialPassword}</code> — sampaikan secara pribadi dan jangan dibagikan di grup.</p>}</div>}

      {importOpen && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-bold text-slate-900">Unggah daftar siswa</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Gunakan file Excel (.xlsx) atau CSV dengan kolom <strong>NISN</strong> dan <strong>Nama Lengkap</strong>.
            Maksimal 500 siswa dan ukuran file 5 MB. NISN harus 10 digit; format kolom NISN sebagai teks di Excel agar angka nol di depan tidak hilang.
          </p>
          <a href="/api/students/template.csv" className="mt-2 inline-block text-sm font-semibold text-blue-800 underline">
            Unduh template CSV
          </a>
          <form onSubmit={(event) => void importStudents(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              Kelas tujuan
              <select required value={importClassId} onChange={(event) => setImportClassId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal">
                <option value="">Pilih kelas</option>
                {classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              File daftar siswa
              <input key={importFileKey} required type="file" accept=".xlsx,.csv" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-semibold file:text-blue-800" />
            </label>
            <p className="text-sm text-slate-500 sm:col-span-2">
              Akun baru dibuat dengan password awal <strong>12345</strong>. NISN yang sudah terdaftar, baris tidak valid, dan NISN duplikat akan dilewati tanpa mengubah akun lama.
            </p>
            <div className="sm:col-span-2 sm:text-right">
              <button type="submit" disabled={isImporting || !importFile || !importClassId} className="w-full rounded-xl bg-blue-800 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
                {isImporting ? "Mengunggah dan memproses..." : "Unggah dan buat akun"}
              </button>
            </div>
          </form>
          {importResult && importResult.errors.length > 0 && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <h3 className="font-bold">Baris yang dilewati</h3>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {importResult.errors.slice(0, 10).map((item) => (
                  <li key={`${item.row}-${item.nisn}`}>Baris {item.row}{item.nisn ? ` (NISN ${item.nisn})` : ""}: {item.error}</li>
                ))}
              </ul>
              {importResult.errors.length > 10 && <p className="mt-2">dan {importResult.errors.length - 10} baris lainnya.</p>}
            </div>
          )}
        </section>
      )}

      {createOpen && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-bold text-slate-900">Buat akun dan daftarkan ke kelas</h2>
          <p className="mt-1 text-sm text-slate-500">Akun memakai NISN untuk login. Siswa wajib mengganti password awal 12345 saat pertama masuk.</p>
          <form onSubmit={(event) => void createStudent(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">NISN<input required inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} value={nisn} onChange={(event) => setNisn(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" placeholder="10 digit NISN" /></label>
            <label className="block text-sm font-semibold text-slate-700">Nama lengkap<input required minLength={2} maxLength={150} value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">Kelas awal<select required value={classId} onChange={(event) => setClassId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal"><option value="">Pilih kelas</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}</select></label>
            <div className="flex items-end sm:justify-end"><button type="submit" disabled={isSaving || classes.length === 0} className="w-full rounded-xl bg-blue-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-60 sm:w-auto">{isSaving ? "Membuat akun..." : "Buat akun siswa"}</button></div>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <label className="block max-w-xl">
          <span className="text-sm font-semibold text-slate-700">Cari siswa</span>
          <input value={search} onChange={(event) => changeSearch(event.target.value)} maxLength={100} type="search" placeholder="Ketik nama atau NISN..." className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </label>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-bold text-slate-900">Daftar siswa</h2>
            <p className="mt-1 text-sm text-slate-500">{result?.pagination.total ?? 0} siswa terdaftar pada kelas aktif yang kamu ajar</p>
          </div>
          {isLoading && <span className="text-xs font-semibold text-blue-800">Memuat...</span>}
        </div>

        {!isLoading && result?.students.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <h3 className="font-bold text-slate-900">{search ? "Siswa tidak ditemukan" : "Belum ada siswa terdaftar"}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{search ? "Coba kata kunci nama atau NISN yang berbeda." : "Tambahkan siswa ke kelas melalui menu Manajemen Kelas. Siswa muncul di direktori setelah terdaftar."}</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {result?.students.map((student) => (
                <article key={student.id} className={`px-5 py-4 transition-opacity ${isLoading ? "opacity-50" : ""}`}>
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-bold text-slate-900">{student.fullName}</h3><button type="button" onClick={() => void resetPassword(student)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Reset password</button></div>
                      <p className="mt-1 text-xs text-slate-500">NISN {student.nisn} · {student.classCount} kelas</p>
                      <p className="mt-2 truncate text-sm text-slate-600" title={student.classes}>{student.classes}</p>
                    </div>
                    <div className="w-full lg:max-w-md lg:flex-1">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-slate-600">Progres pembelajaran wajib</span>
                        <span className="font-bold text-slate-900">{student.requiredActivities === 0 ? "Belum ada aktivitas" : `${student.progressPercent}%`}</span>
                      </div>
                      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${student.progressPercent}%` }} />
                      </div>
                      <p className="mt-1.5 text-right text-xs text-slate-500">{student.completedActivities} dari {student.requiredActivities} aktivitas selesai</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {result && result.pagination.pageCount > 1 && (
              <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
                <button type="button" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Sebelumnya</button>
                <span className="text-sm text-slate-500">Halaman {result.pagination.page} dari {result.pagination.pageCount}</span>
                <button type="button" disabled={page >= result.pagination.pageCount || isLoading} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Berikutnya</button>
              </footer>
            )}
          </>
        )}
      </section>
    </div>
  );
}
