import { useEffect, useState } from "react";
import { apiRequest, type LearningClass, type UserRole } from "../../lib/api";

type Announcement = {
  id: string;
  classId: string | null;
  className: string | null;
  title: string;
  body: string;
  publishedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  teacherName?: string;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";

const formatDate = (value: string): string =>
  new Date(value).toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });

const toLocalInput = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

export default function AnnouncementsPage({ role }: { role: UserRole }) {
  const isTeacher = role === "TEACHER";
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [classId, setClassId] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAnnouncements = async (active: () => boolean = () => true) => {
    const path = isTeacher ? "/api/announcements" : "/api/learning/announcements";
    const { announcements: items } = await apiRequest<{ announcements: Announcement[] }>(path);
    if (active()) setAnnouncements(items);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (isTeacher) {
          const [{ classes: classItems }, { announcements: items }] = await Promise.all([
            apiRequest<{ classes: LearningClass[] }>("/api/classes"),
            apiRequest<{ announcements: Announcement[] }>("/api/announcements"),
          ]);
          if (active) {
            setClasses(classItems);
            setAnnouncements(items);
          }
        } else {
          await loadAnnouncements(() => active);
        }
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [isTeacher]);

  const resetForm = () => {
    setEditingId(null);
    setTitle("");
    setBody("");
    setClassId("");
    setPublishAt("");
  };

  const save = async (mode: "DRAFT" | "PUBLISH" | "SCHEDULE") => {
    setError("");
    setNotice("");
    if (title.trim().length < 3 || !body.trim()) {
      setError("Isi judul minimal 3 karakter dan isi pengumuman.");
      return;
    }
    if (title.trim().length > 180 || body.trim().length > 10000) {
      setError("Judul maksimal 180 karakter dan isi maksimal 10.000 karakter.");
      return;
    }
    let publishedAt: string | null = null;
    if (mode === "PUBLISH") {
      publishedAt = new Date().toISOString();
    } else if (mode === "SCHEDULE") {
      const scheduledDate = new Date(publishAt);
      if (!publishAt || Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        setError("Pilih waktu terbit di masa mendatang.");
        return;
      }
      publishedAt = scheduledDate.toISOString();
    }
    setIsSaving(true);
    try {
      const payload = JSON.stringify({
        classId: classId || null,
        title,
        body,
        publishedAt,
      });
      if (editingId) {
        await apiRequest(`/api/announcements/${editingId}`, { method: "PUT", body: payload });
      } else {
        await apiRequest("/api/announcements", { method: "POST", body: payload });
      }
      await loadAnnouncements();
      resetForm();
      setNotice(mode === "DRAFT" ? "Draf pengumuman tersimpan." : mode === "SCHEDULE" ? "Pengumuman berhasil dijadwalkan." : "Pengumuman berhasil diterbitkan.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const edit = (item: Announcement) => {
    setEditingId(item.id);
    setTitle(item.title);
    setBody(item.body);
    setClassId(item.classId ?? "");
    setPublishAt(toLocalInput(item.publishedAt));
    setError("");
    setNotice("");
    document.getElementById("announcement-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const archive = async (id: string) => {
    if (!window.confirm("Arsipkan pengumuman ini? Siswa tidak akan dapat melihatnya lagi.")) return;
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/announcements/${id}`, { method: "DELETE" });
      setAnnouncements((items) => items.filter((item) => item.id !== id));
      if (editingId === id) resetForm();
      setNotice("Pengumuman diarsipkan.");
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    }
  };

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat pengumuman...</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-blue-800">{isTeacher ? "Informasi kelas" : "Informasi dari guru"}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Pengumuman</h1>
        <p className="mt-2 text-sm text-slate-500">{isTeacher ? "Buat pengumuman untuk kelas tertentu atau seluruh siswa." : "Pengumuman yang diterbitkan untuk kelasmu akan tampil di sini."}</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {isTeacher && (
        <section id="announcement-form" className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <h2 className="font-bold text-slate-900">{editingId ? "Ubah pengumuman" : "Buat pengumuman"}</h2>
              <p className="mt-1 text-sm text-slate-500">Kosongkan waktu terbit untuk draf. Pengumuman global terlihat oleh semua siswa.</p>
            </div>
            {editingId && <button type="button" onClick={resetForm} className="self-start rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Batal mengubah</button>}
          </div>
          <form onSubmit={(event) => event.preventDefault()} className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">Judul
                <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={180} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" placeholder="Contoh: Jadwal praktik minggu ini" />
              </label>
              <label className="block text-sm font-semibold text-slate-700">Tujuan
                <select value={classId} onChange={(event) => setClassId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal">
                  <option value="">Semua siswa</option>
                  {classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-sm font-semibold text-slate-700">Isi pengumuman
              <textarea value={body} onChange={(event) => setBody(event.target.value)} required maxLength={10000} rows={5} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" placeholder="Tuliskan informasi yang perlu diketahui siswa..." />
              <span className="mt-1 block text-right text-xs font-normal text-slate-400">{body.length}/10.000</span>
            </label>
            <label className="block max-w-sm text-sm font-semibold text-slate-700">Jadwalkan waktu terbit
              <input type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" />
            </label>
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button type="button" disabled={isSaving} onClick={() => void save("DRAFT")} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60">Simpan draf</button>
              {publishAt && <button type="button" disabled={isSaving} onClick={() => void save("SCHEDULE")} className="rounded-xl border border-blue-200 px-4 py-3 text-sm font-semibold text-blue-900 disabled:opacity-60">Jadwalkan</button>}
              <button type="button" disabled={isSaving} onClick={() => void save("PUBLISH")} className="rounded-xl bg-blue-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{isSaving ? "Menyimpan..." : "Terbitkan sekarang"}</button>
            </div>
          </form>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold text-slate-900">{isTeacher ? "Pengumuman yang kamu kelola" : "Pengumuman terbaru"}</h2>
          <span className="text-xs text-slate-500">{announcements.length} pengumuman</span>
        </div>
        {announcements.length === 0 ? (
          <EmptyPanel title={isTeacher ? "Belum ada pengumuman" : "Belum ada pengumuman baru"} text={isTeacher ? "Gunakan formulir di atas untuk membuat draf atau menerbitkan pengumuman." : "Pengumuman dari guru akan muncul setelah diterbitkan."} />
        ) : (
          <div className="space-y-3">
            {announcements.map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                      {isTeacher && <AnnouncementStatus publishedAt={item.publishedAt} />}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.className ?? "Semua siswa"}
                      {item.teacherName ? ` · ${item.teacherName}` : ""}
                      {item.publishedAt ? ` · ${formatDate(item.publishedAt)}` : ` · Diperbarui ${formatDate(item.updatedAt)}`}
                    </p>
                  </div>
                  {isTeacher && (
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => edit(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Ubah</button>
                      <button type="button" onClick={() => void archive(item.id)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Arsipkan</button>
                    </div>
                  )}
                </div>
                <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{item.body}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AnnouncementStatus({ publishedAt }: { publishedAt: string | null }) {
  const isFuture = publishedAt !== null && new Date(publishedAt).getTime() > Date.now();
  const label = publishedAt === null ? "Draf" : isFuture ? "Terjadwal" : "Terbit";
  const style = publishedAt === null ? "bg-slate-100 text-slate-700" : isFuture ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${style}`}>{label}</span>;
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><h2 className="font-bold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{text}</p></section>;
}
