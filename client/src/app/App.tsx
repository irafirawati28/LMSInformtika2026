import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  apiRequest,
  type AuthUser,
  type ClassStudent,
  type LearningClass,
  type StudentDashboard as StudentDashboardData,
  type TeacherDashboard as TeacherDashboardData,
  type UserRole,
} from "../lib/api";
import ModulesPage from "../features/modules/ModulesPage";
import GamesPage from "../features/games/GamesPage";
import AssignmentsPage from "../features/assignments/AssignmentsPage";
import AttendancePage from "../features/attendance/AttendancePage";
import GradesPage from "../features/grades/GradesPage";
import ReportsPage from "../features/reports/ReportsPage";
import AnnouncementsPage from "../features/announcements/AnnouncementsPage";
import StudentsPage from "../features/students/StudentsPage";
import ProfilePage from "../features/profile/ProfilePage";
import StudentClassesPage from "../features/classes/StudentClassesPage";

type DashboardData = TeacherDashboardData | StudentDashboardData;

const formatDate = (value: string, options?: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    ...(options ?? {}),
  }).format(new Date(value));

const activityLabels: Record<string, string> = {
  MODULE_OPENED: "membuka materi",
  MODULE_COMPLETED: "menyelesaikan modul",
  ASSIGNMENT_SUBMITTED: "mengumpulkan tugas",
  ASSESSMENT_SUBMITTED: "menyelesaikan asesmen",
  LOGIN: "masuk ke aplikasi",
};

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-400 font-extrabold text-[#102a43]">
        KI
      </div>
      {!compact && (
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">KANAL INFORMATIKA</div>
          <div className="mt-0.5 text-xs text-blue-200">Learning Management System</div>
        </div>
      )}
    </div>
  );
}

function LoginView({
  onLogin,
}: {
  onLogin: (username: string, password: string, role: UserRole) => Promise<void>;
}) {
  const [role, setRole] = useState<UserRole>("STUDENT");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await onLogin(username, password, role);
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : "Login tidak berhasil.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-[#102a43] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="relative z-10 max-w-xl pb-16">
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.2em] text-amber-300">
            Belajar, bertumbuh, berprestasi
          </p>
          <h1 className="text-5xl font-bold leading-tight">
            Satu kanal untuk perjalanan belajarmu.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-blue-100">
            Akses materi, ikuti progres pembelajaran, dan capai tujuan belajar
            langkah demi langkah.
          </p>
        </div>
        <div className="absolute -bottom-28 -right-20 size-96 rounded-full border-[48px] border-white/5" />
        <div className="absolute right-24 top-1/4 size-36 rounded-full bg-blue-400/10 blur-2xl" />
        <p className="relative z-10 text-sm text-blue-200">
          KANAL INFORMATIKA IBU IRA · SMK
        </p>
      </section>

      <section className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <p className="text-sm font-bold uppercase tracking-wider text-blue-800">
            Selamat datang
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Masuk ke akun
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Gunakan NISN untuk siswa atau NIP untuk guru.
          </p>

          <div className="mt-8 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            {(["STUDENT", "TEACHER"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setRole(value);
                  setUsername("");
                  setError("");
                }}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  role === value
                    ? "bg-white text-[#102a43] shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {value === "STUDENT" ? "Siswa" : "Guru"}
              </button>
            ))}
          </div>

          <form className="mt-6 space-y-5" onSubmit={submit}>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">
                {role === "STUDENT" ? "NISN" : "NIP"}
              </span>
              <input
                autoComplete="username"
                inputMode={role === "STUDENT" ? "numeric" : "text"}
                maxLength={32}
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={role === "STUDENT" ? "Masukkan 10 digit NISN" : "Masukkan NIP"}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <input
                autoComplete="current-password"
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Masukkan password"
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10"
              />
            </label>
            {error && <ErrorBanner message={error} />}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-[#102a43] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-[#183d5d] disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? "Memeriksa akun..." : "Masuk"}
            </button>
          </form>
          <p className="mt-6 text-center text-xs leading-5 text-slate-400">
            Siswa menggunakan password awal dari guru dan wajib menggantinya saat
            pertama kali masuk.
          </p>
        </div>
      </section>
    </main>
  );
}

function ChangePasswordView({
  onComplete,
  onLogout,
}: {
  onComplete: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password baru belum sama.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password baru minimal 6 karakter.");
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await onComplete();
    } catch (passwordError) {
      setError(
        passwordError instanceof Error
          ? passwordError.message
          : "Password belum berhasil diperbarui.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
        <div className="grid size-12 place-items-center rounded-2xl bg-amber-100 text-xl text-amber-700">
          !
        </div>
        <p className="mt-7 text-sm font-bold uppercase tracking-wider text-blue-800">
          Langkah keamanan
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          Ganti password awal
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Buat password pribadi minimal 6 karakter sebelum melanjutkan
          pembelajaran.
        </p>
        <form className="mt-7 space-y-4" onSubmit={submit}>
          <PasswordField
            label="Password saat ini"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <PasswordField
            label="Password baru"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />
          <PasswordField
            label="Ulangi password baru"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          {error && <ErrorBanner message={error} />}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-[#102a43] px-4 py-3.5 text-sm font-bold text-white hover:bg-[#183d5d] disabled:opacity-60"
          >
            {isSubmitting ? "Menyimpan..." : "Simpan password baru"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setLogoutError("");
            void onLogout().catch((logoutFailure: unknown) => {
              setLogoutError(
                logoutFailure instanceof Error
                  ? logoutFailure.message
                  : "Tidak dapat keluar dari akun.",
              );
            });
          }}
          className="mt-4 w-full py-2 text-sm font-semibold text-slate-500 hover:text-slate-800"
        >
          Keluar dari akun
        </button>
        {logoutError && <p className="mt-2 text-center text-sm text-red-700">{logoutError}</p>}
      </section>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input
        autoComplete={autoComplete}
        minLength={label === "Password saat ini" ? undefined : 6}
        required
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10"
      />
    </label>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}

function LoadingView() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
        <span className="size-5 animate-spin rounded-full border-2 border-blue-800/20 border-t-blue-800" />
        Memuat KANAL LMS...
      </div>
    </main>
  );
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bootError, setBootError] = useState("");

  const loadSession = useCallback(async () => {
    const result = await apiRequest<{ user: AuthUser }>("/api/auth/me");
    setUser(result.user);
    setBootError("");
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<{ user: AuthUser }>("/api/auth/me")
      .then(({ user: sessionUser }) => {
        if (active) setUser(sessionUser);
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof ApiError && error.status === 401)) {
          setBootError(
            error instanceof Error ? error.message : "Aplikasi gagal dimuat.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = async (username: string, password: string, role: UserRole) => {
    const result = await apiRequest<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    });
    setUser(result.user);
  };

  const logout = async () => {
    await apiRequest("/api/auth/logout", { method: "POST" });
    setUser(null);
  };

  if (isLoading) return <LoadingView />;
  if (bootError) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7">
          <h1 className="text-xl font-bold text-slate-900">Aplikasi belum terhubung</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{bootError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-xl bg-[#102a43] px-4 py-2.5 text-sm font-semibold text-white"
          >
            Coba lagi
          </button>
        </section>
      </main>
    );
  }
  if (!user) return <LoginView onLogin={login} />;
  if (user.mustChangePassword) {
    return <ChangePasswordView onComplete={loadSession} onLogout={logout} />;
  }

  return (
    <DashboardShell
      user={user}
      onLogout={logout}
      onProfileUpdated={(fullName) => setUser((current) => current ? { ...current, fullName } : current)}
      onPasswordChanged={loadSession}
    >
      <DashboardView user={user} />
    </DashboardShell>
  );
}

function DashboardShell({
  user,
  onLogout,
  onProfileUpdated,
  onPasswordChanged,
  children,
}: {
  user: AuthUser;
  onLogout: () => Promise<void>;
  onProfileUpdated: (fullName: string) => void;
  onPasswordChanged: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isTeacher = user.role === "TEACHER";
  const navigation = isTeacher
    ? ["Dashboard", "Data Siswa", "Manajemen Kelas", "Materi Pembelajaran", "Games Interaktif", "Tugas dan Asesmen", "Absensi", "Pengelolaan Nilai", "Laporan", "Pengumuman", "Pengaturan"]
    : ["Dashboard", "Kelas Saya", "Materi Pembelajaran", "Games Interaktif", "Tugas Saya", "Nilai Saya", "Absensi Saya", "Pengumuman", "Profil Saya"];
  const [logoutError, setLogoutError] = useState("");
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [learningClassId, setLearningClassId] = useState("");
  const navigateTo = (section: string, classId?: string) => {
    if (classId) setLearningClassId(classId);
    setActiveSection(section);
    setMobileMenuOpen(false);
  };
  const handleLogout = async () => {
    setLogoutError("");
    try {
      await onLogout();
    } catch (logoutFailure) {
      setLogoutError(
        logoutFailure instanceof Error
          ? logoutFailure.message
          : "Tidak dapat keluar dari akun.",
      );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {mobileMenuOpen && (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[278px] flex-col bg-[#102a43] px-4 py-5 transition-transform lg:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-2">
          <Brand />
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-2 text-blue-100 hover:bg-white/10 lg:hidden"
          >
            ×
          </button>
        </div>
        <div className="mt-9 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-blue-300">
          Menu {isTeacher ? "Guru" : "Siswa"}
        </div>
        <nav className="mt-3 flex-1 space-y-1 overflow-y-auto">
          {navigation.map((item, index) => {
            const enabled =
              index === 0 ||
              (!isTeacher && item === "Kelas Saya") ||
              (isTeacher && item === "Data Siswa") ||
              (isTeacher && item === "Manajemen Kelas") ||
              item === "Materi Pembelajaran" ||
              item === "Games Interaktif" ||
              (isTeacher && item === "Tugas dan Asesmen") ||
              (!isTeacher && item === "Tugas Saya") ||
              (isTeacher && item === "Absensi") ||
              (!isTeacher && item === "Absensi Saya") ||
              (isTeacher && item === "Pengelolaan Nilai") ||
              (isTeacher && item === "Laporan") ||
              (!isTeacher && item === "Nilai Saya") ||
              item === "Pengumuman";
            const profileEnabled =
              (isTeacher && item === "Pengaturan") ||
              (!isTeacher && item === "Profil Saya");
            const active = activeSection === item;
            return (
              <button
                key={item}
                type="button"
                disabled={!enabled && !profileEnabled}
                title={enabled || profileEnabled ? item : "Fitur tersedia pada tahap berikutnya"}
                onClick={() => {
                  if (enabled || profileEnabled) navigateTo(item);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                  active
                    ? "bg-white/10 text-white"
                    : enabled || profileEnabled
                      ? "text-blue-200 hover:bg-white/5"
                      : "cursor-not-allowed text-blue-200/70"
                }`}
              >
                {item}
                {!enabled && !profileEnabled && <span className="ml-auto text-[10px] text-blue-300/70">SEGERA</span>}
              </button>
            );
          })}
        </nav>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs font-semibold text-white">Butuh bantuan?</div>
          <p className="mt-1 text-xs leading-5 text-blue-200">
            Hubungi guru atau administrator sekolah.
          </p>
        </div>
      </aside>

      <div className="lg:pl-[278px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Buka menu"
              onClick={() => setMobileMenuOpen(true)}
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-lg text-slate-700 lg:hidden"
            >
              ☰
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-[#102a43] sm:text-base">
                KANAL INFORMATIKA IBU IRA
              </div>
              <div className="hidden text-xs text-slate-500 sm:block">
                Portal pembelajaran SMK
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-5">
            <div className="hidden text-right sm:block">
              <div className="max-w-44 truncate text-sm font-semibold text-slate-800">
                {user.fullName}
              </div>
              <div className="text-xs text-slate-500">{isTeacher ? "Guru" : "Siswa"} · {user.username}</div>
            </div>
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-900">
              {user.fullName
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase())
                .join("")}
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg px-2 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 sm:px-3"
            >
              Keluar
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 sm:py-9">
          {logoutError && <div className="mb-5"><ErrorBanner message={logoutError} /></div>}
          {activeSection === "Kelas Saya" ? (
            <StudentClassesPage onOpenLearning={(classId) => navigateTo("Materi Pembelajaran", classId)} />
          ) : activeSection === "Data Siswa" ? (
            <StudentsPage />
          ) : activeSection === "Manajemen Kelas" ? (
            <ClassManagementPage />
          ) : activeSection === "Materi Pembelajaran" ? (
            <ModulesPage role={user.role} onNavigate={navigateTo} initialClassId={learningClassId} />
          ) : activeSection === "Games Interaktif" ? (
            <GamesPage role={user.role} />
          ) : activeSection === "Tugas dan Asesmen" || activeSection === "Tugas Saya" ? (
            <AssignmentsPage role={user.role} />
          ) : activeSection === "Absensi" || activeSection === "Absensi Saya" ? (
            <AttendancePage role={user.role} />
          ) : activeSection === "Pengelolaan Nilai" || activeSection === "Nilai Saya" ? (
            <GradesPage role={user.role} />
          ) : activeSection === "Laporan" ? (
            <ReportsPage />
          ) : activeSection === "Pengumuman" ? (
            <AnnouncementsPage role={user.role} />
          ) : activeSection === "Pengaturan" || activeSection === "Profil Saya" ? (
            <ProfilePage
              role={user.role}
              onProfileUpdated={onProfileUpdated}
              onPasswordChanged={onPasswordChanged}
            />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function ClassManagementPage() {
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [studentNisn, setStudentNisn] = useState("");
  const [classFormOpen, setClassFormOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<LearningClass | null>(null);

  const loadClasses = useCallback(async () => {
    const result = await apiRequest<{ classes: LearningClass[] }>("/api/classes");
    setClasses(result.classes);
    setSelectedClassId((selected) =>
      selected && result.classes.some((item) => item.id === selected)
        ? selected
        : (result.classes[0]?.id ?? null),
    );
  }, []);

  const loadStudents = useCallback(async (classId: string) => {
    const result = await apiRequest<{ students: ClassStudent[] }>(
      `/api/classes/${classId}/students`,
    );
    setStudents(result.students);
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<{ classes: LearningClass[] }>("/api/classes")
      .then(({ classes: result }) => {
        if (!active) return;
        setClasses(result);
        setSelectedClassId(result[0]?.id ?? null);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Daftar kelas gagal dimuat.");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedClassId) {
      setStudents([]);
      return;
    }
    let active = true;
    apiRequest<{ students: ClassStudent[] }>(
      `/api/classes/${selectedClassId}/students`,
    )
      .then(({ students: result }) => {
        if (active) setStudents(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Daftar siswa gagal dimuat.");
        }
      });
    return () => {
      active = false;
    };
  }, [selectedClassId]);

  const saveClass = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      subject: String(form.get("subject") ?? ""),
      academicYear: String(form.get("academicYear") ?? ""),
      semester: String(form.get("semester") ?? ""),
      description: String(form.get("description") ?? ""),
    };
    setError("");
    setNotice("");
    setIsSaving(true);
    try {
      const path = editingClass ? `/api/classes/${editingClass.id}` : "/api/classes";
      await apiRequest(path, {
        method: editingClass ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setClassFormOpen(false);
      setEditingClass(null);
      setNotice(editingClass ? "Kelas berhasil diperbarui." : "Kelas berhasil dibuat.");
      await loadClasses();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Kelas tidak dapat disimpan.");
    } finally {
      setIsSaving(false);
    }
  };

  const addStudent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedClassId) return;
    setError("");
    setNotice("");
    setIsSaving(true);
    try {
      await apiRequest(`/api/classes/${selectedClassId}/students`, {
        method: "POST",
        body: JSON.stringify({ nisn: studentNisn }),
      });
      setStudentNisn("");
      setNotice("Siswa berhasil ditambahkan ke kelas.");
      await Promise.all([loadClasses(), loadStudents(selectedClassId)]);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Siswa tidak dapat ditambahkan.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeStudent = async (student: ClassStudent) => {
    if (!selectedClassId) return;
    if (!window.confirm(`Keluarkan ${student.fullName} dari kelas ini? Riwayat belajar tetap tersimpan.`)) {
      return;
    }
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/classes/${selectedClassId}/students/${student.id}`, {
        method: "DELETE",
      });
      setNotice(`${student.fullName} dikeluarkan dari kelas.`);
      await Promise.all([loadClasses(), loadStudents(selectedClassId)]);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Siswa tidak dapat dikeluarkan.");
    }
  };

  const archiveClass = async (learningClass: LearningClass) => {
    if (!window.confirm(`Nonaktifkan kelas "${learningClass.name}"? Data dan riwayat siswa tetap tersimpan.`)) {
      return;
    }
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/classes/${learningClass.id}`, { method: "DELETE" });
      setNotice(`Kelas ${learningClass.name} berhasil dinonaktifkan.`);
      await loadClasses();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Kelas tidak dapat dinonaktifkan.");
    }
  };

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat daftar kelas...</div>;
  }

  const selectedClass = classes.find((item) => item.id === selectedClassId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-blue-800">Ruang pengelolaan</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Manajemen Kelas</h1>
          <p className="mt-2 text-sm text-slate-500">Kelola kelas, mata pelajaran, tahun ajaran, dan siswa.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingClass(null);
            setClassFormOpen(true);
            setError("");
          }}
          className="w-full rounded-xl bg-[#102a43] px-4 py-3 text-sm font-bold text-white hover:bg-[#183d5d] sm:w-auto"
        >
          + Buat kelas
        </button>
      </div>

      {error && !classFormOpen && <ErrorBanner message={error} />}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {classFormOpen && (
        <ClassForm
          initialClass={editingClass}
          errorMessage={error}
          isSaving={isSaving}
          onClose={() => {
            setClassFormOpen(false);
            setEditingClass(null);
          }}
          onSubmit={saveClass}
        />
      )}

      {classes.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-50 text-2xl text-blue-800">▦</div>
          <h2 className="mt-4 font-bold text-slate-900">Belum ada kelas</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Buat kelas pertama untuk mulai mengatur siswa dan kegiatan pembelajaran.</p>
          <button type="button" onClick={() => setClassFormOpen(true)} className="mt-5 rounded-xl bg-[#102a43] px-4 py-2.5 text-sm font-semibold text-white">Buat kelas</button>
        </section>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Daftar kelas</h2>
              <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">{classes.length}</span>
            </div>
            {classes.map((learningClass) => (
              <button
                key={learningClass.id}
                type="button"
                onClick={() => {
                  setSelectedClassId(learningClass.id);
                  setError("");
                }}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  selectedClassId === learningClass.id
                    ? "border-blue-700 bg-blue-50/70 ring-1 ring-blue-700/10"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-bold text-slate-900">{learningClass.name}</h3>
                    <p className="mt-1 truncate text-sm text-blue-800">{learningClass.subject}</p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-semibold text-slate-500">{learningClass.academicYear}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-lg bg-white px-2.5 py-1.5">{learningClass.semester === "ODD" ? "Ganjil" : "Genap"}</span>
                  <span className="rounded-lg bg-white px-2.5 py-1.5">{learningClass.studentCount} siswa</span>
                  <span className="rounded-lg bg-white px-2.5 py-1.5">{learningClass.moduleCount} modul</span>
                </div>
              </button>
            ))}
          </section>

          {selectedClass && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5 sm:p-6">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">{selectedClass.subject}</span>
                    <h2 className="mt-3 text-xl font-bold text-slate-900">{selectedClass.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">{selectedClass.academicYear} · Semester {selectedClass.semester === "ODD" ? "Ganjil" : "Genap"}</p>
                    {selectedClass.description && <p className="mt-3 text-sm leading-6 text-slate-600">{selectedClass.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingClass(selectedClass);
                        setClassFormOpen(true);
                        setError("");
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Ubah
                    </button>
                    <button
                      type="button"
                      onClick={() => void archiveClass(selectedClass)}
                      className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                      Nonaktifkan
                    </button>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniStat label="Siswa" value={selectedClass.studentCount} />
                  <MiniStat label="Modul" value={selectedClass.moduleCount} />
                  <MiniStat label="Tugas" value={selectedClass.assignmentCount} />
                  <MiniStat label="Asesmen" value={selectedClass.assessmentCount} />
                </div>
              </div>

              <div className="p-5 sm:p-6">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                  <div>
                    <h3 className="font-bold text-slate-900">Siswa dalam kelas</h3>
                    <p className="mt-1 text-sm text-slate-500">Tambahkan siswa menggunakan NISN terdaftar.</p>
                  </div>
                  <form onSubmit={addStudent} className="flex w-full gap-2 sm:w-auto">
                    <input
                      aria-label="NISN siswa"
                      autoComplete="off"
                      inputMode="numeric"
                      maxLength={10}
                      minLength={10}
                      pattern="[0-9]{10}"
                      placeholder="10 digit NISN"
                      required
                      value={studentNisn}
                      onChange={(event) => setStudentNisn(event.target.value.replace(/\D/g, "").slice(0, 10))}
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10 sm:w-40 sm:flex-none"
                    />
                    <button type="submit" disabled={isSaving} className="shrink-0 rounded-xl bg-blue-800 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-60">Tambah</button>
                  </form>
                </div>

                {students.length === 0 ? (
                  <EmptyState message="Belum ada siswa yang terdaftar di kelas ini." />
                ) : (
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[620px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <th className="pb-3 pr-4">Siswa</th>
                          <th className="pb-3 pr-4">Progres</th>
                          <th className="pb-3 pr-4">Modul</th>
                          <th className="pb-3 pr-2 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {students.map((student) => (
                          <tr key={student.id}>
                            <td className="py-3 pr-4">
                              <div className="font-semibold text-slate-800">{student.fullName}</div>
                              <div className="mt-0.5 text-xs text-slate-400">NISN {student.nisn}</div>
                            </td>
                            <td className="w-40 py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                                  <div className={`h-full rounded-full ${student.completed ? "bg-emerald-500" : "bg-blue-700"}`} style={{ width: `${student.progress}%` }} />
                                </div>
                                <span className="w-9 text-right text-xs font-bold text-slate-600">{student.progress}%</span>
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-sm text-slate-600">{student.completedModules}/{student.requiredModules}</td>
                            <td className="py-3 text-right">
                              <button type="button" onClick={() => void removeStudent(student)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Keluarkan</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ClassForm({
  initialClass,
  errorMessage,
  isSaving,
  onClose,
  onSubmit,
}: {
  initialClass: LearningClass | null;
  errorMessage: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const currentYear = new Date().getFullYear();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="class-form-title" className="my-auto w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="class-form-title" className="text-xl font-bold text-slate-900">{initialClass ? "Ubah kelas" : "Buat kelas baru"}</h2>
            <p className="mt-1 text-sm text-slate-500">Lengkapi identitas kelas pembelajaran.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup formulir" className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100">×</button>
        </div>
        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          {errorMessage && <ErrorBanner message={errorMessage} />}
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Nama kelas</span>
            <input name="name" required minLength={2} maxLength={120} defaultValue={initialClass?.name ?? ""} placeholder="Contoh: X RPL 1" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Mata pelajaran</span>
            <input name="subject" required minLength={2} maxLength={120} defaultValue={initialClass?.subject ?? ""} placeholder="Contoh: Informatika" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Tahun ajaran</span>
              <input name="academicYear" required pattern="[0-9]{4}-[0-9]{4}" defaultValue={initialClass?.academicYear ?? `${currentYear}-${currentYear + 1}`} placeholder="2026-2027" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10" />
              <span className="mt-1 block text-xs text-slate-400">Format: YYYY-YYYY, contoh 2026-2027</span>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Semester</span>
              <select name="semester" defaultValue={initialClass?.semester ?? "ODD"} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10">
                <option value="ODD">Ganjil</option>
                <option value="EVEN">Genap</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Deskripsi <span className="font-normal text-slate-400">(opsional)</span></span>
            <textarea name="description" rows={3} maxLength={2000} defaultValue={initialClass?.description ?? ""} placeholder="Informasi singkat tentang kelas" className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-700/10" />
          </label>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Batal</button>
            <button type="submit" disabled={isSaving} className="rounded-xl bg-[#102a43] px-5 py-3 text-sm font-bold text-white hover:bg-[#183d5d] disabled:opacity-60">{isSaving ? "Menyimpan..." : initialClass ? "Simpan perubahan" : "Buat kelas"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-3">
      <div className="text-xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function DashboardView({ user }: { user: AuthUser }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiRequest<DashboardData>("/api/dashboard")
      .then((data) => {
        if (active) setDashboard(data);
      })
      .catch((dashboardError: unknown) => {
        if (active) {
          setError(
            dashboardError instanceof Error
              ? dashboardError.message
              : "Dashboard tidak dapat dimuat.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="grid min-h-[55vh] place-items-center text-sm text-slate-500">
        Memuat data dashboard...
      </div>
    );
  }
  if (error || !dashboard) {
    return (
      <section className="rounded-2xl border border-red-200 bg-white p-6">
        <h1 className="font-bold text-slate-900">Dashboard belum dapat dimuat</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {error || "Data dashboard tidak tersedia."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-[#102a43] px-4 py-2 text-sm font-semibold text-white"
        >
          Muat ulang
        </button>
      </section>
    );
  }

  return dashboard.role === "TEACHER" ? (
    <TeacherDashboard user={user} data={dashboard} />
  ) : (
    <StudentDashboard user={user} data={dashboard} />
  );
}

function PageHeading({ user, student = false }: { user: AuthUser; student?: boolean }) {
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 18 ? "Selamat sore" : "Selamat malam";
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-sm font-semibold text-blue-800">
          {student ? "Ruang belajar siswa" : "Ruang kerja guru"}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {greeting}, {user.fullName.split(" ")[0]}!
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {student
            ? "Terus semangat belajar. Satu langkah kecil membawamu lebih dekat ke tujuan."
            : "Berikut ringkasan aktivitas pembelajaran hari ini."}
        </p>
      </div>
      <div className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600">
        {new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: "blue" | "amber" | "green" | "slate";
  icon: string;
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-800",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
        </div>
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-lg font-bold ${colors[tone]}`}>
          {icon}
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-400">{detail}</p>
    </article>
  );
}

function TeacherDashboard({
  user,
  data,
}: {
  user: AuthUser;
  data: TeacherDashboardData;
}) {
  return (
    <div className="space-y-7">
      <PageHeading user={user} />
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        <StatCard label="Total siswa" value={data.summary.students} detail="Siswa aktif di kelas Anda" tone="blue" icon="♧" />
        <StatCard label="Kelas aktif" value={data.summary.classes} detail="Kelas yang sedang berjalan" tone="amber" icon="▦" />
        <StatCard label="Modul pembelajaran" value={data.summary.modules} detail="Materi aktif di semua kelas" tone="green" icon="▤" />
        <StatCard label="Tugas aktif" value={data.summary.assignments} detail="Tugas yang sudah dipublikasikan" tone="slate" icon="✓" />
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Penyelesaian pembelajaran</h2>
              <p className="mt-1 text-sm text-slate-500">Ringkasan status siswa di kelas Anda</p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
              {data.summary.students} siswa
            </span>
          </div>
          <div className="mt-7 space-y-5">
            <ProgressRow
              label="Selesai"
              count={data.summary.completedStudents}
              total={data.summary.completedStudents + data.summary.incompleteStudents}
              tone="bg-emerald-500"
            />
            <ProgressRow
              label="Belum tuntas"
              count={data.summary.incompleteStudents}
              total={data.summary.completedStudents + data.summary.incompleteStudents}
              tone="bg-red-500"
            />
          </div>
          <div className="mt-7 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
            <div className="rounded-xl bg-emerald-50 p-4">
              <div className="text-2xl font-bold text-emerald-700">{data.summary.completedStudents}</div>
              <div className="mt-1 text-xs font-medium text-emerald-800">Selesai 100%</div>
            </div>
            <div className="rounded-xl bg-red-50 p-4">
              <div className="text-2xl font-bold text-red-700">{data.summary.incompleteStudents}</div>
              <div className="mt-1 text-xs font-medium text-red-800">Belum tuntas</div>
            </div>
          </div>
        </article>
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="font-bold text-slate-900">Statistik kehadiran</h2>
            <p className="mt-1 text-sm text-slate-500">Persentase hadir dari catatan absensi</p>
          </div>
          <div className="mt-7 flex items-center gap-5">
            <div
              className="grid size-28 shrink-0 place-items-center rounded-full"
              style={{
                background: `conic-gradient(#2f855a ${data.summary.attendanceRate * 3.6}deg, #e2e8f0 0deg)`,
              }}
            >
              <div className="grid size-[86px] place-items-center rounded-full bg-white text-xl font-bold text-slate-900">
                {data.summary.attendanceRate}%
              </div>
            </div>
            <div className="text-sm leading-6 text-slate-500">
              Kehadiran rata-rata pada seluruh sesi absensi yang tercatat.
            </div>
          </div>
        </article>
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <GradeTrend data={data.gradeTrend} />
        <ActivityList activities={data.recentActivities} />
      </section>
    </div>
  );
}

function ProgressRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: string;
}) {
  const percent = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="font-semibold text-slate-800">{count} <span className="font-normal text-slate-400">· {percent}%</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function GradeTrend({ data }: { data: TeacherDashboardData["gradeTrend"] }) {
  const width = 560;
  const height = 190;
  const padding = 22;
  const points = data.map((item, index) => {
    const x = data.length <= 1 ? width / 2 : padding + (index * (width - padding * 2)) / (data.length - 1);
    const y = height - padding - (Math.min(100, Math.max(0, item.averageScore)) / 100) * (height - padding * 2);
    return { ...item, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const labels = new Intl.DateTimeFormat("id-ID", { month: "short" });

  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Perkembangan nilai</h2>
          <p className="mt-1 text-sm text-slate-500">Rata-rata nilai enam bulan terakhir</p>
        </div>
        <span className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800">Nilai</span>
      </div>
      {points.length === 0 ? (
        <EmptyState message="Belum ada nilai yang dapat ditampilkan." />
      ) : (
        <div className="mt-5">
          <svg
            className="h-[210px] w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Grafik rata-rata nilai enam bulan terakhir"
            preserveAspectRatio="none"
          >
            {[0, 0.5, 1].map((fraction) => {
              const y = padding + fraction * (height - padding * 2);
              return <line key={fraction} x1={padding} x2={width - padding} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 5" />;
            })}
            {points.length > 1 && <polyline points={line} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {points.map((point) => (
              <g key={point.month}>
                <circle cx={point.x} cy={point.y} r="5" fill="#ffffff" stroke="#2563eb" strokeWidth="3" vectorEffect="non-scaling-stroke">
                  <title>{point.averageScore}%</title>
                </circle>
              </g>
            ))}
          </svg>
          <div className="mt-2 flex justify-between text-xs text-slate-400">
            {points.map((point) => (
              <span key={point.month}>
                {labels.format(new Date(`${point.month}-01T00:00:00`))}
                <span className="ml-1 font-semibold text-slate-600">{point.averageScore}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function StudentDashboard({
  user,
  data,
}: {
  user: AuthUser;
  data: StudentDashboardData;
}) {
  return (
    <div className="space-y-7">
      <PageHeading user={user} student />
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        <StatCard label="Kelas diikuti" value={data.summary.classes} detail="Kelas aktif terdaftar" tone="blue" icon="▦" />
        <StatCard label="Progres belajar" value={`${data.summary.progress}%`} detail="Modul, tugas, dan asesmen wajib" tone="green" icon="↗" />
        <StatCard label="Tugas belum dikumpulkan" value={data.summary.outstandingAssignments} detail="Periksa tenggat pengumpulan" tone="amber" icon="!" />
        <StatCard label="Kehadiran" value={`${data.summary.attendanceRate}%`} detail="Dari seluruh catatan absensi" tone="slate" icon="✓" />
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Kelas saya</h2>
              <p className="mt-1 text-sm text-slate-500">Progres modul pembelajaran per kelas</p>
            </div>
            <span className="text-xs font-semibold text-blue-800">{data.classes.length} kelas</span>
          </div>
          {data.classes.length === 0 ? (
            <EmptyState message="Belum ada kelas yang terdaftar untuk akun ini." />
          ) : (
            <div className="mt-5 space-y-3">
              {data.classes.map((learningClass) => (
                <div key={learningClass.id} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-slate-800">{learningClass.name}</h3>
                      <p className="mt-1 truncate text-xs text-slate-500">{learningClass.subject} · {learningClass.teacher}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${learningClass.progress === 100 ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-800"}`}>
                      {learningClass.progress}%
                    </span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${learningClass.progress === 100 ? "bg-emerald-500" : "bg-blue-700"}`} style={{ width: `${learningClass.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="font-bold text-slate-900">Tugas perlu perhatian</h2>
            <p className="mt-1 text-sm text-slate-500">Tenggat pengumpulan terdekat</p>
          </div>
          {data.dueAssignments.length === 0 ? (
            <EmptyState message="Tidak ada tugas belum dikumpulkan." />
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {data.dueAssignments.map((assignment) => {
                const overdue = new Date(assignment.dueAt).getTime() < Date.now();
                return (
                  <div key={assignment.id} className="flex gap-3 py-4 first:pt-1">
                    <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold ${overdue ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
                      !
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-slate-800">{assignment.title}</h3>
                      <p className="mt-1 truncate text-xs text-slate-500">{assignment.className}</p>
                    </div>
                    <span className={`shrink-0 text-right text-xs font-semibold ${overdue ? "text-red-600" : "text-slate-500"}`}>
                      {overdue ? "Terlambat" : formatDate(assignment.dueAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-bold text-slate-900">Nilai terbaru</h2>
          <p className="mt-1 text-sm text-slate-500">Hasil tugas dan asesmen yang sudah dinilai</p>
          {data.latestGrades.length === 0 ? (
            <EmptyState message="Belum ada nilai yang diterbitkan." />
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {data.latestGrades.map((grade) => {
                const percent = grade.maxScore === 0 ? 0 : Math.round((grade.score / grade.maxScore) * 100);
                return (
                  <div key={grade.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800">{grade.title}</div>
                      <div className="mt-1 text-xs text-slate-400">{formatDate(grade.gradedAt, { year: "numeric" })}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-slate-900">{grade.score}<span className="font-normal text-slate-400">/{grade.maxScore}</span></div>
                      <div className="text-xs text-emerald-700">{percent}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>
        <ActivityList activities={data.recentActivities} student />
      </section>
    </div>
  );
}

function ActivityList({
  activities,
  student = false,
}: {
  activities: { id: string; type: string; at: string; name?: string }[];
  student?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="font-bold text-slate-900">
          {student ? "Aktivitas belajar" : "Aktivitas siswa terbaru"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {student ? "Riwayat aktivitas pembelajaran Anda" : "Aktivitas di kelas yang Anda ajar"}
        </p>
      </div>
      {activities.length === 0 ? (
        <EmptyState message="Aktivitas pembelajaran akan muncul di sini." />
      ) : (
        <div className="mt-4 divide-y divide-slate-100">
          {activities.map((activity) => (
            <div key={activity.id} className="flex gap-3 py-3 first:pt-1">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-800">
                {student ? "✓" : (activity.name?.[0] ?? "S").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-5 text-slate-700">
                  {activity.name && <span className="font-semibold">{activity.name} </span>}
                  {activityLabels[activity.type] ?? activity.type.toLowerCase().replaceAll("_", " ")}
                </div>
                <div className="mt-1 text-xs text-slate-400">{formatDate(activity.at, { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

export default App;
