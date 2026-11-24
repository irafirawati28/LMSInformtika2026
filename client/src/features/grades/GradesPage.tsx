import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type LearningClass, type UserRole } from "../../lib/api";

type GradeEntry = {
  id: string;
  sourceId: string;
  studentId?: string;
  fullName?: string;
  nisn?: string;
  type: "ASSIGNMENT" | "ASSESSMENT";
  title: string;
  status: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  gradedAt: string | null;
  attemptNumber: number;
};
type StudentGrade = Omit<GradeEntry, "sourceId" | "studentId" | "fullName" | "nisn" | "maxScore"> & {
  maxScore: number | null;
};
type StudentActivity = {
  studentId: string;
  fullName: string;
  nisn: string;
  attendancePercent: number | null;
  presentCount: number;
  markedCount: number;
  assignmentsCompleted: number;
  assignmentsTotal: number;
  gameAverage: number | null;
  gamesPassed: number;
  gamesTotal: number;
};
type GradeDialogData = {
  entry: GradeEntry;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";
const dateLabel = (value: string | null): string =>
  value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function GradesPage({ role }: { role: UserRole }) {
  const isTeacher = role === "TEACHER";
  const [classes, setClasses] = useState<Array<Pick<LearningClass, "id" | "name" | "subject">>>([]);
  const [classId, setClassId] = useState("");
  const [grades, setGrades] = useState<GradeEntry[] | StudentGrade[]>([]);
  const [studentActivity, setStudentActivity] = useState<StudentActivity[]>([]);
  const [average, setAverage] = useState<number | null>(null);
  const [dialog, setDialog] = useState<GradeDialogData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const loadClasses = async () => {
      try {
        const path = isTeacher ? "/api/classes" : "/api/learning/classes";
        const { classes: items } = await apiRequest<{ classes: typeof classes }>(path);
        if (active) {
          setClasses(items);
          setClassId(items[0]?.id ?? "");
        }
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadClasses();
    return () => { active = false; };
  }, [isTeacher]);

  const reload = async (targetClassId: string, isActive: () => boolean = () => true) => {
    if (!targetClassId) return;
    const path = isTeacher
      ? `/api/classes/${targetClassId}/grades`
      : `/api/learning/classes/${targetClassId}/grades`;
    if (isTeacher) {
      const { grades: items, studentActivity: activity } = await apiRequest<{
        grades: GradeEntry[];
        studentActivity: StudentActivity[];
      }>(path);
      if (!isActive()) return;
      setGrades(items);
      setStudentActivity(activity);
      const percentages = items
        .filter((item) => item.score !== null && item.maxScore !== null && item.maxScore > 0)
        .map((item) => (item.score! / item.maxScore!) * 100);
      setAverage(percentages.length
        ? Math.round(percentages.reduce((total, value) => total + value, 0) / percentages.length)
        : null);
    } else {
      const { grades: items, summary } = await apiRequest<{
        grades: StudentGrade[];
        summary: { averagePercent: number | null };
      }>(path);
      if (!isActive()) return;
      setGrades(items);
      setStudentActivity([]);
      setAverage(summary.averagePercent);
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setGrades([]);
      setStudentActivity([]);
      setAverage(null);
      setDialog(null);
      setError("");
      if (!classId) return;
      try {
        await reload(classId, () => active);
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      }
    };
    void load();
    return () => { active = false; };
  }, [classId, isTeacher]);

  const saveGrade = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    const score = Number(form.get("score"));
    const maxScore = Number(form.get("maxScore"));
    const feedback = String(form.get("feedback") ?? "");
    setError("");
    setIsSaving(true);
    try {
      const resource = dialog.entry.type === "ASSIGNMENT"
        ? "assignment-submissions"
        : "assessment-attempts";
      await apiRequest(`/api/${resource}/${dialog.entry.sourceId}/grade`, {
        method: "PUT",
        body: JSON.stringify({ score, maxScore, feedback }),
      });
      setDialog(null);
      setNotice("Nilai berhasil disimpan.");
      await reload(classId);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat nilai...</div>;
  }

  const gradedCount = grades.filter((item) => item.score !== null).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-blue-800">{isTeacher ? "Rekap evaluasi kelas" : "Hasil belajar kamu"}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{isTeacher ? "Pengelolaan Nilai" : "Nilai Saya"}</h1>
          <p className="mt-2 text-sm text-slate-500">{isTeacher ? "Tinjau nilai tugas, asesmen, kehadiran, dan game siswa." : "Lihat nilai tugas dan asesmen, berikut umpan balik guru."}</p>
        </div>
        {isTeacher && classId && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={`/api/classes/${classId}/grades/export.xlsx`} className="w-full rounded-xl bg-blue-800 px-4 py-3 text-center text-sm font-bold text-white hover:bg-blue-900 sm:w-auto">
              Unduh Excel (.xlsx)
            </a>
            <a href={`/api/classes/${classId}/grades/export.csv`} className="w-full rounded-xl border border-blue-200 bg-white px-4 py-3 text-center text-sm font-bold text-blue-900 hover:bg-blue-50 sm:w-auto">
              Unduh CSV
            </a>
          </div>
        )}
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {classes.length === 0 ? (
        <EmptyPanel title={isTeacher ? "Belum ada kelas aktif" : "Belum terdaftar di kelas"} text={isTeacher ? "Nilai akan tersedia setelah ada kelas dan pengumpulan siswa." : "Hubungi guru agar didaftarkan ke kelas pembelajaran."} />
      ) : (
        <>
          <label className="block max-w-xl">
            <span className="text-sm font-semibold text-slate-700">Pilih kelas</span>
            <select value={classId} onChange={(event) => { setClassId(event.target.value); setError(""); setNotice(""); }} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm">
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}
            </select>
          </label>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Pengumpulan/percobaan" value={grades.length} />
            <StatCard label={isTeacher ? "Sudah dinilai" : "Rata-rata nilai"} value={isTeacher ? `${gradedCount}/${grades.length}` : average === null ? "—" : `${average}%`} />
            <StatCard label={isTeacher ? "Rata-rata nilai" : "Menunggu nilai"} value={isTeacher ? average === null ? "—" : `${average}%` : grades.filter((item) => item.score === null && item.status !== "IN_PROGRESS").length} />
          </section>

          {isTeacher && studentActivity.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-bold text-slate-900">Ringkasan aktivitas siswa</h2>
                <p className="mt-1 text-sm text-slate-500">Kehadiran dari presensi tercatat, skor game dari percobaan terbaru, dan tugas yang sudah dikumpulkan.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr><th className="px-5 py-3 font-semibold">Siswa</th><th className="px-5 py-3 font-semibold">Kehadiran</th><th className="px-5 py-3 font-semibold">Skor game</th><th className="px-5 py-3 font-semibold">Tugas selesai</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {studentActivity.map((student) => (
                      <tr key={student.studentId}>
                        <td className="px-5 py-3"><div className="font-semibold text-slate-900">{student.fullName}</div><div className="text-xs text-slate-500">NISN {student.nisn}</div></td>
                        <td className="px-5 py-3"><div className="font-semibold text-slate-800">{student.attendancePercent === null ? "—" : `${student.attendancePercent}%`}</div><div className="text-xs text-slate-500">{student.presentCount}/{student.markedCount} hadir</div></td>
                        <td className="px-5 py-3"><div className="font-semibold text-slate-800">{student.gameAverage === null ? "—" : `${student.gameAverage}%`}</div><div className="text-xs text-slate-500">{student.gamesPassed}/{student.gamesTotal} game lulus</div></td>
                        <td className="px-5 py-3 font-semibold text-slate-800">{student.assignmentsCompleted}/{student.assignmentsTotal} dikumpulkan</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {grades.length === 0 ? (
            <EmptyPanel title="Belum ada nilai tugas atau asesmen" text={isTeacher ? "Nilai muncul setelah siswa mengumpulkan tugas atau mengerjakan asesmen." : "Nilai akan muncul di sini setelah tugas atau asesmen diperiksa."} />
          ) : isTeacher ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-900">Rekap nilai kelas</h2><p className="mt-1 text-sm text-slate-500">Pilih “Nilai/Ubah” untuk mengisi atau memperbarui nilai dan umpan balik.</p></div>
              <div className="divide-y divide-slate-100">
                {(grades as GradeEntry[]).map((item) => (
                  <article key={`${item.type}-${item.id}`} className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{item.fullName}</h3><span className="text-xs text-slate-500">NISN {item.nisn}</span><StatusBadge status={item.status} /></div>
                      <p className="mt-1 text-sm text-slate-700">{item.type === "ASSIGNMENT" ? "Tugas" : "Asesmen"}: {item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">Percobaan {item.attemptNumber} · Dikumpulkan {dateLabel(item.submittedAt)}</p>
                      {item.feedback && <p className="mt-2 text-sm text-slate-600">Umpan balik: {item.feedback}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">{item.score !== null && item.maxScore !== null ? <><div className="font-bold text-blue-900">{item.score}/{item.maxScore}</div><div className="text-xs text-slate-500">{item.maxScore > 0 ? Math.round(item.score / item.maxScore * 100) : 0}%</div></> : <span className="text-sm font-semibold text-amber-800">{item.status === "IN_PROGRESS" ? "Belum selesai" : "Menunggu nilai"}</span>}</div>
                      {item.status !== "IN_PROGRESS" && <button type="button" onClick={() => setDialog({ entry: item, score: item.score, maxScore: item.maxScore, feedback: item.feedback })} className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-900">{item.score === null ? "Nilai" : "Ubah"}</button>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-900">Riwayat nilai</h2></div>
              <div className="divide-y divide-slate-100">
                {(grades as StudentGrade[]).map((item) => (
                  <article key={item.id} className="px-5 py-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{item.title}</h3><StatusBadge status={item.status} /></div><p className="mt-1 text-xs text-slate-500">{item.type === "ASSIGNMENT" ? "Tugas" : "Asesmen"} · Percobaan {item.attemptNumber} · Dinilai {dateLabel(item.gradedAt)}</p></div>
                      {item.score !== null && item.maxScore !== null ? (
                        <div className="text-left sm:text-right"><div className="text-xl font-bold text-blue-900">{item.score}/{item.maxScore}</div><div className="text-xs text-slate-500">{item.maxScore > 0 ? Math.round(item.score / item.maxScore * 100) : 0}%</div></div>
                      ) : <span className="text-sm font-semibold text-amber-800">{item.status === "IN_PROGRESS" ? "Belum selesai" : "Menunggu penilaian"}</span>}
                    </div>
                    {item.feedback && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-blue-950"><span className="font-semibold">Umpan balik guru:</span> {item.feedback}</p>}
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {dialog && isTeacher && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="grade-dialog-title" className="my-auto w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-7">
            <header className="flex items-start justify-between gap-3"><div><h2 id="grade-dialog-title" className="text-xl font-bold text-slate-900">{dialog.score === null ? "Beri nilai" : "Ubah nilai"}</h2><p className="mt-1 text-sm text-slate-500">{dialog.entry.fullName} · {dialog.entry.title}</p></div><button type="button" aria-label="Tutup" onClick={() => setDialog(null)} className="rounded-lg px-2 text-xl text-slate-400 hover:bg-slate-100">×</button></header>
            <form onSubmit={(event) => void saveGrade(event)} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-semibold text-slate-700">Nilai<input name="score" required type="number" min={0} max={10000} step="0.01" defaultValue={dialog.score ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
                <label className="block text-sm font-semibold text-slate-700">Nilai maksimum<input name="maxScore" required type="number" min={0.01} max={10000} step="0.01" defaultValue={dialog.maxScore && dialog.maxScore > 0 ? dialog.maxScore : 100} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
              </div>
              <label className="block text-sm font-semibold text-slate-700">Umpan balik<textarea name="feedback" rows={4} maxLength={5000} defaultValue={dialog.feedback ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label>
              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setDialog(null)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold">Batal</button><button type="submit" disabled={isSaving} className="rounded-xl bg-blue-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{isSaving ? "Menyimpan..." : "Simpan nilai"}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const pending = status === "SUBMITTED" || status === "IN_PROGRESS";
  const late = status === "LATE";
  const label = status === "SUBMITTED" ? "Terkirim" : status === "GRADED" ? "Dinilai" : status === "LATE" ? "Terlambat" : status === "IN_PROGRESS" ? "Dikerjakan" : status;
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${pending ? "bg-amber-50 text-amber-800" : late ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{label}</span>;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></article>;
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><h2 className="font-bold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p></section>;
}
