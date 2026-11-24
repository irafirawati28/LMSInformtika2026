import { useEffect, useState } from "react";
import {
  apiRequest,
  type LearningClass,
  type LearningModule,
  type UserRole,
} from "../../lib/api";

type ModuleChoice = Pick<LearningModule, "id" | "title" | "position" | "unlocked">;
type GameSummary = {
  id: string;
  gameId: string;
  title: string;
  description: string | null;
  position: number;
  isRequired: boolean;
  questionCount: number;
  passScore: number;
  externalUrl?: string | null;
  completedCount?: number;
  studentCount?: number;
  completed?: boolean;
};
type GameChoice = { id: string; text: string };
type GameQuestion = {
  id: string;
  prompt: string;
  choices: GameChoice[];
  answerId: string;
};
type PlayableGame = {
  id: string;
  contentId: string;
  moduleId: string;
  instructions: string;
  passScore: number;
  questions: Array<Omit<GameQuestion, "answerId">>;
  latestResult: { score: number; maxScore: number; passed: boolean } | null;
};
type GameSubmission = {
  score: number;
  maxScore: number;
  passed: boolean;
  passScore: number;
  moduleProgress: number;
  moduleCompleted: boolean;
  nextModuleUnlocked: boolean;
};

const messageFrom = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";

export default function GamesPage({ role }: { role: UserRole }) {
  const isTeacher = role === "TEACHER";
  const [classes, setClasses] = useState<Array<Pick<LearningClass, "id" | "name" | "subject">>>([]);
  const [classId, setClassId] = useState("");
  const [modules, setModules] = useState<ModuleChoice[]>([]);
  const [moduleId, setModuleId] = useState("");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [currentGame, setCurrentGame] = useState<PlayableGame | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GameSubmission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const selectedClass = classes.find((item) => item.id === classId);
  const selectedModule = modules.find((item) => item.id === moduleId);

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
        if (active) setError(messageFrom(loadError));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadClasses();
    return () => {
      active = false;
    };
  }, [isTeacher]);

  useEffect(() => {
    let active = true;
    const loadModules = async () => {
      setGames([]);
      setCurrentGame(null);
      setResult(null);
      setModuleId("");
      if (!classId) {
        setModules([]);
        return;
      }
      try {
        const path = isTeacher
          ? `/api/classes/${classId}/modules`
          : `/api/learning/classes/${classId}/modules`;
        const { modules: items } = await apiRequest<{ modules: ModuleChoice[] }>(path);
        if (active) {
          setModules(items);
          setModuleId(items[0]?.id ?? "");
        }
      } catch (loadError) {
        if (active) setError(messageFrom(loadError));
      }
    };
    void loadModules();
    return () => {
      active = false;
    };
  }, [classId, isTeacher]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setCurrentGame(null);
      setResult(null);
      if (!moduleId || (!isTeacher && !selectedModule?.unlocked)) {
        setGames([]);
        return;
      }
      try {
        const path = isTeacher
          ? `/api/modules/${moduleId}/games`
          : `/api/learning/modules/${moduleId}/games`;
        const { games: items } = await apiRequest<{ games: GameSummary[] }>(path);
        if (active) setGames(items);
      } catch (loadError) {
        if (active) setError(messageFrom(loadError));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [isTeacher, moduleId, selectedModule?.unlocked]);

  const startGame = async (gameId: string) => {
    setError("");
    setResult(null);
    setAnswers({});
    try {
      const { game } = await apiRequest<{ game: PlayableGame }>(
        `/api/learning/games/${gameId}`,
      );
      setGames((items) => items.map((item) =>
        item.gameId === gameId && game.latestResult?.passed
          ? { ...item, completed: true }
          : item,
      ));
      setCurrentGame(game);
    } catch (loadError) {
      setError(messageFrom(loadError));
    }
  };

  const submitAnswers = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentGame) return;
    setError("");
    setIsSaving(true);
    try {
      const submission = await apiRequest<GameSubmission>(
        `/api/learning/games/${currentGame.id}/submit`,
        {
          method: "POST",
          body: JSON.stringify({
            answers: currentGame.questions.map((question) => ({
              questionId: question.id,
              choiceId: answers[question.id],
            })),
          }),
        },
      );
      setResult(submission);
      setGames((items) => items.map((item) =>
        item.gameId === currentGame.id && submission.passed
          ? { ...item, completed: true }
          : item,
      ));
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setIsSaving(false);
    }
  };

  const archiveGame = async (game: GameSummary) => {
    if (!window.confirm(`Nonaktifkan game "${game.title}"? Riwayat percobaan siswa tetap tersimpan.`)) return;
    setError("");
    try {
      await apiRequest(`/api/contents/${game.id}`, { method: "DELETE" });
      setNotice("Game dinonaktifkan.");
      const { games: items } = await apiRequest<{ games: GameSummary[] }>(
        `/api/modules/${moduleId}/games`,
      );
      setGames(items);
    } catch (archiveError) {
      setError(messageFrom(archiveError));
    }
  };

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat games interaktif...</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-blue-800">{isTeacher ? "Ruang pengelolaan" : "Ruang bermain dan belajar"}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Games Interaktif</h1>
          <p className="mt-2 text-sm text-slate-500">
            {isTeacher ? "Buat kuis pilihan ganda sebagai bagian dari pembelajaran bertahap." : "Jawab kuis dan raih nilai minimum untuk menyelesaikan aktivitas wajib."}
          </p>
        </div>
        {isTeacher && moduleId && (
          <button type="button" onClick={() => { setShowForm(true); setError(""); setNotice(""); }} className="w-full rounded-xl bg-[#102a43] px-4 py-3 text-sm font-bold text-white hover:bg-[#183d5d] sm:w-auto">+ Buat game</button>
        )}
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {classes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Pilih kelas</span>
            <select value={classId} onChange={(event) => { setClassId(event.target.value); setError(""); }} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm">
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Pilih modul</span>
            <select value={moduleId} onChange={(event) => { setModuleId(event.target.value); setError(""); }} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm">
              {modules.map((item) => <option key={item.id} value={item.id}>{item.position}. {item.title}{!isTeacher && item.unlocked === false ? " · Terkunci" : ""}</option>)}
            </select>
          </label>
        </div>
      )}

      {classes.length === 0 ? (
        <EmptyPanel title={isTeacher ? "Buat kelas terlebih dahulu" : "Belum terdaftar di kelas"} text={isTeacher ? "Tambahkan kelas dan modul sebelum membuat game." : "Hubungi guru agar didaftarkan ke kelas pembelajaran."} />
      ) : !isTeacher && selectedModule?.unlocked === false ? (
        <EmptyPanel title="Modul masih terkunci" text="Selesaikan semua persyaratan pada modul sebelumnya untuk membuka game ini." />
      ) : currentGame ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">{selectedClass?.name} · {selectedModule?.title}</span>
              <h2 className="mt-3 text-xl font-bold text-slate-900">{games.find((item) => item.gameId === currentGame.id)?.title ?? "Game pembelajaran"}</h2>
              <p className="mt-2 text-sm text-slate-500">{currentGame.instructions || "Pilih satu jawaban terbaik pada setiap soal."} Nilai lulus: {currentGame.passScore}%.</p>
            </div>
            <button type="button" onClick={() => { setCurrentGame(null); setResult(null); }} className="self-start rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Kembali</button>
          </div>

          {result && (
            <div className={`mt-5 rounded-xl border p-4 ${result.passed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
              <div className="text-lg font-bold">{result.passed ? "Hebat, kamu lulus!" : "Belum mencapai nilai lulus"}</div>
              <p className="mt-1 text-sm">Nilai kamu {result.score}/100. Nilai minimum: {result.passScore}%.</p>
              {result.moduleCompleted && <p className="mt-1 text-sm font-semibold">Modul selesai — progres {result.moduleProgress}%.</p>}
              {result.nextModuleUnlocked && <p className="mt-1 text-sm font-semibold">Modul berikutnya sekarang terbuka.</p>}
              {!result.passed && <button type="button" onClick={() => { setResult(null); setAnswers({}); }} className="mt-3 rounded-lg bg-amber-800 px-3 py-2 text-sm font-semibold text-white">Coba lagi</button>}
            </div>
          )}

          <form onSubmit={(event) => void submitAnswers(event)} className="mt-6 space-y-5">
            {currentGame.questions.map((question, index) => (
              <fieldset key={question.id} disabled={Boolean(result)} className="rounded-xl border border-slate-200 p-4 sm:p-5">
                <legend className="px-2 text-sm font-bold text-slate-900">Soal {index + 1}</legend>
                <p className="text-sm leading-6 text-slate-700">{question.prompt}</p>
                <div className="mt-3 space-y-2">
                  {question.choices.map((choice) => (
                    <label key={choice.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${answers[question.id] === choice.id ? "border-blue-700 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
                      <input type="radio" name={`question-${question.id}`} required checked={answers[question.id] === choice.id} onChange={() => setAnswers((current) => ({ ...current, [question.id]: choice.id }))} className="mt-0.5 size-4 accent-blue-800" />
                      <span className="text-slate-700">{choice.text}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            {!result && <button type="submit" disabled={isSaving} className="w-full rounded-xl bg-blue-800 px-4 py-3 text-sm font-bold text-white hover:bg-blue-900 disabled:opacity-60 sm:w-auto">{isSaving ? "Memeriksa jawaban..." : "Kirim jawaban"}</button>}
          </form>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Game dalam modul</h2>
              <p className="mt-1 text-sm text-slate-500">{selectedClass?.name} · {selectedModule?.title}</p>
            </div>
            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">{games.length}</span>
          </div>
          {games.length === 0 ? (
            <EmptyPanel title="Belum ada game" text={isTeacher ? "Buat game pilihan ganda agar siswa dapat berlatih dan modul bisa memiliki aktivitas interaktif." : "Guru belum menambahkan game pada modul ini."} />
          ) : games.map((game) => (
            <article key={game.gameId} className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-lg ${game.completed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{game.completed ? "✓" : "✦"}</span>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900">{game.title}</h3>
                  {game.description && <p className="mt-1 text-sm text-slate-500">{game.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    {game.externalUrl ? <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-800">Game eksternal</span> : <>
                      <span className="rounded-md bg-slate-100 px-2 py-1">{game.questionCount} soal</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1">Lulus {game.passScore}%</span>
                      {isTeacher && <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">{game.completedCount ?? 0}/{game.studentCount ?? 0} siswa lulus</span>}
                    </>}
                    <span className={`rounded-md px-2 py-1 ${game.isRequired ? "bg-amber-50 text-amber-800" : "bg-slate-100"}`}>{game.isRequired ? "Wajib" : "Opsional"}</span>
                    {!isTeacher && !game.externalUrl && <span className={`rounded-md px-2 py-1 ${game.completed ? "bg-emerald-50 text-emerald-800" : "bg-blue-50 text-blue-800"}`}>{game.completed ? "Selesai" : "Belum lulus"}</span>}
                  </div>
                </div>
              </div>
              {isTeacher ? (
                <div className="flex flex-wrap gap-2">
                  {game.externalUrl && <a href={game.externalUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50">Buka tautan</a>}
                  <button type="button" onClick={() => void archiveGame(game)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Nonaktifkan</button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {game.externalUrl && <a href={game.externalUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-800 hover:bg-blue-50">Buka game eksternal</a>}
                  {!game.externalUrl && <button type="button" onClick={() => void startGame(game.gameId)} className="shrink-0 rounded-xl bg-[#102a43] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#183d5d]">{game.completed ? "Ulangi game" : "Mulai game"}</button>}
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {showForm && isTeacher && (
        <GameForm
          moduleName={selectedModule?.title ?? ""}
          isSaving={isSaving}
          onClose={() => setShowForm(false)}
          onSubmit={async (payload) => {
            setIsSaving(true);
            setError("");
            try {
              await apiRequest(`/api/modules/${moduleId}/games`, {
                method: "POST",
                body: JSON.stringify(payload),
              });
              setShowForm(false);
              setNotice("Game berhasil dibuat dan ditambahkan ke urutan materi.");
              const { games: items } = await apiRequest<{ games: GameSummary[] }>(
                `/api/modules/${moduleId}/games`,
              );
              setGames(items);
            } catch (saveError) {
              setError(messageFrom(saveError));
            } finally {
              setIsSaving(false);
            }
          }}
        />
      )}
    </div>
  );
}

function GameForm({
  moduleName,
  isSaving,
  onClose,
  onSubmit,
}: {
  moduleName: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    description: string;
    isRequired: boolean;
    configuration: { instructions: string; passScore: number; externalUrl: string | null; questions: GameQuestion[] };
  }) => Promise<void>;
}) {
  const [questions, setQuestions] = useState<GameQuestion[]>([
    { id: "q1", prompt: "", choices: [{ id: "a", text: "" }, { id: "b", text: "" }], answerId: "a" },
  ]);
  const [externalUrl, setExternalUrl] = useState("");
  const [isRequired, setIsRequired] = useState(true);
  const [questionError, setQuestionError] = useState("");
  const addQuestion = () => {
    if (questions.length >= 20) return;
    const id = `q${questions.length + 1}`;
    setQuestions((current) => [...current, {
      id,
      prompt: "",
      choices: [{ id: "a", text: "" }, { id: "b", text: "" }],
      answerId: "a",
    }]);
  };
  const updateQuestion = (questionId: string, change: (question: GameQuestion) => GameQuestion) => {
    setQuestions((current) => current.map((question) => question.id === questionId ? change(question) : question));
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const instructions = String(form.get("instructions") ?? "").trim();
    const passScore = Number(form.get("passScore"));
    const gameUrl = externalUrl.trim() || null;
    if (!gameUrl && (
      questions.some((question) =>
        question.prompt.trim().length < 3 ||
        question.choices.some((choice) => !choice.text.trim()) ||
        !question.choices.some((choice) => choice.id === question.answerId)
      )
    )) {
      setQuestionError("Lengkapi semua pertanyaan, pilihan, dan kunci jawaban.");
      return;
    }
    setQuestionError("");
    void onSubmit({
      title,
      description,
      isRequired: isRequired && !gameUrl,
      configuration: { instructions, passScore: gameUrl ? 70 : passScore, externalUrl: gameUrl, questions: gameUrl ? [] : questions },
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="game-form-title" className="my-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-7">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="game-form-title" className="text-xl font-bold text-slate-900">Buat game pilihan ganda</h2>
            <p className="mt-1 text-sm text-slate-500">Game ditambahkan ke modul {moduleName}.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup formulir" className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100">×</button>
        </header>
        <form className="mt-5 space-y-5" onSubmit={submit}>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Judul game</span><input name="title" required minLength={2} maxLength={180} placeholder="Contoh: Kuis Dasar Pemrograman" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Deskripsi</span><textarea name="description" rows={2} maxLength={5000} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Instruksi permainan</span><textarea name="instructions" rows={2} maxLength={2000} placeholder="Pilih satu jawaban yang paling tepat." className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Tautan game eksternal (opsional)</span><input name="externalUrl" type="url" maxLength={2048} value={externalUrl} onChange={(event) => { setExternalUrl(event.target.value); setQuestionError(""); if (event.target.value.trim()) setIsRequired(false); }} placeholder="https://..." className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /><span className="mt-1 block text-xs font-normal text-slate-500">Tempel URL game. Tautan dibuka di tab baru; penyelesaian game eksternal tidak dapat dinilai otomatis.</span></label>
          <div className="grid gap-4 sm:grid-cols-2">
            {!externalUrl && <label className="block"><span className="text-sm font-semibold text-slate-700">Nilai lulus (%)</span><input name="passScore" type="number" min={1} max={100} defaultValue={70} required className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm" /></label>}
            <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium text-slate-700"><input name="isRequired" type="checkbox" checked={isRequired && !externalUrl} disabled={Boolean(externalUrl)} onChange={(event) => setIsRequired(event.target.checked)} className="size-4 accent-blue-800" />Game wajib diselesaikan</label>
          </div>
          {!externalUrl ? <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900">Pertanyaan ({questions.length}/20)</h3>
              <button type="button" disabled={questions.length >= 20} onClick={addQuestion} className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50">+ Tambah soal</button>
            </div>
            {questions.map((question, questionIndex) => (
              <fieldset key={question.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <legend className="px-1 text-sm font-bold text-slate-800">Soal {questionIndex + 1}</legend>
                  {questions.length > 1 && <button type="button" onClick={() => setQuestions((current) => current.filter((item) => item.id !== question.id))} className="text-xs font-semibold text-red-700">Hapus soal</button>}
                </div>
                <textarea required minLength={3} maxLength={1000} value={question.prompt} onChange={(event) => updateQuestion(question.id, (item) => ({ ...item, prompt: event.target.value }))} placeholder="Tulis pertanyaan..." rows={2} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-700" />
                <div className="mt-3 space-y-2">
                  {question.choices.map((choice, choiceIndex) => (
                    <div key={choice.id} className="flex items-center gap-2">
                      <input type="radio" name={`answer-${question.id}`} aria-label={`Pilihan benar ${choiceIndex + 1} untuk soal ${questionIndex + 1}`} checked={question.answerId === choice.id} onChange={() => updateQuestion(question.id, (item) => ({ ...item, answerId: choice.id }))} className="size-4 accent-emerald-700" />
                      <input required maxLength={500} value={choice.text} onChange={(event) => updateQuestion(question.id, (item) => ({ ...item, choices: item.choices.map((option) => option.id === choice.id ? { ...option, text: event.target.value } : option) }))} placeholder={`Pilihan ${choiceIndex + 1}${question.answerId === choice.id ? " · jawaban benar" : ""}`} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-700" />
                      {question.choices.length > 2 && <button type="button" onClick={() => updateQuestion(question.id, (item) => { const choices = item.choices.filter((option) => option.id !== choice.id); return { ...item, choices, answerId: item.answerId === choice.id ? choices[0]?.id ?? "" : item.answerId }; })} aria-label="Hapus pilihan" className="px-1 text-lg text-red-600">×</button>}
                    </div>
                  ))}
                </div>
                {question.choices.length < 6 && <button type="button" onClick={() => updateQuestion(question.id, (item) => { const id = `c${item.choices.length + 1}`; return { ...item, choices: [...item.choices, { id, text: "" }] }; })} className="mt-2 text-xs font-semibold text-blue-800">+ Tambah pilihan</button>}
              </fieldset>
            ))}
          </div> : <p className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">Game ini menjadi tautan opsional. Siswa membuka game di tab baru; nilai dan progres penyelesaian tidak tercatat di LMS.</p>}
          {questionError && <p role="alert" className="text-sm text-red-700">{questionError}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Batal</button>
            <button type="submit" disabled={isSaving} className="rounded-xl bg-[#102a43] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{isSaving ? "Menyimpan..." : "Buat game"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-2xl text-amber-800">✦</div><h2 className="mt-4 font-bold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p></section>;
}
