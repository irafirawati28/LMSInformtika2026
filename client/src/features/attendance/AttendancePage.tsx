import { useEffect, useState } from "react";
import { apiRequest, type LearningClass, type UserRole } from "../../lib/api";

type AttendanceStatus = "PRESENT" | "PERMISSION" | "SICK" | "ABSENT";
type AttendanceSession = {
  id: string;
  date: string;
  title: string | null;
  notes: string | null;
  studentCount: number;
  markedCount: number;
};
type AttendanceStudent = {
  id: string;
  nisn: string;
  fullName: string;
  status: AttendanceStatus | null;
  notes: string | null;
};
type StudentAttendance = {
  class: { id: string; name: string; subject: string; teacher: string };
  summary: {
    totalSessions: number;
    markedSessions: number;
    present: number;
    permission: number;
    sick: number;
    absent: number;
    attendanceRate: number;
  };
  records: Array<{
    sessionId: string;
    date: string;
    title: string | null;
    status: AttendanceStatus | null;
    notes: string | null;
    markedAt: string | null;
  }>;
};

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Hadir",
  PERMISSION: "Izin",
  SICK: "Sakit",
  ABSENT: "Alpa",
};
const STATUS_STYLES: Record<AttendanceStatus, string> = {
  PRESENT: "bg-emerald-50 text-emerald-800",
  PERMISSION: "bg-blue-50 text-blue-800",
  SICK: "bg-amber-50 text-amber-800",
  ABSENT: "bg-red-50 text-red-800",
};
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";
const dateLabel = (value: string): string =>
  new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const todayInputValue = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function AttendancePage({ role }: { role: UserRole }) {
  const isTeacher = role === "TEACHER";
  const [classes, setClasses] = useState<Array<Pick<LearningClass, "id" | "name" | "subject">>>([]);
  const [classId, setClassId] = useState("");
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [students, setStudents] = useState<AttendanceStudent[]>([]);
  const [studentData, setStudentData] = useState<StudentAttendance | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus | "">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [newDate, setNewDate] = useState(todayInputValue);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [showCreate, setShowCreate] = useState(false);
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

  const loadSessions = async (targetClassId: string, selectedId?: string) => {
    const { sessions: items } = await apiRequest<{ sessions: AttendanceSession[] }>(
      `/api/classes/${targetClassId}/attendance-sessions`,
    );
    setSessions(items);
    const nextId = selectedId && items.some((item) => item.id === selectedId)
      ? selectedId : items[0]?.id ?? "";
    setSelectedSessionId(nextId);
    return nextId;
  };

  const loadSessionRoster = async (sessionId: string) => {
    if (!sessionId) {
      setStudents([]);
      setStatuses({});
      setNotes({});
      return;
    }
    const { students: roster } = await apiRequest<{ students: AttendanceStudent[] }>(
      `/api/attendance-sessions/${sessionId}`,
    );
    setStudents(roster);
    setStatuses(Object.fromEntries(roster.map((student) => [student.id, student.status ?? ""])));
    setNotes(Object.fromEntries(roster.map((student) => [student.id, student.notes ?? ""])));
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setSessions([]);
      setSelectedSessionId("");
      setStudents([]);
      setStudentData(null);
      setError("");
      if (!classId) return;
      try {
        if (isTeacher) {
          const nextId = await loadSessions(classId);
          if (active && nextId) await loadSessionRoster(nextId);
        } else {
          const data = await apiRequest<StudentAttendance>(
            `/api/learning/classes/${classId}/attendance`,
          );
          if (active) setStudentData(data);
        }
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      }
    };
    void load();
    return () => { active = false; };
  }, [classId, isTeacher]);

  const selectSession = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setError("");
    try {
      await loadSessionRoster(sessionId);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  const createSession = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSaving(true);
    try {
      const { id } = await apiRequest<{ id: string }>(
        `/api/classes/${classId}/attendance-sessions`,
        {
          method: "POST",
          body: JSON.stringify({ date: newDate, title: newTitle, notes: newNotes }),
        },
      );
      await loadSessions(classId, id);
      await loadSessionRoster(id);
      setShowCreate(false);
      setNewTitle("");
      setNewNotes("");
      setNotice("Sesi absensi dibuat. Lengkapi status seluruh siswa lalu simpan.");
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setIsSaving(false);
    }
  };

  const saveAttendance = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSessionId) return;
    const unmarked = students.filter((student) => !statuses[student.id]);
    if (unmarked.length > 0) {
      setError(`Pilih status kehadiran untuk ${unmarked.length} siswa yang belum ditandai.`);
      return;
    }
    setError("");
    setIsSaving(true);
    try {
      await apiRequest(`/api/attendance-sessions/${selectedSessionId}/records`, {
        method: "PUT",
        body: JSON.stringify({
          records: students.map((student) => ({
            studentId: student.id,
            status: statuses[student.id],
            notes: notes[student.id] ?? "",
          })),
        }),
      });
      await loadSessionRoster(selectedSessionId);
      await loadSessions(classId, selectedSessionId);
      setNotice("Kehadiran berhasil disimpan.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat absensi...</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-blue-800">{isTeacher ? "Rekap kelas" : "Riwayat kehadiran kamu"}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{isTeacher ? "Absensi Kelas" : "Absensi Saya"}</h1>
          <p className="mt-2 text-sm text-slate-500">{isTeacher ? "Buat sesi dan catat status kehadiran siswa." : "Pantau catatan hadir, izin, sakit, dan alpa di kelas."}</p>
        </div>
        {isTeacher && classId && <button type="button" onClick={() => { setShowCreate(true); setError(""); setNotice(""); }} className="w-full rounded-xl bg-[#102a43] px-4 py-3 text-sm font-bold text-white hover:bg-[#183d5d] sm:w-auto">+ Buat sesi absensi</button>}
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {classes.length === 0 ? (
        <EmptyPanel title={isTeacher ? "Belum ada kelas aktif" : "Belum terdaftar di kelas"} text={isTeacher ? "Buat kelas dan tambahkan siswa sebelum mencatat absensi." : "Hubungi guru agar didaftarkan ke kelas pembelajaran."} />
      ) : (
        <>
          <label className="block max-w-xl">
            <span className="text-sm font-semibold text-slate-700">Pilih kelas</span>
            <select value={classId} onChange={(event) => { setClassId(event.target.value); setError(""); setNotice(""); }} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm">
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}
            </select>
          </label>

          {isTeacher ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.5fr)]">
              <section className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Sesi absensi</h2>
                {sessions.length === 0 ? <EmptyPanel title="Belum ada sesi" text="Buat sesi pertama untuk mulai mencatat kehadiran." /> : sessions.map((session) => (
                  <button key={session.id} type="button" onClick={() => void selectSession(session.id)} className={`w-full rounded-xl border p-4 text-left transition ${selectedSessionId === session.id ? "border-blue-700 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                    <span className="block font-bold text-slate-900">{session.title || "Absensi kelas"}</span>
                    <span className="mt-1 block text-xs text-slate-500">{dateLabel(session.date)}</span>
                    <span className="mt-2 block text-xs font-semibold text-blue-800">{session.markedCount}/{session.studentCount} siswa ditandai</span>
                  </button>
                ))}
              </section>

              <section className="min-w-0">
                {!selectedSessionId ? <EmptyPanel title="Pilih sesi absensi" text="Pilih sesi di samping atau buat sesi baru." /> : (
                  <>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div><h2 className="font-bold text-slate-900">Daftar kehadiran</h2><p className="text-sm text-slate-500">{students.length} siswa terdaftar</p></div>
                      {students.length > 0 && <button type="button" onClick={() => setStatuses(Object.fromEntries(students.map((student) => [student.id, "PRESENT"])))} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">Tandai semua hadir</button>}
                    </div>
                    {students.length === 0 ? <EmptyPanel title="Belum ada siswa" text="Tambahkan siswa ke kelas sebelum mengisi absensi." /> : (
                      <form onSubmit={(event) => void saveAttendance(event)} className="space-y-3">
                        {students.map((student) => (
                          <article key={student.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_150px]">
                            <div className="min-w-0"><h3 className="truncate font-semibold text-slate-900">{student.fullName}</h3><p className="text-xs text-slate-500">NISN {student.nisn}</p>
                              <label className="mt-2 block text-xs font-medium text-slate-500">Catatan (opsional)<input value={notes[student.id] ?? ""} maxLength={500} onChange={(event) => setNotes((current) => ({ ...current, [student.id]: event.target.value }))} placeholder="Catatan kehadiran" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" /></label>
                            </div>
                            <label className="text-xs font-semibold text-slate-600">Status<select required value={statuses[student.id] ?? ""} onChange={(event) => setStatuses((current) => ({ ...current, [student.id]: event.target.value as AttendanceStatus | "" }))} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm">
                              <option value="" disabled>Pilih status</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select></label>
                          </article>
                        ))}
                        <div className="flex justify-end"><button type="submit" disabled={isSaving || students.some((student) => !statuses[student.id])} className="rounded-xl bg-blue-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{isSaving ? "Menyimpan..." : "Simpan kehadiran"}</button></div>
                      </form>
                    )}
                  </>
                )}
              </section>
            </div>
          ) : !studentData ? <EmptyPanel title="Riwayat tidak tersedia" text="Tidak ada data absensi untuk kelas ini." /> : (
            <>
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <StatCard label="Kehadiran" value={`${studentData.summary.attendanceRate}%`} tone="blue" />
                <StatCard label="Sesi tercatat" value={`${studentData.summary.markedSessions}/${studentData.summary.totalSessions}`} tone="slate" />
                <StatCard label="Hadir" value={studentData.summary.present} tone="green" />
                <StatCard label="Izin / Sakit" value={studentData.summary.permission + studentData.summary.sick} tone="amber" />
                <StatCard label="Alpa" value={studentData.summary.absent} tone="red" />
              </section>
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-900">Riwayat absensi</h2><p className="mt-1 text-sm text-slate-500">{studentData.class.name} · {studentData.class.subject} · {studentData.class.teacher}</p></div>
                {studentData.records.length === 0 ? <EmptyPanel title="Belum ada catatan absensi" text="Riwayat akan muncul setelah guru membuat sesi absensi." /> : (
                  <div className="divide-y divide-slate-100">{studentData.records.map((record) => (
                    <article key={record.sessionId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div><h3 className="font-semibold text-slate-900">{record.title || "Absensi kelas"}</h3><p className="mt-1 text-sm text-slate-500">{dateLabel(record.date)}{record.notes ? ` · ${record.notes}` : ""}</p></div>
                      {record.status ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_STYLES[record.status]}`}>{STATUS_LABELS[record.status]}</span> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">Belum dicatat</span>}
                    </article>
                  ))}</div>
                )}
              </section>
            </>
          )}
        </>
      )}

      {showCreate && isTeacher && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="attendance-create-title" className="my-auto w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-7">
            <header className="flex items-start justify-between gap-3"><div><h2 id="attendance-create-title" className="text-xl font-bold text-slate-900">Buat sesi absensi</h2><p className="mt-1 text-sm text-slate-500">Satu sesi per kelas untuk setiap tanggal.</p></div><button type="button" aria-label="Tutup" onClick={() => setShowCreate(false)} className="rounded-lg px-2 text-xl text-slate-400 hover:bg-slate-100">×</button></header>
            <form onSubmit={(event) => void createSession(event)} className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">Tanggal<input type="date" required value={newDate} onChange={(event) => setNewDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
              <label className="block text-sm font-semibold text-slate-700">Judul (opsional)<input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={180} placeholder="Contoh: Pertemuan 1" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-slate-700">Catatan (opsional)<textarea value={newNotes} onChange={(event) => setNewNotes(event.target.value)} maxLength={5000} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label>
              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold">Batal</button><button type="submit" disabled={isSaving} className="rounded-xl bg-[#102a43] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{isSaving ? "Membuat..." : "Buat sesi"}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: "blue" | "slate" | "green" | "amber" | "red" }) {
  const colors = {
    blue: "border-blue-100 bg-blue-50 text-blue-900",
    slate: "border-slate-200 bg-white text-slate-900",
    green: "border-emerald-100 bg-emerald-50 text-emerald-900",
    amber: "border-amber-100 bg-amber-50 text-amber-900",
    red: "border-red-100 bg-red-50 text-red-900",
  };
  return <article className={`rounded-xl border p-4 ${colors[tone]}`}><p className="text-xs font-semibold opacity-75">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></article>;
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><h2 className="font-bold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p></section>;
}
