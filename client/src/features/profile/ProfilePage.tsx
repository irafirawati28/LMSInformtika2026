import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type UserRole } from "../../lib/api";

type UserProfile = {
  role: UserRole;
  username: string;
  identifier: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  schoolClass: string | null;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Permintaan tidak dapat diproses.";

export default function ProfilePage({
  role,
  onProfileUpdated,
  onPasswordChanged,
}: {
  role: UserRole;
  onProfileUpdated: (fullName: string) => void;
  onPasswordChanged: () => Promise<void>;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<{ profile: UserProfile }>("/api/auth/profile")
      .then(({ profile: userProfile }) => {
        if (!active) return;
        setProfile(userProfile);
        setFullName(userProfile.fullName);
        setEmail(userProfile.email ?? "");
        setPhone(userProfile.phone ?? "");
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSavingProfile(true);
    try {
      await apiRequest("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify({
          fullName,
          email: email.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      setProfile((current) => current ? { ...current, fullName: fullName.trim(), email: email.trim() || null, phone: phone.trim() || null } : current);
      onProfileUpdated(fullName.trim());
      setNotice("Profil berhasil diperbarui.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordNotice("");
    if (newPassword.length < 6) {
      setPasswordError("Password baru minimal 6 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Konfirmasi password baru belum sama.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Password baru harus berbeda dari password saat ini.");
      return;
    }
    setIsSavingPassword(true);
    try {
      await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice("Password berhasil diperbarui.");
      await onPasswordChanged();
    } catch (saveError) {
      setPasswordError(errorMessage(saveError));
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-slate-500">Memuat profil...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="text-sm font-semibold text-blue-800">{role === "TEACHER" ? "Pengaturan akun guru" : "Identitas pembelajaran"}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{role === "TEACHER" ? "Pengaturan Profil" : "Profil Saya"}</h1>
        <p className="mt-2 text-sm text-slate-500">Kelola informasi profil dan keamanan akunmu.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {profile && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-4 border-b border-slate-100 pb-5">
            <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-blue-100 text-lg font-bold text-blue-900">
              {profile.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-bold text-slate-900">{profile.fullName}</h2>
              <p className="mt-1 text-sm text-slate-500">{role === "TEACHER" ? "Guru" : "Siswa"} · {role === "TEACHER" ? "NIP" : "NISN"} {profile.identifier}</p>
            </div>
          </div>

          <form onSubmit={(event) => void saveProfile(event)} className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <ReadOnlyField label={role === "TEACHER" ? "NIP (ID login)" : "NISN (ID login)"} value={profile.identifier} />
              <ReadOnlyField label="Nama pengguna" value={profile.username} />
              {role === "STUDENT" && <ReadOnlyField label="Kelas sekolah" value={profile.schoolClass || "Belum diisi"} />}
              <label className="block text-sm font-semibold text-slate-700">Nama lengkap
                <input required minLength={2} maxLength={150} value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" autoComplete="name" />
              </label>
              <label className="block text-sm font-semibold text-slate-700">Email <span className="font-normal text-slate-400">(opsional)</span>
                <input type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" autoComplete="email" placeholder="nama@contoh.id" />
              </label>
              <label className="block text-sm font-semibold text-slate-700">Nomor telepon <span className="font-normal text-slate-400">(opsional)</span>
                <input type="tel" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" autoComplete="tel" placeholder="+62..." />
              </label>
            </div>
            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button type="submit" disabled={isSavingProfile} className="w-full rounded-xl bg-blue-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-60 sm:w-auto">{isSavingProfile ? "Menyimpan..." : "Simpan profil"}</button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div>
          <h2 className="font-bold text-slate-900">Ubah password</h2>
          <p className="mt-1 text-sm text-slate-500">Gunakan password minimal 6 karakter yang berbeda dari password saat ini.</p>
        </div>
        {passwordError && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{passwordError}</div>}
        {passwordNotice && <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{passwordNotice}</div>}
        <form onSubmit={(event) => void savePassword(event)} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField label="Password saat ini" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            <span className="hidden sm:block" />
            <PasswordField label="Password baru" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
            <PasswordField label="Ulangi password baru" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          </div>
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <button type="submit" disabled={isSavingPassword} className="w-full rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-900 disabled:opacity-60 sm:w-auto">{isSavingPassword ? "Memperbarui..." : "Ubah password"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm font-semibold text-slate-700">
      <span>{label}</span>
      <div className="mt-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 font-normal text-slate-600">{value}</div>
    </div>
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
    <label className="block text-sm font-semibold text-slate-700">{label}
      <input required type="password" minLength={label === "Password saat ini" ? undefined : 6} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" />
    </label>
  );
}
