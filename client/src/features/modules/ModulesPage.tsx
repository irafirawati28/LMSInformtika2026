import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiRequest,
  type LearningClass,
  type LearningModule,
  type ModuleContent,
  type ModuleContentType,
  type UserRole,
} from "../../lib/api";

type ModuleClass = Pick<LearningClass, "id" | "name" | "subject">;

const materialTypes: { value: ModuleContentType; label: string }[] = [
  { value: "TEXT", label: "Teks pembelajaran" },
  { value: "PDF", label: "Modul PDF (tautan HTTPS)" },
  { value: "DOCX", label: "Dokumen Word (tautan HTTPS)" },
  { value: "IMAGE", label: "Gambar (tautan HTTPS)" },
  { value: "VIDEO", label: "Video (tautan HTTPS)" },
  { value: "LINK", label: "Referensi website" },
  { value: "YOUTUBE", label: "Video YouTube" },
  { value: "GAME", label: "Game interaktif" },
];

const contentTypeNames = Object.fromEntries(
  materialTypes.map(({ value, label }) => [value, label]),
) as Record<ModuleContentType, string>;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";

function getYouTubeEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    let videoId: string | null = null;
    if (url.hostname === "youtu.be") videoId = url.pathname.slice(1);
    if (["youtube.com", "www.youtube.com"].includes(url.hostname)) {
      if (url.pathname === "/watch") videoId = url.searchParams.get("v");
      if (url.pathname.startsWith("/embed/")) videoId = url.pathname.split("/")[2] ?? null;
      if (url.pathname.startsWith("/shorts/")) videoId = url.pathname.split("/")[2] ?? null;
    }
    return videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)
      ? `https://www.youtube-nocookie.com/embed/${videoId}`
      : null;
  } catch {
    return null;
  }
}

export default function ModulesPage({
  role,
  onNavigate,
  initialClassId,
}: {
  role: UserRole;
  onNavigate?: (section: string) => void;
  initialClassId?: string;
}) {
  const isTeacher = role === "TEACHER";
  const [classes, setClasses] = useState<ModuleClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState(initialClassId ?? "");
  const [modules, setModules] = useState<LearningModule[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [contents, setContents] = useState<ModuleContent[]>([]);
  const [selectedContent, setSelectedContent] = useState<ModuleContent | null>(null);
  const [completedContentIds, setCompletedContentIds] = useState<string[]>([]);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [moduleFormOpen, setModuleFormOpen] = useState(false);
  const [contentFormOpen, setContentFormOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<LearningModule | null>(null);
  const [editingContent, setEditingContent] = useState<ModuleContent | null>(null);
  const selectedModule = modules.find((item) => item.id === selectedModuleId) ?? null;

  const loadModules = useCallback(async (classId: string) => {
    if (!classId) {
      setModules([]);
      setSelectedModuleId("");
      return;
    }
    const path = isTeacher
      ? `/api/classes/${classId}/modules`
      : `/api/learning/classes/${classId}/modules`;
    const result = await apiRequest<{ modules: LearningModule[] }>(path);
    setModules(result.modules);
    setSelectedModuleId((current) =>
      current && result.modules.some((item) => item.id === current)
        ? current
        : (result.modules[0]?.id ?? ""),
    );
  }, [isTeacher]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const endpoint = isTeacher ? "/api/classes" : "/api/learning/classes";
        const result = await apiRequest<{ classes: ModuleClass[] }>(endpoint);
        if (!active) return;
        setClasses(result.classes);
        setSelectedClassId(
          initialClassId && result.classes.some((item) => item.id === initialClassId)
            ? initialClassId
            : result.classes[0]?.id ?? "",
        );
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [initialClassId, isTeacher]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setError("");
      try {
        if (!selectedClassId) {
          setModules([]);
          setSelectedModuleId("");
          return;
        }
        const path = isTeacher
          ? `/api/classes/${selectedClassId}/modules`
          : `/api/learning/classes/${selectedClassId}/modules`;
        const result = await apiRequest<{ modules: LearningModule[] }>(path);
        if (!active) return;
        setModules(result.modules);
        setSelectedModuleId((current) =>
          current && result.modules.some((item) => item.id === current)
            ? current
            : (result.modules[0]?.id ?? ""),
        );
        setContents([]);
        setSelectedContent(null);
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [isTeacher, selectedClassId]);

  const loadStudentContents = useCallback(async (moduleId: string) => {
    const result = await apiRequest<{ contents: ModuleContent[] }>(
      `/api/learning/modules/${moduleId}/contents`,
    );
    setContents(result.contents);
    setCompletedContentIds(result.contents.filter((content) => content.completed).map((content) => content.id));
    setSelectedContent(null);
    setOpenedAt(null);
  }, []);

  useEffect(() => {
    if (isTeacher || !selectedModule?.unlocked) {
      setContents([]);
      setSelectedContent(null);
      setOpenedAt(null);
      return;
    }
    let active = true;
    apiRequest<{ contents: ModuleContent[] }>(
      `/api/learning/modules/${selectedModule.id}/contents`,
    )
      .then(({ contents: result }) => {
        if (active) {
          setContents(result);
          setCompletedContentIds(result.filter((content) => content.completed).map((content) => content.id));
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [isTeacher, selectedModule?.id, selectedModule?.unlocked]);

  useEffect(() => {
    if (isTeacher || !selectedContent || openedAt === null) return;
    const minimumSeconds = selectedContent.durationMinutes
      ? selectedContent.durationMinutes * 60
      : 10;
    const updateRemaining = () => {
      setSecondsRemaining(
        Math.max(0, Math.ceil(minimumSeconds - (Date.now() - openedAt) / 1000)),
      );
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [isTeacher, openedAt, selectedContent]);

  const openModule = async (module: LearningModule) => {
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/learning/modules/${module.id}/open`, { method: "POST" });
      setSelectedModuleId(module.id);
      await loadStudentContents(module.id);
      await loadModules(selectedClassId);
    } catch (openError) {
      setError(errorMessage(openError));
    }
  };

  const openContent = async (moduleId: string, contentId: string) => {
    setError("");
    setSelectedContent(null);
    setOpenedAt(null);
    try {
      const { content } = await apiRequest<{ content: ModuleContent }>(
        `/api/learning/modules/${moduleId}/contents/${contentId}/open`,
        { method: "POST" },
      );
      setSelectedContent(content);
      setOpenedAt(content.startedAt ? Date.parse(content.startedAt) : Date.now());
      if (content.completed) {
        setCompletedContentIds((current) =>
          current.includes(content.id) ? current : [...current, content.id],
        );
      }
    } catch (openError) {
      setError(errorMessage(openError));
    }
  };

  const completeContent = async () => {
    if (!selectedContent) return;
    setError("");
    setIsSaving(true);
    try {
      const result = await apiRequest<{ progress: number; moduleCompleted: boolean }>(
        `/api/learning/contents/${selectedContent.id}/complete`,
        { method: "POST" },
      );
      setCompletedContentIds((current) =>
        current.includes(selectedContent.id) ? current : [...current, selectedContent.id],
      );
      setNotice(
        result.moduleCompleted
          ? "Modul berhasil diselesaikan. Modul berikutnya kini terbuka."
          : `Materi selesai. Progres modul ${result.progress}%.`,
      );
      setSelectedContent(null);
      setOpenedAt(null);
      await loadModules(selectedClassId);
    } catch (completeError) {
      setError(errorMessage(completeError));
    } finally {
      setIsSaving(false);
    }
  };

  const submitModule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawDuration = String(form.get("durationMinutes") ?? "");
    const payload = {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      learningObjectives: String(form.get("learningObjectives") ?? ""),
      durationMinutes: rawDuration ? Number(rawDuration) : null,
      isRequired: form.get("isRequired") === "on",
    };
    setError("");
    setIsSaving(true);
    try {
      const endpoint = editingModule
        ? `/api/modules/${editingModule.id}`
        : `/api/classes/${selectedClassId}/modules`;
      await apiRequest(endpoint, {
        method: editingModule ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setModuleFormOpen(false);
      setEditingModule(null);
      setNotice(editingModule ? "Modul berhasil diperbarui." : "Modul berhasil ditambahkan.");
      await loadModules(selectedClassId);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const submitContent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedModule) return;
    const form = new FormData(event.currentTarget);
    const type = String(form.get("contentType")) as ModuleContentType;
    const title = String(form.get("title") ?? "");
    const description = String(form.get("description") ?? "");
    const duration = form.get("durationMinutes")
      ? Number(form.get("durationMinutes"))
      : null;
    const required = form.get("isRequired") === "on";
    const payload = {
      title,
      description,
      contentType: type,
      body: type === "TEXT" ? String(form.get("body") ?? "") : null,
      externalUrl: type === "TEXT" ? null : String(form.get("externalUrl") ?? ""),
      durationMinutes: duration,
      isRequired: required,
    };
    const file = form.get("file");
    setError("");
    setIsSaving(true);
    try {
      const uploadFile = file instanceof File && file.size > 0;
      const endpoint = uploadFile
        ? editingContent
          ? `/api/contents/${editingContent.id}/upload`
          : `/api/modules/${selectedModule.id}/contents/upload`
        : editingContent
          ? `/api/contents/${editingContent.id}`
          : `/api/modules/${selectedModule.id}/contents`;
      let body: BodyInit;
      let requestEndpoint = endpoint;
      let requestMethod = uploadFile ? (editingContent ? "PUT" : "POST") : editingContent ? "PUT" : "POST";
      if (uploadFile) {
        const uploadUrlEndpoint = editingContent
          ? `/api/contents/${editingContent.id}/upload-url`
          : `/api/modules/${selectedModule.id}/contents/upload-url`;
        const target = await apiRequest<{
          mode: "local" | "direct";
          fileKey?: string;
          uploadUrl?: string;
        }>(uploadUrlEndpoint, {
          method: "POST",
          body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
        });
        if (target.mode === "direct" && target.fileKey && target.uploadUrl) {
          const uploaded = await fetch(target.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!uploaded.ok) throw new Error("File gagal diunggah ke penyimpanan.");
          requestEndpoint = editingContent
            ? `/api/contents/${editingContent.id}/upload-complete`
            : `/api/modules/${selectedModule.id}/contents/upload-complete`;
          requestMethod = editingContent ? "PUT" : "POST";
          body = JSON.stringify({
            fileKey: target.fileKey,
            title,
            description,
            durationMinutes: duration,
            isRequired: required,
          });
        } else {
          const upload = new FormData();
          upload.set("title", title);
          upload.set("description", description);
          upload.set("durationMinutes", duration === null ? "" : String(duration));
          upload.set("isRequired", String(required));
          upload.set("file", file);
          body = upload;
        }
      } else {
        body = JSON.stringify(payload);
      }
      await apiRequest(requestEndpoint, {
        method: requestMethod,
        body,
      });
      setContentFormOpen(false);
      setEditingContent(null);
      setNotice(editingContent ? "Materi berhasil diperbarui." : "Materi berhasil ditambahkan.");
      await loadModules(selectedClassId);
    } catch (saveError) {
      setError(saveError instanceof ApiError && saveError.status === 413
        ? "File melewati batas 4,5 MB Vercel. Pastikan upload langsung ke Supabase Storage tersedia."
        : errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const archiveModule = async (module: LearningModule) => {
    if (!window.confirm(`Nonaktifkan modul "${module.title}"? Riwayat belajar siswa tetap tersimpan.`)) return;
    setError("");
    try {
      await apiRequest(`/api/modules/${module.id}`, { method: "DELETE" });
      setNotice("Modul dinonaktifkan.");
      await loadModules(selectedClassId);
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    }
  };

  const moveModule = async (module: LearningModule, direction: -1 | 1) => {
    const index = modules.findIndex((item) => item.id === module.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= modules.length) return;
    const nextModules = [...modules];
    [nextModules[index], nextModules[target]] = [nextModules[target]!, nextModules[index]!];
    setError("");
    try {
      await apiRequest(`/api/classes/${selectedClassId}/modules/reorder`, {
        method: "POST",
        body: JSON.stringify({ moduleIds: nextModules.map((item) => item.id) }),
      });
      await loadModules(selectedClassId);
      setNotice("Urutan modul berhasil diperbarui.");
    } catch (moveError) {
      setError(errorMessage(moveError));
    }
  };

  const archiveContent = async (content: ModuleContent) => {
    if (!window.confirm(`Nonaktifkan materi "${content.title}"?`)) return;
    setError("");
    try {
      await apiRequest(`/api/contents/${content.id}`, { method: "DELETE" });
      setNotice("Materi dinonaktifkan.");
      await loadModules(selectedClassId);
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    }
  };

  const className = useMemo(
    () => classes.find((item) => item.id === selectedClassId)?.name,
    [classes, selectedClassId],
  );

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat materi pembelajaran...</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-blue-800">{isTeacher ? "Ruang pengelolaan" : "Ruang belajar"}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Materi Pembelajaran</h1>
          <p className="mt-2 text-sm text-slate-500">
            {isTeacher ? "Susun materi dan urutan modul untuk setiap kelas." : "Pelajari modul secara bertahap sesuai urutan kelas."}
          </p>
        </div>
        {isTeacher && selectedClassId && (
          <button
            type="button"
            onClick={() => {
              setEditingModule(null);
              setModuleFormOpen(true);
              setError("");
            }}
            className="w-full rounded-xl bg-[#102a43] px-4 py-3 text-sm font-bold text-white hover:bg-[#183d5d] sm:w-auto"
          >
            + Tambah modul
          </button>
        )}
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {classes.length > 0 && (
        <label className="block max-w-xl">
          <span className="text-sm font-semibold text-slate-700">Pilih kelas</span>
          <select
            value={selectedClassId}
            onChange={(event) => {
              setSelectedClassId(event.target.value);
              setNotice("");
              setError("");
            }}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10"
          >
            {classes.map((learningClass) => (
              <option key={learningClass.id} value={learningClass.id}>
                {learningClass.name} · {learningClass.subject}
              </option>
            ))}
          </select>
        </label>
      )}

      {classes.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-50 text-2xl text-blue-800">▤</div>
          <h2 className="mt-4 font-bold text-slate-900">{isTeacher ? "Buat kelas terlebih dahulu" : "Belum terdaftar di kelas"}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            {isTeacher ? "Tambahkan kelas di menu Manajemen Kelas sebelum menyusun modul." : "Hubungi guru agar didaftarkan ke kelas pembelajaran."}
          </p>
        </section>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Urutan modul</h2>
              <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">{modules.length}</span>
            </div>
            {modules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                {isTeacher ? "Belum ada modul di kelas ini." : "Guru belum menambahkan modul."}
              </div>
            ) : modules.map((module) => (
              <button
                type="button"
                key={module.id}
                disabled={!isTeacher && !module.unlocked}
                onClick={() => {
                  setSelectedModuleId(module.id);
                  setSelectedContent(null);
                  setOpenedAt(null);
                  setError("");
                }}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  selectedModuleId === module.id
                    ? "border-blue-700 bg-blue-50/70 ring-1 ring-blue-700/10"
                    : !isTeacher && !module.unlocked
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 opacity-75"
                      : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold ${
                    isTeacher || module.completed ? "bg-emerald-100 text-emerald-800" :
                      module.unlocked ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-500"
                  }`}>
                    {!isTeacher && !module.unlocked ? "🔒" : module.position}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-slate-900">{module.title}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {module.contents?.length ?? module.requiredCount ?? 0} materi
                      {module.durationMinutes ? ` · ${module.durationMinutes} menit` : ""}
                    </span>
                  </span>
                  {!isTeacher && <StatusBadge status={module.status ?? "LOCKED"} />}
                </div>
                {!isTeacher && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div className={`h-full rounded-full ${module.completed ? "bg-emerald-500" : "bg-blue-700"}`} style={{ width: `${module.progress ?? 0}%` }} />
                    </div>
                    <span className="w-9 text-right text-xs font-bold text-slate-500">{module.progress ?? 0}%</span>
                  </div>
                )}
              </button>
            ))}
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {!selectedModule ? (
              <div className="px-6 py-14 text-center text-sm text-slate-500">
                {isTeacher ? "Pilih modul atau tambahkan modul baru." : "Pilih modul yang terbuka untuk mulai belajar."}
              </div>
            ) : (
              <>
                <div className="border-b border-slate-100 p-5 sm:p-6">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">{className}</span>
                      <h2 className="mt-3 text-xl font-bold text-slate-900">{selectedModule.title}</h2>
                      {selectedModule.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{selectedModule.description}</p>}
                      {selectedModule.learningObjectives && (
                        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                          <span className="font-bold">Tujuan pembelajaran</span>
                          <p className="mt-1 whitespace-pre-wrap leading-6">{selectedModule.learningObjectives}</p>
                        </div>
                      )}
                    </div>
                    {isTeacher && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button type="button" onClick={() => { setEditingModule(selectedModule); setModuleFormOpen(true); setError(""); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Ubah</button>
                        <button type="button" disabled={selectedModule.position === modules[0]?.position} onClick={() => void moveModule(selectedModule, -1)} aria-label="Pindahkan modul ke atas" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">↑</button>
                        <button type="button" disabled={selectedModule.position === modules.at(-1)?.position} onClick={() => void moveModule(selectedModule, 1)} aria-label="Pindahkan modul ke bawah" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">↓</button>
                        <button type="button" onClick={() => { setEditingContent(null); setContentFormOpen(true); setError(""); }} className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-900">+ Materi</button>
                        <button type="button" onClick={() => void archiveModule(selectedModule)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Nonaktifkan</button>
                      </div>
                    )}
                    {!isTeacher && selectedModule.unlocked && (
                      <button type="button" onClick={() => void openModule(selectedModule)} className="shrink-0 rounded-xl bg-[#102a43] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#183d5d]">
                        {selectedModule.status === "COMPLETED" ? "Buka kembali" : "Mulai / lanjutkan"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-5 sm:p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900">Materi modul</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {isTeacher ? "Atur konten yang harus diselesaikan untuk membuka tahap berikutnya." : "Buka dan pelajari setiap materi wajib."}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{isTeacher ? selectedModule.contents?.length ?? 0 : contents.length}</span>
                  </div>

                  {isTeacher ? (
                    <div className="mt-4 space-y-3">
                      {(selectedModule.contents ?? []).length === 0 ? (
                        <EmptyMaterials message="Tambahkan materi pertama pada modul ini." />
                      ) : selectedModule.contents?.map((content) => (
                        <article key={content.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center">
                          <div className="min-w-0">
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{contentTypeNames[content.contentType]}</span>
                            <h4 className="mt-2 font-semibold text-slate-900">{content.title}</h4>
                            {content.description && <p className="mt-1 text-sm text-slate-500">{content.description}</p>}
                            <p className="mt-1 text-xs text-slate-400">{content.isRequired ? "Wajib diselesaikan" : "Opsional"}{content.durationMinutes ? ` · ${content.durationMinutes} menit` : ""}</p>
                            {content.fileUrl && <a href={content.fileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-blue-800 underline">Lihat file</a>}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            {content.contentType !== "GAME" && <button type="button" onClick={() => { setEditingContent(content); setContentFormOpen(true); setError(""); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Ubah</button>}
                            <button type="button" onClick={() => void archiveContent(content)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50">Hapus</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : !selectedModule.unlocked ? (
                    <EmptyMaterials message="Modul ini terkunci. Selesaikan modul sebelumnya untuk membukanya." />
                  ) : contents.length === 0 ? (
                    <EmptyMaterials message="Belum ada materi pada modul ini. Hubungi guru kelas." />
                  ) : (
                    <div className="mt-4 space-y-3">
                      {contents.map((content) => (
                        <button
                          key={content.id}
                          type="button"
                          onClick={() => void openContent(selectedModule.id, content.id)}
                          className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition ${
                            completedContentIds.includes(content.id)
                              ? "border-emerald-200 bg-emerald-50/70"
                              : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/40"
                          }`}
                        >
                          <span className={`grid size-9 shrink-0 place-items-center rounded-xl text-sm ${
                            completedContentIds.includes(content.id) ? "bg-emerald-100 text-emerald-800" : "bg-blue-50 text-blue-800"
                          }`}>{completedContentIds.includes(content.id) ? "✓" : "▤"}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-slate-800">{content.title}</span>
                            <span className="mt-1 block text-xs text-slate-500">{contentTypeNames[content.contentType]}{content.isRequired ? " · Wajib" : " · Opsional"}</span>
                          </span>
                          <span className="text-sm font-semibold text-blue-800">Buka</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {!isTeacher && selectedContent && (
                    <article className="mt-5 rounded-2xl border border-blue-200 bg-blue-50/50 p-4 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-wide text-blue-800">{contentTypeNames[selectedContent.contentType]}</span>
                          <h4 className="mt-1 text-lg font-bold text-slate-900">{selectedContent.title}</h4>
                          {selectedContent.description && <p className="mt-2 text-sm text-slate-600">{selectedContent.description}</p>}
                        </div>
                        <button type="button" onClick={() => { setSelectedContent(null); setOpenedAt(null); }} aria-label="Tutup materi" className="rounded-lg px-2 py-1 text-xl text-slate-500 hover:bg-white">×</button>
                      </div>
                      {selectedContent.contentType === "GAME" ? (
                        <div className="mt-4 rounded-xl bg-white p-5 text-sm text-slate-600">
                          <p>Aktivitas game ini dikerjakan pada menu Games Interaktif.</p>
                          <button type="button" onClick={() => onNavigate?.("Games Interaktif")} className="mt-4 rounded-xl bg-blue-800 px-4 py-2.5 font-semibold text-white hover:bg-blue-900">Buka Games Interaktif</button>
                        </div>
                      ) : selectedContent.contentType === "TEXT" ? (
                        <div className="mt-4 whitespace-pre-wrap rounded-xl bg-white p-4 text-sm leading-7 text-slate-700">{selectedContent.body}</div>
                      ) : selectedContent.contentType === "YOUTUBE" && selectedContent.externalUrl && getYouTubeEmbedUrl(selectedContent.externalUrl) ? (
                        <div className="mt-4 aspect-video overflow-hidden rounded-xl bg-slate-950">
                          <iframe
                            title={selectedContent.title}
                            src={getYouTubeEmbedUrl(selectedContent.externalUrl) ?? ""}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            referrerPolicy="strict-origin-when-cross-origin"
                            allowFullScreen
                            className="size-full"
                          />
                        </div>
                      ) : selectedContent.fileUrl && selectedContent.contentType === "IMAGE" ? (
                        <img src={selectedContent.fileUrl} alt={selectedContent.title} className="mt-4 max-h-[60vh] w-full rounded-xl bg-slate-100 object-contain" />
                      ) : selectedContent.fileUrl && selectedContent.contentType === "VIDEO" ? (
                        <video controls preload="metadata" src={selectedContent.fileUrl} className="mt-4 w-full rounded-xl bg-slate-950" />
                      ) : selectedContent.fileUrl && selectedContent.contentType === "PDF" ? (
                        <iframe title={selectedContent.title} src={selectedContent.fileUrl} className="mt-4 h-[60vh] w-full rounded-xl border border-slate-200 bg-white" />
                      ) : selectedContent.fileUrl ? (
                        <a href={selectedContent.fileUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-xl bg-white px-4 py-3 text-sm font-semibold text-blue-800 underline decoration-blue-200 underline-offset-4">Unduh dokumen</a>
                      ) : selectedContent.externalUrl ? (
                        <a href={selectedContent.externalUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-xl bg-white px-4 py-3 text-sm font-semibold text-blue-800 underline decoration-blue-200 underline-offset-4">
                          Buka materi di tab baru
                        </a>
                      ) : null}
                      {selectedContent.isRequired && selectedContent.contentType !== "GAME" && (
                        selectedContent.completed || completedContentIds.includes(selectedContent.id) ? (
                          <div className="mt-5 border-t border-blue-100 pt-4 text-sm font-semibold text-emerald-800">Materi ini sudah selesai.</div>
                        ) : (
                        <div className="mt-5 flex flex-col justify-between gap-3 border-t border-blue-100 pt-4 sm:flex-row sm:items-center">
                          <p className="text-xs leading-5 text-slate-500">
                            {selectedContent.durationMinutes
                              ? `Pelajari materi minimal ${selectedContent.durationMinutes} menit sebelum menyelesaikan.`
                              : "Pelajari materi minimal 10 detik sebelum menyelesaikan."}
                            {secondsRemaining > 0 && <span className="block font-semibold text-amber-700">Sisa waktu minimum: {secondsRemaining} detik</span>}
                          </p>
                          <button
                            type="button"
                            disabled={isSaving || secondsRemaining > 0}
                            onClick={() => void completeContent()}
                            className="shrink-0 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSaving ? "Menyimpan..." : "Selesaikan materi"}
                          </button>
                        </div>
                        )
                      )}
                    </article>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {moduleFormOpen && isTeacher && (
        <ModuleForm
          initial={editingModule}
          isSaving={isSaving}
          onClose={() => { setModuleFormOpen(false); setEditingModule(null); }}
          onSubmit={submitModule}
        />
      )}
      {contentFormOpen && isTeacher && selectedModule && (
        <ContentForm
          initial={editingContent}
          isSaving={isSaving}
          onClose={() => { setContentFormOpen(false); setEditingContent(null); }}
          onSubmit={submitContent}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = status === "COMPLETED"
    ? "bg-emerald-100 text-emerald-800"
    : status === "IN_PROGRESS"
      ? "bg-blue-100 text-blue-800"
      : status === "LOCKED"
        ? "bg-slate-200 text-slate-600"
        : "bg-amber-100 text-amber-800";
  const label = status === "COMPLETED" ? "Selesai" :
    status === "IN_PROGRESS" ? "Belajar" :
      status === "LOCKED" ? "Terkunci" : "Belum mulai";
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${style}`}>{label}</span>;
}

function EmptyMaterials({ message }: { message: string }) {
  return <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{message}</div>;
}

function ModuleForm({
  initial,
  isSaving,
  onClose,
  onSubmit,
}: {
  initial: LearningModule | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="module-form-title" className="my-auto w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl sm:p-7">
        <h2 id="module-form-title" className="text-xl font-bold text-slate-900">{initial ? "Ubah modul" : "Tambah modul"}</h2>
        <form className="mt-5 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Judul modul</span><input name="title" required minLength={2} maxLength={180} defaultValue={initial?.title ?? ""} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Deskripsi</span><textarea name="description" rows={3} maxLength={5000} defaultValue={initial?.description ?? ""} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Tujuan pembelajaran</span><textarea name="learningObjectives" rows={3} maxLength={5000} defaultValue={initial?.learningObjectives ?? ""} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Estimasi pertemuan (jam pelajaran)</span><input name="durationMinutes" type="number" min={1} max={1440} defaultValue={initial?.durationMinutes ?? ""} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input name="isRequired" type="checkbox" defaultChecked={initial?.isRequired ?? true} className="size-4 accent-blue-800" />Modul wajib diselesaikan</label>
          <FormActions isSaving={isSaving} onClose={onClose} submitText={initial ? "Simpan perubahan" : "Tambah modul"} />
        </form>
      </section>
    </div>
  );
}

function ContentForm({
  initial,
  isSaving,
  onClose,
  onSubmit,
}: {
  initial: ModuleContent | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [type, setType] = useState<ModuleContentType>(initial?.contentType ?? "TEXT");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="content-form-title" className="my-auto w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl sm:p-7">
        <h2 id="content-form-title" className="text-xl font-bold text-slate-900">{initial ? "Ubah materi" : "Tambah materi"}</h2>
        <form className="mt-5 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Judul materi</span><input name="title" required minLength={2} maxLength={180} defaultValue={initial?.title ?? ""} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Jenis materi</span><select name="contentType" value={type} disabled={Boolean(initial?.fileUrl)} onChange={(event) => setType(event.target.value as ModuleContentType)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm disabled:bg-slate-100">{materialTypes.filter((option) => option.value !== "GAME").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Deskripsi <span className="font-normal text-slate-400">(opsional)</span></span><textarea name="description" rows={2} maxLength={5000} defaultValue={initial?.description ?? ""} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          {type === "TEXT" ? (
            <label className="block"><span className="text-sm font-semibold text-slate-700">Isi materi</span><textarea name="body" required rows={7} maxLength={50000} defaultValue={initial?.body ?? ""} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /></label>
          ) : (
            <>
              {["PDF", "DOCX", "IMAGE", "VIDEO"].includes(type) && (
                <label className="block"><span className="text-sm font-semibold text-slate-700">{initial?.fileUrl ? "Pilih pengganti file (maksimal 20 MB)" : "Unggah berkas (maksimal 20 MB)"}</span><input name="file" type="file" required={Boolean(initial?.fileUrl)} accept={type === "PDF" ? ".pdf,application/pdf" : type === "DOCX" ? ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" : type === "IMAGE" ? ".jpg,.jpeg,.png,.gif,.webp,image/jpeg,image/png,image/gif,image/webp" : ".mp4,.webm,video/mp4,video/webm"} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-blue-800" /></label>
              )}
              {!initial?.fileUrl && <label className="block"><span className="text-sm font-semibold text-slate-700">Atau tautan materi (HTTPS)</span><input name="externalUrl" type="url" pattern="https://.+" defaultValue={initial?.externalUrl ?? ""} placeholder={type === "YOUTUBE" ? "https://www.youtube.com/watch?v=..." : "https://..."} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /><span className="mt-1 block text-xs text-slate-400">File yang diunggah disimpan privat di server dan hanya dapat diakses melalui akun yang berwenang.</span></label>}
            </>
          )}
          <label className="block"><span className="text-sm font-semibold text-slate-700">Waktu belajar minimum (menit)</span><input name="durationMinutes" type="number" min={1} max={1440} defaultValue={initial?.durationMinutes ?? ""} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700" /><span className="mt-1 block text-xs text-slate-400">Jika kosong, siswa perlu mempelajari materi minimal 10 detik.</span></label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input name="isRequired" type="checkbox" defaultChecked={initial?.isRequired ?? true} className="size-4 accent-blue-800" />Materi wajib untuk menyelesaikan modul</label>
          <FormActions isSaving={isSaving} onClose={onClose} submitText={initial ? "Simpan perubahan" : "Tambah materi"} />
        </form>
      </section>
    </div>
  );
}

function FormActions({ isSaving, onClose, submitText }: { isSaving: boolean; onClose: () => void; submitText: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
      <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Batal</button>
      <button type="submit" disabled={isSaving} className="rounded-xl bg-[#102a43] px-5 py-3 text-sm font-bold text-white hover:bg-[#183d5d] disabled:opacity-60">{isSaving ? "Menyimpan..." : submitText}</button>
    </div>
  );
}
