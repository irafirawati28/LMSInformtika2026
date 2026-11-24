import { useEffect, useState } from "react";
import {
  apiRequest,
  type LearningClass,
  type LearningModule,
  type UserRole,
} from "../../lib/api";

type SubmissionType = "FILE" | "LINK" | "TEXT";
type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
type QuestionDraft = {
  id: string;
  type: QuestionType;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  answerKey: string | boolean;
  points: number;
};
type Assignment = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  moduleId: string | null;
  moduleTitle: string | null;
  startsAt: string | null;
  dueAt: string | null;
  weight?: number;
  submissionType: SubmissionType;
  isRequired: boolean;
  allowLateSubmission?: boolean;
  allowRevision?: boolean;
  submissionCount?: number;
  unlocked?: boolean;
  submission?: {
    id: string;
    attemptNumber: number;
    status: string;
    submittedAt: string;
    score: number | null;
    maxScore: number | null;
    feedback: string | null;
    fileUrl: string | null;
    link: string | null;
    text: string | null;
  } | null;
};
type Assessment = {
  id: string;
  title: string;
  description: string | null;
  moduleId: string | null;
  moduleTitle: string | null;
  startsAt: string | null;
  dueAt: string | null;
  maxAttempts?: number;
  attemptCount?: number;
  passScore: number | null;
  isRequired: boolean;
  questionCount: number;
  attemptCountTeacher?: number;
  unlocked?: boolean;
  status?: string | null;
  score?: number | null;
  maxScore?: number | null;
  feedback?: string | null;
};
type SubmissionRecord = {
  id: string;
  fullName: string;
  nisn: string;
  type: SubmissionType;
  fileUrl: string | null;
  link: string | null;
  text: string | null;
  status: string;
  submittedAt: string;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
};
type AttemptRecord = {
  id: string;
  fullName: string;
  nisn: string;
  attemptNumber: number;
  status: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  answers: Array<{ prompt: string; type: QuestionType; answer: unknown; points: number }>;
};
type PlayQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  options: Array<{ id: string; text: string }> | null;
  points: number;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";
const dateLabel = (value: string | null): string =>
  value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "Tanpa batas waktu";
const dateTimeInputValue = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
};

export default function AssignmentsPage({ role }: { role: UserRole }) {
  const isTeacher = role === "TEACHER";
  const [classes, setClasses] = useState<Array<Pick<LearningClass, "id" | "name" | "subject">>>([]);
  const [classId, setClassId] = useState("");
  const [modules, setModules] = useState<Array<Pick<LearningModule, "id" | "title" | "position">>>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [tab, setTab] = useState<"assignments" | "assessments">("assignments");
  const [showForm, setShowForm] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [playQuestions, setPlayQuestions] = useState<PlayQuestion[]>([]);
  const [playAnswers, setPlayAnswers] = useState<Record<string, string | boolean>>({});
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
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

  const reloadLists = async (targetClassId: string) => {
    if (!targetClassId) return;
    const root = isTeacher ? "/api" : "/api/learning";
    const [assignmentData, assessmentData] = await Promise.all([
      apiRequest<{ assignments: Assignment[] }>(`${root}/classes/${targetClassId}/assignments`),
      apiRequest<{ assessments: Assessment[] }>(`${root}/classes/${targetClassId}/assessments`),
    ]);
    setAssignments(assignmentData.assignments);
    setAssessments(assessmentData.assessments);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setAssignments([]);
      setAssessments([]);
      setActiveAssignment(null);
      setActiveAssessment(null);
      if (!classId) {
        setModules([]);
        return;
      }
      try {
        const root = isTeacher ? "/api" : "/api/learning";
        const [assignmentData, assessmentData] = await Promise.all([
          apiRequest<{ assignments: Assignment[] }>(`${root}/classes/${classId}/assignments`),
          apiRequest<{ assessments: Assessment[] }>(`${root}/classes/${classId}/assessments`),
        ]);
        if (active) {
          setAssignments(assignmentData.assignments);
          setAssessments(assessmentData.assessments);
        }
        if (isTeacher) {
          const { modules: moduleItems } = await apiRequest<{ modules: typeof modules }>(
            `/api/classes/${classId}/modules`,
          );
          if (active) setModules(moduleItems);
        } else if (active) {
          setModules([]);
        }
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      }
    };
    void load();
    return () => { active = false; };
  }, [classId, isTeacher]);

  const deleteActivity = async (type: "assignment" | "assessment", id: string) => {
    if (!window.confirm(`Nonaktifkan ${type === "assignment" ? "tugas" : "asesmen"} ini? Riwayat siswa tetap tersimpan.`)) return;
    setError("");
    try {
      await apiRequest(`/api/${type === "assignment" ? "assignments" : "assessments"}/${id}`, { method: "DELETE" });
      await reloadLists(classId);
      setNotice("Aktivitas berhasil dinonaktifkan.");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    }
  };

  const openSubmissions = async (assignment: Assignment) => {
    setError("");
    setActiveAssignment(assignment);
    setActiveAssessment(null);
    try {
      const { submissions: items } = await apiRequest<{ submissions: SubmissionRecord[] }>(
        `/api/assignments/${assignment.id}/submissions`,
      );
      setSubmissions(items);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  const openAttempts = async (assessment: Assessment) => {
    setError("");
    setActiveAssessment(assessment);
    setActiveAssignment(null);
    try {
      const { attempts: items } = await apiRequest<{ attempts: AttemptRecord[] }>(
        `/api/assessments/${assessment.id}/attempts`,
      );
      setAttempts(items);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  const grade = async (type: "assignment-submissions" | "assessment-attempts", id: string, form: FormData) => {
    const score = Number(form.get("score"));
    const maxScore = Number(form.get("maxScore"));
    const feedback = String(form.get("feedback") ?? "");
    setError("");
    setIsSaving(true);
    try {
      await apiRequest(`/api/${type}/${id}/grade`, {
        method: "PUT",
        body: JSON.stringify({ score, maxScore, feedback }),
      });
      setNotice("Nilai dan umpan balik berhasil disimpan.");
      if (type === "assignment-submissions" && activeAssignment) await openSubmissions(activeAssignment);
      if (type === "assessment-attempts" && activeAssessment) await openAttempts(activeAssessment);
    } catch (gradeError) {
      setError(errorMessage(gradeError));
    } finally {
      setIsSaving(false);
    }
  };

  const startAssessment = async (assessment: Assessment) => {
    setError("");
    setNotice("");
    try {
      const { assessment: data } = await apiRequest<{ assessment: { questions: PlayQuestion[] } }>(
        `/api/learning/assessments/${assessment.id}`,
      );
      setPlayQuestions(data.questions);
      setPlayAnswers({});
      setActiveAssessment(assessment);
      setActiveAssignment(null);
      setAttempts([]);
    } catch (openError) {
      setError(errorMessage(openError));
    }
  };

  const submitAssessment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeAssessment) return;
    setError("");
    setIsSaving(true);
    try {
      const { awaitingTeacher, score, maxScore } = await apiRequest<{
        awaitingTeacher: boolean; score: number | null; maxScore: number | null;
      }>(`/api/learning/assessments/${activeAssessment.id}/attempts`, {
        method: "POST",
        body: JSON.stringify({
          answers: playQuestions.map((question) => ({
            questionId: question.id,
            answer: playAnswers[question.id],
          })),
        }),
      });
      setNotice(awaitingTeacher
        ? "Jawaban terkirim dan menunggu penilaian guru."
        : `Asesmen selesai. Nilai: ${score}/${maxScore}.`);
      setActiveAssessment(null);
      setPlayQuestions([]);
      await reloadLists(classId);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSaving(false);
    }
  };

  const submitAssignment = async (event: React.FormEvent<HTMLFormElement>, assignment: Assignment) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = new FormData(form);
    setError("");
    setIsSaving(true);
    try {
      const file = payload.get("file");
      if (assignment.submissionType === "FILE" && file instanceof File) {
        const target = await apiRequest<{
          mode: "local" | "direct";
          fileKey?: string;
          uploadUrl?: string;
        }>(`/api/learning/assignments/${assignment.id}/submission-upload-url`, {
          method: "POST",
          body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
        });
        if (target.mode === "direct" && target.fileKey && target.uploadUrl) {
          const uploaded = await fetch(target.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!uploaded.ok) throw new Error("File jawaban gagal diunggah ke penyimpanan.");
          await apiRequest(`/api/learning/assignments/${assignment.id}/submissions`, {
            method: "POST",
            body: JSON.stringify({ fileKey: target.fileKey }),
          });
        } else {
          await apiRequest(`/api/learning/assignments/${assignment.id}/submissions`, {
            method: "POST",
            body: payload,
          });
        }
      } else {
        await apiRequest(`/api/learning/assignments/${assignment.id}/submissions`, {
          method: "POST",
          body: payload,
        });
      }
      setNotice("Tugas berhasil dikumpulkan.");
      setActiveAssignment(null);
      await reloadLists(classId);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat tugas dan asesmen...</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-blue-800">{isTeacher ? "Ruang evaluasi kelas" : "Aktivitas belajar kamu"}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{isTeacher ? "Tugas dan Asesmen" : "Tugas Saya"}</h1>
          <p className="mt-2 text-sm text-slate-500">{isTeacher ? "Kelola tugas, kuis, pengumpulan, dan penilaian siswa." : "Kumpulkan tugas, kerjakan asesmen, dan lihat nilai serta umpan balik."}</p>
        </div>
        {isTeacher && classId && (
          <button type="button" onClick={() => { setEditingAssignment(null); setShowForm(true); setError(""); setNotice(""); }} className="w-full rounded-xl bg-[#102a43] px-4 py-3 text-sm font-bold text-white hover:bg-[#183d5d] sm:w-auto">+ Buat aktivitas</button>
        )}
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {classes.length === 0 ? (
        <EmptyPanel title={isTeacher ? "Buat kelas terlebih dahulu" : "Belum terdaftar di kelas"} text={isTeacher ? "Tambahkan kelas sebelum membuat tugas atau asesmen." : "Hubungi guru agar didaftarkan ke kelas pembelajaran."} />
      ) : (
        <>
          <label className="block max-w-xl">
            <span className="text-sm font-semibold text-slate-700">Pilih kelas</span>
            <select value={classId} onChange={(event) => { setClassId(event.target.value); setError(""); setNotice(""); }} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm">
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}
            </select>
          </label>

          <div className="flex flex-wrap gap-2 border-b border-slate-200">
            <TabButton active={tab === "assignments"} onClick={() => { setTab("assignments"); setActiveAssignment(null); setActiveAssessment(null); }}>Tugas <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{assignments.length}</span></TabButton>
            <TabButton active={tab === "assessments"} onClick={() => { setTab("assessments"); setActiveAssignment(null); setActiveAssessment(null); }}>Asesmen <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{assessments.length}</span></TabButton>
          </div>

          {isTeacher ? (
            tab === "assignments" ? (
              <div className="space-y-3">
                {assignments.length === 0 ? <EmptyPanel title="Belum ada tugas" text="Buat tugas untuk mulai menerima pengumpulan siswa." /> : assignments.map((item) => (
                  <article key={item.id} className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:p-5">
                    <ActivityInfo title={item.title} description={item.description} moduleTitle={item.moduleTitle} dueAt={item.dueAt} required={item.isRequired} detail={`${item.submissionType} · ${item.submissionCount ?? 0} pengumpulan`} />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void openSubmissions(item)} className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white">Lihat pengumpulan</button>
                      <button type="button" onClick={() => { setEditingAssignment(item); setShowForm(true); setError(""); setNotice(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                      <button type="button" onClick={() => void deleteActivity("assignment", item.id)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">Nonaktifkan</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {assessments.length === 0 ? <EmptyPanel title="Belum ada asesmen" text="Buat kuis untuk menguji pemahaman siswa." /> : assessments.map((item) => (
                  <article key={item.id} className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:p-5">
                    <ActivityInfo title={item.title} description={item.description} moduleTitle={item.moduleTitle} dueAt={item.dueAt} required={item.isRequired} detail={`${item.questionCount} soal · ${item.attemptCount ?? item.attemptCountTeacher ?? 0} percobaan`} />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void openAttempts(item)} className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white">Lihat hasil</button>
                      <button type="button" onClick={() => void deleteActivity("assessment", item.id)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">Nonaktifkan</button>
                    </div>
                  </article>
                ))}
              </div>
            )
          ) : tab === "assignments" ? (
            <div className="space-y-3">
              {assignments.length === 0 ? <EmptyPanel title="Belum ada tugas" text="Tugas yang diberikan guru akan muncul di sini." /> : assignments.map((item) => (
                <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <ActivityInfo title={item.title} description={item.instructions || item.description} moduleTitle={item.moduleTitle} dueAt={item.dueAt} required={item.isRequired} detail={`${item.submissionType} · ${item.submission ? `Percobaan ${item.submission.attemptNumber}` : "Belum dikumpulkan"}`} />
                    {!item.unlocked ? <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500">Modul terkunci</span>
                      : item.submission && !item.allowRevision ? <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Sudah dikumpulkan</span>
                        : <button type="button" onClick={() => { setActiveAssignment(item); setActiveAssessment(null); }} className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white">{item.submission ? "Kumpulkan revisi" : "Kumpulkan tugas"}</button>}
                  </div>
                  {item.submission && (
                    <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
                      <p className="font-semibold text-slate-700">Status: {item.submission.status} · {dateLabel(item.submission.submittedAt)}</p>
                      {item.submission.score !== null && <p className="mt-1 font-semibold text-blue-900">Nilai: {item.submission.score}/{item.submission.maxScore}</p>}
                      {item.submission.feedback && <p className="mt-1 text-slate-600">Umpan balik: {item.submission.feedback}</p>}
                    </div>
                  )}
                  {activeAssignment?.id === item.id && (
                    <form onSubmit={(event) => void submitAssignment(event, item)} className="mt-4 space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                      {item.submissionType === "FILE" ? <label className="block text-sm font-semibold text-slate-700">File jawaban (PDF, DOCX, JPG, PNG; maks. 20 MB)<input type="file" name="file" required accept=".pdf,.docx,.jpg,.jpeg,.png" className="mt-2 block w-full rounded-lg border border-slate-200 bg-white p-2 text-sm" /></label>
                        : item.submissionType === "LINK" ? <label className="block text-sm font-semibold text-slate-700">Tautan HTTPS<input type="url" name="externalUrl" required placeholder="https://" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>
                          : <label className="block text-sm font-semibold text-slate-700">Jawaban<textarea name="responseText" required maxLength={50000} rows={5} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>}
                      <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setActiveAssignment(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">Batal</button><button type="submit" disabled={isSaving} className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{isSaving ? "Mengirim..." : "Kirim tugas"}</button></div>
                    </form>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {assessments.length === 0 ? <EmptyPanel title="Belum ada asesmen" text="Asesmen dari guru akan muncul di sini." /> : assessments.map((item) => (
                <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <ActivityInfo title={item.title} description={item.description} moduleTitle={item.moduleTitle} dueAt={item.dueAt} required={item.isRequired} detail={`${item.questionCount} soal · ${item.attemptCount ?? 0}/${item.maxAttempts} percobaan`} />
                    {!item.unlocked ? <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500">Modul terkunci</span>
                      : (item.attemptCount ?? 0) >= (item.maxAttempts ?? 1) ? <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">Percobaan selesai</span>
                        : <button type="button" onClick={() => void startAssessment(item)} className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white">Mulai asesmen</button>}
                  </div>
                  {(item.score !== null && item.score !== undefined || item.feedback) && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">{item.score !== null && item.score !== undefined && <p className="font-semibold text-blue-900">Nilai: {item.score}/{item.maxScore}</p>}{item.feedback && <p className="mt-1 text-slate-600">Umpan balik: {item.feedback}</p>}</div>}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {showForm && isTeacher && (
        <ActivityForm
          modules={modules}
          initialTab={tab}
          key={editingAssignment?.id ?? "new-activity"}
          initialAssignment={editingAssignment ?? undefined}
          isSaving={isSaving}
          onClose={() => { setShowForm(false); setEditingAssignment(null); }}
          onSubmit={async (kind, payload) => {
            setIsSaving(true);
            setError("");
            try {
              const isEditing = kind === "assignments" && editingAssignment !== null;
              const path = isEditing
                ? `/api/assignments/${editingAssignment.id}`
                : `/api/classes/${classId}/${kind}`;
              await apiRequest(path, { method: isEditing ? "PUT" : "POST", body: JSON.stringify(payload) });
              setShowForm(false);
              setEditingAssignment(null);
              setNotice(isEditing ? "Tugas berhasil diperbarui." : kind === "assignments" ? "Tugas berhasil dibuat." : "Asesmen berhasil dibuat.");
              await reloadLists(classId);
            } catch (saveError) {
              setError(errorMessage(saveError));
            } finally {
              setIsSaving(false);
            }
          }}
        />
      )}

      {activeAssignment && isTeacher && (
        <RecordDialog title={`Pengumpulan: ${activeAssignment.title}`} onClose={() => setActiveAssignment(null)}>
          {submissions.length === 0 ? <EmptyPanel title="Belum ada pengumpulan" text="Pengumpulan siswa akan muncul di sini." /> : submissions.map((item) => (
            <RecordCard key={item.id} name={item.fullName} secondary={`NISN ${item.nisn} · ${item.status} · ${dateLabel(item.submittedAt)}`}>
              {item.fileUrl && <a className="font-semibold text-blue-800 underline" href={item.fileUrl}>Unduh jawaban</a>}
              {item.link && <a className="break-all font-semibold text-blue-800 underline" href={item.link} target="_blank" rel="noreferrer">Buka tautan siswa</a>}
              {item.text && <p className="whitespace-pre-wrap text-sm text-slate-700">{item.text}</p>}
              <GradeForm initialScore={item.score} initialMax={item.maxScore ?? activeAssignment.weight ?? 50} feedback={item.feedback} isSaving={isSaving} onSubmit={(form) => void grade("assignment-submissions", item.id, form)} />
            </RecordCard>
          ))}
        </RecordDialog>
      )}

      {activeAssessment && isTeacher && !playQuestions.length && (
        <RecordDialog title={`Hasil asesmen: ${activeAssessment.title}`} onClose={() => setActiveAssessment(null)}>
          {attempts.length === 0 ? <EmptyPanel title="Belum ada percobaan" text="Hasil pengerjaan siswa akan muncul di sini." /> : attempts.map((item) => (
            <RecordCard key={item.id} name={item.fullName} secondary={`NISN ${item.nisn} · Percobaan ${item.attemptNumber} · ${item.status}`}>
              {item.answers.map((answer, index) => <div key={`${item.id}-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold text-slate-700">{index + 1}. {answer.prompt}</p><p className="mt-1 whitespace-pre-wrap text-slate-600">{typeof answer.answer === "string" ? answer.answer : JSON.stringify(answer.answer)}</p></div>)}
              <GradeForm initialScore={item.score} initialMax={item.maxScore ?? 100} feedback={item.feedback} isSaving={isSaving} onSubmit={(form) => void grade("assessment-attempts", item.id, form)} />
            </RecordCard>
          ))}
        </RecordDialog>
      )}

      {activeAssessment && !isTeacher && playQuestions.length > 0 && (
        <RecordDialog title={activeAssessment.title} onClose={() => { setActiveAssessment(null); setPlayQuestions([]); }}>
          <form onSubmit={(event) => void submitAssessment(event)} className="space-y-5">
            {playQuestions.map((question, index) => (
              <fieldset key={question.id} className="rounded-xl border border-slate-200 p-4">
                <legend className="px-2 text-sm font-bold text-slate-900">Soal {index + 1} · {question.points} poin</legend>
                <p className="mb-3 text-sm leading-6 text-slate-700">{question.prompt}</p>
                {question.type === "MULTIPLE_CHOICE" ? <div className="space-y-2">{question.options?.map((option) => (
                  <label key={option.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm"><input required type="radio" name={`q-${question.id}`} checked={playAnswers[question.id] === option.id} onChange={() => setPlayAnswers((current) => ({ ...current, [question.id]: option.id }))} className="mt-0.5 accent-blue-800" />{option.text}</label>
                ))}</div> : question.type === "TRUE_FALSE" ? <div className="flex gap-4">{[true, false].map((value) => <label key={String(value)} className="flex items-center gap-2 text-sm"><input required type="radio" name={`q-${question.id}`} checked={playAnswers[question.id] === value} onChange={() => setPlayAnswers((current) => ({ ...current, [question.id]: value }))} className="accent-blue-800" />{value ? "Benar" : "Salah"}</label>)}</div>
                  : <textarea required maxLength={question.type === "ESSAY" ? 10000 : 1000} rows={question.type === "ESSAY" ? 5 : 2} value={String(playAnswers[question.id] ?? "")} onChange={(event) => setPlayAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />}
              </fieldset>
            ))}
            <div className="flex justify-end"><button type="submit" disabled={isSaving} className="rounded-xl bg-blue-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{isSaving ? "Mengirim..." : "Kirim asesmen"}</button></div>
          </form>
        </RecordDialog>
      )}
    </div>
  );
}

function ActivityForm({
  modules, initialTab, initialAssignment, isSaving, onClose, onSubmit,
}: {
  modules: Array<Pick<LearningModule, "id" | "title" | "position">>;
  initialTab: "assignments" | "assessments";
  initialAssignment?: Assignment;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (kind: "assignments" | "assessments", payload: Record<string, unknown>) => Promise<void>;
}) {
  const [kind, setKind] = useState<"assignments" | "assessments">(initialTab);
  const [questions, setQuestions] = useState<QuestionDraft[]>([
    { id: "q1", type: "MULTIPLE_CHOICE", prompt: "", options: [{ id: "a", text: "" }, { id: "b", text: "" }], answerKey: "a", points: 1 },
  ]);
  const addQuestion = () => {
    setQuestions((items) => [...items, {
      id: `q${items.length + 1}`, type: "MULTIPLE_CHOICE", prompt: "",
      options: [{ id: "a", text: "" }, { id: "b", text: "" }], answerKey: "a", points: 1,
    }]);
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const common = {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      moduleId: String(form.get("moduleId") ?? "") || null,
      startsAt: String(form.get("startsAt") ?? "") ? new Date(String(form.get("startsAt"))).toISOString() : null,
      dueAt: String(form.get("dueAt") ?? "") ? new Date(String(form.get("dueAt"))).toISOString() : null,
      isRequired: form.get("isRequired") === "on",
    };
    if (kind === "assignments") {
      void onSubmit(kind, {
        ...common,
        instructions: String(form.get("instructions") ?? "").trim(),
        submissionType: String(form.get("submissionType")),
        weight: Number(form.get("weight") || 0),
        allowLateSubmission: form.get("allowLateSubmission") === "on",
        allowRevision: form.get("allowRevision") === "on",
      });
    } else {
      void onSubmit(kind, {
        ...common,
        maxAttempts: Number(form.get("maxAttempts") || 1),
        passScore: String(form.get("passScore") ?? "") ? Number(form.get("passScore")) : null,
        questions: questions.map((question) => ({
          type: question.type,
          prompt: question.prompt,
          points: question.points,
          options: question.type === "MULTIPLE_CHOICE" ? question.options : undefined,
          answerKey: question.type === "ESSAY" ? undefined : question.answerKey,
        })),
      });
    }
  };

  return (
    <RecordDialog title={initialAssignment ? "Edit tugas" : "Buat aktivitas belajar"} onClose={onClose}>
      {!initialAssignment && <div className="mb-4 flex gap-2 rounded-xl bg-slate-100 p-1">
        <button type="button" onClick={() => setKind("assignments")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${kind === "assignments" ? "bg-white text-blue-900 shadow-sm" : "text-slate-600"}`}>Tugas</button>
        <button type="button" onClick={() => setKind("assessments")} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${kind === "assessments" ? "bg-white text-blue-900 shadow-sm" : "text-slate-600"}`}>Asesmen</button>
      </div>}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-semibold text-slate-700">Judul<input name="title" required minLength={2} maxLength={180} defaultValue={initialAssignment?.title ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label>
        <label className="block text-sm font-semibold text-slate-700">Deskripsi<textarea name="description" rows={2} maxLength={5000} defaultValue={initialAssignment?.description ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label>
        <label className="block text-sm font-semibold text-slate-700">Modul (opsional)<select name="moduleId" defaultValue={initialAssignment?.moduleId ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal"><option value="">Tugas/asesmen kelas umum</option>{modules.map((module) => <option key={module.id} value={module.id}>{module.position}. {module.title}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold text-slate-700">Mulai<input name="startsAt" type="datetime-local" defaultValue={dateTimeInputValue(initialAssignment?.startsAt ?? null)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label><label className="block text-sm font-semibold text-slate-700">Tenggat<input name="dueAt" type="datetime-local" defaultValue={dateTimeInputValue(initialAssignment?.dueAt ?? null)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label></div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input name="isRequired" type="checkbox" defaultChecked={initialAssignment?.isRequired ?? true} className="accent-blue-800" />Wajib untuk menyelesaikan modul</label>

        {kind === "assignments" ? <>
          <label className="block text-sm font-semibold text-slate-700">Jenis pengumpulan<select name="submissionType" disabled={(initialAssignment?.submissionCount ?? 0) > 0} defaultValue={initialAssignment?.submissionType ?? "TEXT"} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal"><option value="TEXT">Teks</option><option value="FILE">Unggah file</option><option value="LINK">Tautan HTTPS</option></select>{(initialAssignment?.submissionCount ?? 0) > 0 && <input type="hidden" name="submissionType" value={initialAssignment?.submissionType} />}</label>
          <label className="block text-sm font-semibold text-slate-700">Instruksi pengerjaan<textarea name="instructions" rows={3} maxLength={10000} defaultValue={initialAssignment?.instructions ?? ""} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">Bobot nilai (poin)<input name="weight" type="number" min={50} max={100} step={1} defaultValue={Math.min(100, Math.max(50, initialAssignment?.weight ?? 50))} required className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="allowLateSubmission" type="checkbox" defaultChecked={initialAssignment?.allowLateSubmission ?? false} className="accent-blue-800" />Terima pengumpulan terlambat</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="allowRevision" type="checkbox" defaultChecked={initialAssignment?.allowRevision ?? false} className="accent-blue-800" />Izinkan pengumpulan ulang</label>
        </> : <>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold text-slate-700">Maks. percobaan<input name="maxAttempts" type="number" min={1} max={20} defaultValue={1} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label><label className="block text-sm font-semibold text-slate-700">Nilai lulus (%)<input name="passScore" type="number" min={0} max={100} placeholder="Opsional" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" /></label></div>
          <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-bold text-slate-900">Soal ({questions.length}/100)</h3><button type="button" disabled={questions.length >= 100} onClick={addQuestion} className="text-sm font-semibold text-blue-800 disabled:opacity-50">+ Tambah soal</button></div>
            {questions.map((question, index) => <fieldset key={question.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between"><legend className="text-sm font-bold text-slate-800">Soal {index + 1}</legend>{questions.length > 1 && <button type="button" onClick={() => setQuestions((items) => items.filter((item) => item.id !== question.id))} className="text-xs font-semibold text-red-700">Hapus</button>}</div>
              <select aria-label={`Tipe soal ${index + 1}`} value={question.type} onChange={(event) => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, type: event.target.value as QuestionType, answerKey: event.target.value === "TRUE_FALSE" ? true : item.options[0]?.id ?? "a" } : item))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="MULTIPLE_CHOICE">Pilihan ganda</option><option value="TRUE_FALSE">Benar / salah</option><option value="SHORT_ANSWER">Isian singkat (otomatis dinilai)</option><option value="ESSAY">Esai (dinilai guru)</option></select>
              <textarea required minLength={3} maxLength={2000} value={question.prompt} onChange={(event) => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, prompt: event.target.value } : item))} placeholder="Tulis pertanyaan..." rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <label className="block text-xs font-semibold text-slate-600">Poin<input type="number" min={0.01} max={100} step="0.01" value={question.points} onChange={(event) => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, points: Number(event.target.value) } : item))} className="ml-2 w-24 rounded border border-slate-200 px-2 py-1 text-sm" /></label>
              {question.type === "MULTIPLE_CHOICE" && <div className="space-y-2">{question.options.map((option, optionIndex) => <div key={option.id} className="flex items-center gap-2"><input type="radio" aria-label={`Kunci jawaban soal ${index + 1} pilihan ${optionIndex + 1}`} checked={question.answerKey === option.id} onChange={() => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, answerKey: option.id } : item))} className="accent-emerald-700" /><input required value={option.text} onChange={(event) => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, options: item.options.map((choice) => choice.id === option.id ? { ...choice, text: event.target.value } : choice) } : item))} placeholder={`Pilihan ${optionIndex + 1}`} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />{question.options.length > 2 && <button type="button" onClick={() => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, options: item.options.filter((choice) => choice.id !== option.id), answerKey: item.answerKey === option.id ? item.options.find((choice) => choice.id !== option.id)?.id ?? "a" : item.answerKey } : item))} className="text-red-600">×</button>}</div>)}{question.options.length < 6 && <button type="button" onClick={() => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, options: [...item.options, { id: `c${item.options.length + 1}`, text: "" }] } : item))} className="text-xs font-semibold text-blue-800">+ Pilihan</button>}</div>}
              {question.type === "TRUE_FALSE" && <label className="block text-sm">Kunci jawaban<select value={String(question.answerKey)} onChange={(event) => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, answerKey: event.target.value === "true" } : item))} className="ml-2 rounded border border-slate-200 bg-white px-2 py-1"><option value="true">Benar</option><option value="false">Salah</option></select></label>}
              {question.type === "SHORT_ANSWER" && <label className="block text-sm font-semibold text-slate-700">Kunci jawaban<input required value={String(question.answerKey)} onChange={(event) => setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, answerKey: event.target.value } : item))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label>}
              {question.type === "ESSAY" && <p className="text-xs text-amber-800">Jawaban esai ditinjau dan dinilai guru setelah dikumpulkan.</p>}
            </fieldset>)}
          </div>
        </>}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold">Batal</button><button type="submit" disabled={isSaving} className="rounded-xl bg-[#102a43] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{isSaving ? "Menyimpan..." : initialAssignment ? "Simpan perubahan" : "Buat aktivitas"}</button></div>
      </form>
    </RecordDialog>
  );
}

function ActivityInfo({ title, description, moduleTitle, dueAt, required, detail }: {
  title: string; description: string | null; moduleTitle: string | null; dueAt: string | null;
  required: boolean; detail: string;
}) {
  return <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-slate-900">{title}</h2><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${required ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{required ? "Wajib" : "Opsional"}</span></div>{description && <p className="mt-1 text-sm text-slate-600">{description}</p>}<p className="mt-2 text-xs text-slate-500">{moduleTitle ? `Modul: ${moduleTitle} · ` : ""}{detail} · Tenggat: {dateLabel(dueAt)}</p></div>;
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`border-b-2 px-4 py-3 text-sm font-semibold ${active ? "border-blue-800 text-blue-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{children}</button>;
}

function RecordDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-3 sm:p-5"><section role="dialog" aria-modal="true" aria-label={title} className="my-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-7"><header className="mb-5 flex items-start justify-between gap-3"><h2 className="text-xl font-bold text-slate-900">{title}</h2><button type="button" onClick={onClose} aria-label="Tutup" className="rounded-lg px-2 text-xl text-slate-400 hover:bg-slate-100">×</button></header>{children}</section></div>;
}

function RecordCard({ name, secondary, children }: { name: string; secondary: string; children: React.ReactNode }) {
  return <article className="mb-3 space-y-3 rounded-xl border border-slate-200 p-4"><div><h3 className="font-bold text-slate-900">{name}</h3><p className="mt-1 text-xs text-slate-500">{secondary}</p></div>{children}</article>;
}

function GradeForm({ initialScore, initialMax, feedback, isSaving, onSubmit }: {
  initialScore: number | null; initialMax: number; feedback: string | null;
  isSaving: boolean; onSubmit: (form: FormData) => void;
}) {
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }} className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[100px_100px_1fr_auto]">
    <label className="text-xs font-semibold text-slate-600">Nilai<input name="score" required type="number" min={0} max={10000} step="0.01" defaultValue={initialScore ?? ""} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
    <label className="text-xs font-semibold text-slate-600">Maksimum<input name="maxScore" required type="number" min={0.01} max={10000} step="0.01" defaultValue={initialMax} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
    <label className="text-xs font-semibold text-slate-600">Umpan balik<textarea name="feedback" defaultValue={feedback ?? ""} maxLength={5000} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
    <button type="submit" disabled={isSaving} className="self-end rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? "..." : "Simpan nilai"}</button>
  </form>;
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><h2 className="font-bold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p></section>;
}
