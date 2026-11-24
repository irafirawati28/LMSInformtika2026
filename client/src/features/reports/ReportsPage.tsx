import { useEffect, useState } from "react";
import { apiRequest, type LearningClass } from "../../lib/api";

type StudentReport = {
  id: string;
  nisn: string;
  fullName: string;
  requiredActivities: number;
  completedActivities: number;
  progressPercent: number;
  completed: boolean;
  status: "NO_REQUIREMENTS" | "COMPLETED" | "PENDING_REVIEW" | "OVERDUE" | "INCOMPLETE";
  pendingReviews: number;
  overdueActivities: number;
  requiredModules: number;
  completedModules: number;
  pendingReviewModules: number;
  requiredAssignments: number;
  completedAssignments: number;
  pendingReviewAssignments: number;
  overdueAssignments: number;
  requiredAssessments: number;
  completedAssessments: number;
  pendingReviewAssessments: number;
  overdueAssessments: number;
  markedAttendance: number;
  presentAttendance: number;
  attendancePercent: number | null;
  gradedItems: number;
  averageGradePercent: number | null;
  scoredGames: number;
  averageGamePercent: number | null;
};

type ClassReport = {
  class: Pick<LearningClass, "id" | "name" | "subject" | "academicYear" | "semester">;
  summary: {
    studentCount: number;
    completedStudents: number;
    incompleteStudents: number;
    studentsWithoutRequiredActivities: number;
    pendingReviewStudents: number;
    overdueStudents: number;
    averageProgress: number;
    averageGradePercent: number | null;
    attendancePercent: number | null;
    averageGamePercent: number | null;
  };
  students: StudentReport[];
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";

export default function ReportsPage() {
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [classId, setClassId] = useState("");
  const [report, setReport] = useState<ClassReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadClasses = async () => {
      try {
        const { classes: items } = await apiRequest<{ classes: LearningClass[] }>("/api/classes");
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
  }, []);

  useEffect(() => {
    let active = true;
    const loadReport = async () => {
      setReport(null);
      setError("");
      if (!classId) return;
      try {
        const result = await apiRequest<ClassReport>(`/api/classes/${classId}/report`);
        if (active) setReport(result);
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      }
    };
    void loadReport();
    return () => { active = false; };
  }, [classId]);

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat laporan...</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-blue-800">Ringkasan pembelajaran</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Laporan Pembelajaran</h1>
          <p className="mt-2 text-sm text-slate-500">Pantau progres wajib, kehadiran, dan hasil penilaian siswa per kelas.</p>
        </div>
        {report && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={`/api/classes/${classId}/report/export.xlsx`} className="w-full rounded-xl bg-blue-800 px-4 py-3 text-center text-sm font-bold text-white hover:bg-blue-900 sm:w-auto">
              Unduh Excel (.xlsx)
            </a>
            <a href={`/api/classes/${classId}/report/export.csv`} className="w-full rounded-xl border border-blue-200 bg-white px-4 py-3 text-center text-sm font-bold text-blue-900 hover:bg-blue-50 sm:w-auto">
              Unduh CSV
            </a>
          </div>
        )}
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {classes.length === 0 ? (
        <EmptyPanel title="Belum ada kelas aktif" text="Buat kelas dan daftarkan siswa untuk mulai melihat laporan pembelajaran." />
      ) : (
        <>
          <label className="block max-w-xl">
            <span className="text-sm font-semibold text-slate-700">Pilih kelas</span>
            <select value={classId} onChange={(event) => setClassId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm">
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}
            </select>
          </label>

          {report && (
            <>
              <section className="rounded-2xl bg-[#102a43] p-5 text-white sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">{report.class.subject} · Tahun ajaran {report.class.academicYear} · Semester {report.class.semester === "ODD" ? "Ganjil" : "Genap"}</p>
                <h2 className="mt-2 text-xl font-bold sm:text-2xl">{report.class.name}</h2>
                <p className="mt-1 text-sm text-blue-100">Laporan ini merangkum progres wajib, kehadiran, tugas, asesmen, dan skor game siswa.</p>
              </section>

              <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-9">
                <StatCard label="Siswa aktif" value={report.summary.studentCount} />
                <StatCard label="Pembelajaran selesai" value={report.summary.completedStudents} detail={`dari ${report.summary.studentCount} siswa`} />
                <StatCard label="Belum ada aktivitas wajib" value={report.summary.studentsWithoutRequiredActivities} />
                <StatCard label="Menunggu penilaian" value={report.summary.pendingReviewStudents} />
                <StatCard label="Terlambat" value={report.summary.overdueStudents} />
                <StatCard label="Rata-rata progres" value={`${report.summary.averageProgress}%`} />
                <StatCard label="Rata-rata nilai" value={report.summary.averageGradePercent === null ? "—" : `${report.summary.averageGradePercent}%`} />
                <StatCard label="Rata-rata game" value={report.summary.averageGamePercent === null ? "—" : `${report.summary.averageGamePercent}%`} />
                <StatCard label="Kehadiran" value={report.summary.attendancePercent === null ? "—" : `${report.summary.attendancePercent}%`} />
              </section>

              {report.students.length === 0 ? (
                <EmptyPanel title="Belum ada siswa di kelas ini" text="Tambahkan siswa ke kelas melalui menu Manajemen Kelas." />
              ) : (
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="font-bold text-slate-900">Progres per siswa</h2>
                    <p className="mt-1 text-sm text-slate-500">{report.summary.incompleteStudents} siswa belum menyelesaikan seluruh aktivitas wajib.</p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {report.students.map((student) => (
                      <article key={student.id} className="px-5 py-4">
                        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-bold text-slate-900">{student.fullName}</h3>
                              <span className="text-xs text-slate-500">NISN {student.nisn}</span>
                              <CompletionBadge status={student.status} />
                            </div>
                            <div className="mt-3 flex items-center gap-3">
                              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 sm:max-w-sm">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    student.status === "COMPLETED"
                                      ? "bg-emerald-600"
                                      : student.status === "PENDING_REVIEW"
                                        ? "bg-amber-500"
                                        : student.status === "OVERDUE" || student.status === "INCOMPLETE"
                                          ? "bg-red-600"
                                          : "bg-slate-400"
                                  }`}
                                  style={{ width: `${student.progressPercent}%` }}
                                />
                              </div>
                              <span className="min-w-10 text-right text-xs font-bold text-slate-700">{student.progressPercent}%</span>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">{student.completedActivities} dari {student.requiredActivities} aktivitas wajib selesai</p>
                          </div>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4 lg:min-w-[520px]">
                            <Metric label="Modul" value={`${student.completedModules}/${student.requiredModules}`} />
                            <Metric label="Tugas" value={`${student.completedAssignments}/${student.requiredAssignments}`} />
                            <Metric label="Asesmen" value={`${student.completedAssessments}/${student.requiredAssessments}`} />
                            <Metric label="Menunggu penilaian" value={student.pendingReviews} />
                            <Metric label="Terlambat" value={student.overdueActivities} />
                            <Metric label="Hadir" value={student.attendancePercent === null ? "—" : `${student.attendancePercent}%`} />
                            <Metric label="Rata-rata nilai" value={student.averageGradePercent === null ? "—" : `${student.averageGradePercent}%`} />
                            <Metric label="Nilai games" value={student.averageGamePercent === null ? "—" : `${student.averageGamePercent}% (${student.scoredGames} game)`} />
                            <Metric label="Nilai terbit" value={student.gradedItems} />
                            <Metric label="Sesi absensi" value={student.markedAttendance} />
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-[11px] text-slate-500">{label}</p><p className="mt-0.5 font-semibold text-slate-800">{value}</p></div>;
}

function CompletionBadge({ status }: { status: StudentReport["status"] }) {
  const label = {
    NO_REQUIREMENTS: "Belum ada aktivitas wajib",
    COMPLETED: "Selesai",
    PENDING_REVIEW: "Menunggu penilaian",
    OVERDUE: "Terlambat",
    INCOMPLETE: "Belum memenuhi ketentuan",
  }[status];
  const style = {
    NO_REQUIREMENTS: "bg-slate-100 text-slate-600",
    COMPLETED: "bg-emerald-50 text-emerald-800",
    PENDING_REVIEW: "bg-amber-50 text-amber-800",
    OVERDUE: "bg-red-50 text-red-800",
    INCOMPLETE: "bg-red-50 text-red-800",
  }[status];
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${style}`}>{label}</span>;
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><h2 className="font-bold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p></section>;
}
