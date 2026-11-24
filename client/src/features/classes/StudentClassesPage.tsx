import { useEffect, useState } from "react";
import {
  apiRequest,
  type StudentDashboard as StudentDashboardData,
} from "../../lib/api";

type StudentClass = StudentDashboardData["classes"][number];

export default function StudentClassesPage({
  onOpenLearning,
}: {
  onOpenLearning: (classId: string) => void;
}) {
  const [classes, setClasses] = useState<StudentClass[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<StudentDashboardData>("/api/dashboard")
      .then((data) => {
        if (active) setClasses(data.classes);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Daftar kelas tidak dapat dimuat.");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-blue-800">Ruang belajar terdaftar</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Kelas Saya</h1>
        <p className="mt-2 text-sm text-slate-500">Kelas yang terdaftar untuk akunmu beserta progres modul wajib.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {isLoading ? (
        <div className="grid min-h-[35vh] place-items-center text-sm text-slate-500">Memuat kelas...</div>
      ) : classes.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <h2 className="font-bold text-slate-900">Kamu belum terdaftar di kelas</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Hubungi guru agar menambahkan NISN-mu ke kelas pembelajaran.</p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl bg-[#102a43] p-5 text-white sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">Ringkasan kelas</p>
            <p className="mt-2 text-3xl font-bold">{classes.length}</p>
            <p className="mt-1 text-sm text-blue-100">kelas aktif yang kamu ikuti</p>
          </section>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {classes.map((learningClass) => (
              <article key={learningClass.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex-1">
                  <span className="inline-flex rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">{learningClass.subject}</span>
                  <h2 className="mt-3 text-lg font-bold text-slate-900">{learningClass.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">Guru: {learningClass.teacher}</p>
                  <div className="mt-5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-slate-600">Progres modul wajib</span>
                      <span className="font-bold text-slate-900">{learningClass.progress}%</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${learningClass.progress}%` }} />
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => onOpenLearning(learningClass.id)} className="mt-5 w-full rounded-xl bg-blue-800 px-4 py-3 text-sm font-bold text-white hover:bg-blue-900">
                  Buka materi kelas
                </button>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
