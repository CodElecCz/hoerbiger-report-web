import JSZip from "jszip";

const WORKER_URL = "https://hoerbiger-reports-api.codelec.workers.dev";
const PASSWORD_KEY = "hoerbiger_pwd";
const LEGACY_CREDENTIALS_KEY = "hoerbiger-r2-credentials";

export interface R2Item {
  key: string;
  name: string;
  isFolder: boolean;
  modifiedTime?: Date;
  size?: number;
}

interface WorkerFile {
  key: string;
  size: number;
  uploaded: string;
}

interface WorkerListing {
  folders: string[];
  files: WorkerFile[];
}

function isWorkerFile(file: unknown): file is WorkerFile {
  return typeof file === "object" && file !== null &&
    "key" in file && typeof file.key === "string" &&
    "size" in file && typeof file.size === "number" &&
    "uploaded" in file && typeof file.uploaded === "string" && !Number.isNaN(Date.parse(file.uploaded));
}

export function getSavedPassword(): string | null {
  localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
  return localStorage.getItem(PASSWORD_KEY);
}

export async function loginWithPassword(password: string): Promise<void> {
  const response = await fetch(`${WORKER_URL}?action=list&prefix=`, {
    headers: { Authorization: `Bearer ${password}` },
  });
  if (!response.ok) throw new Error("Invalid password");
  localStorage.setItem(PASSWORD_KEY, password);
  localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
}

export function logout(): void {
  localStorage.removeItem(PASSWORD_KEY);
  localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
}

async function workerGet(query: string): Promise<Response> {
  const password = localStorage.getItem(PASSWORD_KEY);
  if (password === null) throw new Error("Not logged in");
  const response = await fetch(`${WORKER_URL}?${query}`, {
    headers: { Authorization: `Bearer ${password}` },
  });
  if (response.status === 401) logout();
  if (!response.ok) throw new Error(`Worker request failed (${response.status})`);
  return response;
}

async function listObjects(prefix: string, recursive = false): Promise<WorkerListing> {
  const query = `action=list&${recursive ? "recursive=true&" : ""}prefix=${encodeURIComponent(prefix)}`;
  const data: unknown = await (await workerGet(query)).json();
  if (
    typeof data !== "object" || data === null ||
    !("folders" in data) || !Array.isArray(data.folders) ||
    !data.folders.every((folder: unknown): folder is string => typeof folder === "string" && folder.startsWith(prefix)) ||
    !("files" in data) || !Array.isArray(data.files) ||
    !data.files.every(isWorkerFile) || !data.files.every((file) => file.key.startsWith(prefix))
  ) throw new Error("Invalid folder listing from Worker");
  return { folders: data.folders, files: data.files };
}

export async function listFolderContents(prefix: string): Promise<R2Item[]> {
  const { files, folders } = await listObjects(prefix);
  return [
    ...folders.map((key) => ({ key, name: key.slice(prefix.length).replace(/\/$/, ""), isFolder: true })),
    ...files.filter((file) => file.key !== prefix).map((file) => ({
      key: file.key,
      name: file.key.slice(prefix.length),
      isFolder: false,
      modifiedTime: new Date(file.uploaded),
      size: file.size,
    })),
  ];
}

async function fetchFileBytes(key: string): Promise<Uint8Array> {
  const response = await workerGet(`action=get&key=${encodeURIComponent(key)}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function readFileText(key: string): Promise<string> {
  return (await workerGet(`action=get&key=${encodeURIComponent(key)}`)).text();
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadFile(key: string, fileName: string): Promise<void> {
  const bytes = await fetchFileBytes(key);
  saveBlob(new Blob([new Uint8Array(bytes)]), fileName);
}

function safeZipPath(path: string): string {
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\\") ||
      path.includes("//") ||
      path.split("/").some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error(`Cannot safely add object to ZIP: ${path}`);
  }
  return path;
}

async function zipItems(items: R2Item[], zipName: string, onProgress?: (msg: string) => void): Promise<void> {
  onProgress?.("Scanning folders...");
  const zip = new JSZip();
  const files: { key: string; path: string }[] = [];
  for (const item of items) {
    if (item.isFolder) {
      const base = safeZipPath(`${item.name}/`);
      zip.folder(base);
      const { files: objects } = await listObjects(item.key, true);
      for (const obj of objects) {
        if (obj.key === item.key) continue;
        const path = safeZipPath(base + obj.key.slice(item.key.length));
        if (obj.key.endsWith("/")) zip.folder(path);
        else files.push({ key: obj.key, path });
      }
    } else {
      files.push({ key: item.key, path: safeZipPath(item.name) });
    }
  }
  for (let i = 0; i < files.length; i += 10) {
    onProgress?.(`Zipping ${i}/${files.length} files...`);
    const batch = files.slice(i, i + 10);
    const data = await Promise.all(batch.map((file) => fetchFileBytes(file.key)));
    batch.forEach((file, index) => zip.file(file.path, data[index]));
  }
  onProgress?.(`Zipping ${files.length}/${files.length} files... compressing`);
  saveBlob(await zip.generateAsync({ type: "blob" }), `${zipName}.zip`);
  onProgress?.(`Downloaded ${zipName}.zip`);
}

export async function downloadFolderAsZip(
  prefix: string, folderName: string, onProgress?: (msg: string) => void,
): Promise<void> {
  await zipItems([{ key: prefix, name: folderName, isFolder: true }], folderName, onProgress);
}

export async function downloadItemsAsZip(
  items: R2Item[], zipName: string, onProgress?: (msg: string) => void,
): Promise<void> {
  await zipItems(items, zipName, onProgress);
}

