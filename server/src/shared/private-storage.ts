import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { appConfig } from "../config/app-config.js";

export type PrivateStorageArea = "modules" | "assignments" | "imports";

const storageDirectories: Record<PrivateStorageArea, string> = {
  modules: resolve(fileURLToPath(new URL("../../storage/modules/", import.meta.url))),
  assignments: resolve(fileURLToPath(new URL("../../storage/assignments/", import.meta.url))),
  imports: resolve(fileURLToPath(new URL("../../storage/imports/", import.meta.url))),
};
const remotePrefix = "supabase:";
const supabase = appConfig.supabaseUrl && appConfig.supabaseServiceRoleKey
  ? createClient(appConfig.supabaseUrl, appConfig.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

export const isPrivateSupabaseStorageEnabled = (): boolean => supabase !== null;

export const createPrivateFileKey = (
  area: PrivateStorageArea,
  ownerId: string,
  extension: string,
): string => {
  const safeExtension = /^\.[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : "";
  if (!safeExtension || !/^[1-9]\d{0,18}$/.test(ownerId)) {
    throw new Error("Tujuan penyimpanan file tidak valid.");
  }
  return `${remotePrefix}${area}/${ownerId}/${randomUUID()}${safeExtension}`;
};

const objectPathFromKey = (fileKey: string): string | null => {
  if (!fileKey.startsWith(remotePrefix)) return null;
  const objectPath = fileKey.slice(remotePrefix.length);
  if (!objectPath || objectPath.startsWith("/") || objectPath.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  return objectPath;
};

export const createPrivateUploadTarget = async (
  area: PrivateStorageArea,
  ownerId: string,
  extension: string,
): Promise<{ fileKey: string; uploadUrl: string } | null> => {
  if (!supabase) return null;
  const fileKey = createPrivateFileKey(area, ownerId, extension);
  const objectPath = objectPathFromKey(fileKey);
  if (!objectPath) throw new Error("Tujuan unggahan tidak valid.");
  const { data, error } = await supabase.storage
    .from(appConfig.supabaseStorageBucket)
    .createSignedUploadUrl(objectPath);
  if (error || !data?.signedUrl) {
    throw new Error("URL unggah privat tidak dapat dibuat.");
  }
  return { fileKey, uploadUrl: data.signedUrl };
};

export const isPrivateFileOwnedBy = (
  area: PrivateStorageArea,
  ownerId: string,
  fileKey: string,
): boolean => objectPathFromKey(fileKey)?.startsWith(`${area}/${ownerId}/`) === true;

export const readPrivateFile = async (
  area: PrivateStorageArea,
  fileKey: string,
): Promise<Buffer> => {
  const objectPath = objectPathFromKey(fileKey);
  if (fileKey.startsWith(remotePrefix)) {
    if (!objectPath || !supabase || !objectPath.startsWith(`${area}/`)) {
      throw Object.assign(new Error("File tidak ditemukan."), { code: "ENOENT" });
    }
    const { data, error } = await supabase.storage
      .from(appConfig.supabaseStorageBucket)
      .download(objectPath);
    if (error || !data) {
      throw Object.assign(new Error("File tidak ditemukan."), { code: "ENOENT" });
    }
    return Buffer.from(await data.arrayBuffer());
  }

  if (fileKey !== resolve(fileKey).split("/").pop()) {
    throw Object.assign(new Error("File tidak ditemukan."), { code: "ENOENT" });
  }
  const path = resolve(storageDirectories[area], fileKey);
  if (!path.startsWith(`${storageDirectories[area]}/`)) {
    throw Object.assign(new Error("File tidak ditemukan."), { code: "ENOENT" });
  }
  return readFile(path);
};

export const writePrivateFile = async (
  area: PrivateStorageArea,
  fileKey: string,
  contents: Buffer,
  contentType: string,
): Promise<void> => {
  const objectPath = objectPathFromKey(fileKey);
  if (fileKey.startsWith(remotePrefix)) {
    if (!objectPath || !supabase || !objectPath.startsWith(`${area}/`)) {
      throw new Error("Tujuan penyimpanan file tidak valid.");
    }
    const { error } = await supabase.storage
      .from(appConfig.supabaseStorageBucket)
      .upload(objectPath, contents, { contentType, upsert: false });
    if (error) throw new Error("File tidak dapat disimpan di Supabase Storage.");
    return;
  }

  if (fileKey !== resolve(fileKey).split("/").pop()) {
    throw new Error("Nama file tidak valid.");
  }
  const directory = storageDirectories[area];
  const path = resolve(directory, fileKey);
  if (!path.startsWith(`${directory}/`)) throw new Error("Nama file tidak valid.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, contents, { flag: "wx", mode: 0o600 });
};

export const deletePrivateFile = async (
  area: PrivateStorageArea,
  fileKey: string,
): Promise<void> => {
  const objectPath = objectPathFromKey(fileKey);
  if (fileKey.startsWith(remotePrefix)) {
    if (!objectPath || !supabase || !objectPath.startsWith(`${area}/`)) return;
    const { error } = await supabase.storage
      .from(appConfig.supabaseStorageBucket)
      .remove([objectPath]);
    if (error) throw new Error("File tidak dapat dihapus dari Supabase Storage.");
    return;
  }

  if (fileKey !== resolve(fileKey).split("/").pop()) return;
  await unlink(resolve(storageDirectories[area], fileKey));
};

export const createPrivateDownloadUrl = async (
  area: PrivateStorageArea,
  fileKey: string,
  download: string | boolean = false,
): Promise<string | null> => {
  const objectPath = objectPathFromKey(fileKey);
  if (!fileKey.startsWith(remotePrefix)) return null;
  if (!objectPath || !supabase || !objectPath.startsWith(`${area}/`)) return null;
  const { data, error } = await supabase.storage
    .from(appConfig.supabaseStorageBucket)
    .createSignedUrl(objectPath, 60, { download });
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
};