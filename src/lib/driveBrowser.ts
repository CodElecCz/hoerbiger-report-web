import JSZip from "jszip";

const CLIENT_ID = "415993271124-66el8s33kk8duorerfufuf5n4kk7mvn5.apps.googleusercontent.com";
export const ROOT_FOLDER_ID = "1nbAPh_jvKFAItbTfVWMXoSfaHDHOqsnn";
const SCOPES = "https://www.googleapis.com/auth/drive.readonly";

let accessToken: string | null = null;
export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  isFolder: boolean;
}

function ensureGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const scriptUrl = "https://accounts.google.com/gsi/client";
    const existing = document.querySelector(`script[src="${scriptUrl}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google GIS script")));
      return;
    }
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Network blocked loading ${scriptUrl}`));
    document.head.appendChild(script);
  });
}

export async function signInWithGoogle(): Promise<string> {
  await ensureGoogleScript();

  return new Promise((resolve, reject) => {
    const googleObj = (window as any).google;
    if (!googleObj?.accounts?.oauth2) {
      reject(new Error("window.google.accounts.oauth2 is still undefined after script load"));
      return;
    }
    const client = googleObj.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (res: any) => {
        if (res.error) return reject(res);
        accessToken = res.access_token;
        resolve(accessToken!);
      },
    });
    client.requestAccessToken();
  });
}

async function driveGet(url: string): Promise<Response> {
  if (!accessToken) throw new Error("Not signed in");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive API (${res.status}): ${errText}`);
  }
  return res;
}

export async function listFolderContents(folderId: string): Promise<DriveItem[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent("nextPageToken,files(id,name,mimeType,modifiedTime,size)");
  const orderBy = encodeURIComponent("folder,name desc");
  const baseUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=${orderBy}&pageSize=500`;

  const files: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await driveGet(pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl);
    const data = await res.json();
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files.map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    size: f.size,
    isFolder: f.mimeType === "application/vnd.google-apps.folder",
  }));
}

export interface StorageInfo {
  used: number;
  limit: number | null;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const res = await driveGet("https://www.googleapis.com/drive/v3/about?fields=storageQuota");
  const { storageQuota } = await res.json();
  return {
    used: Number(storageQuota?.usage ?? 0),
    limit: storageQuota?.limit ? Number(storageQuota.limit) : null,
  };
}

export async function downloadFile(fileId: string, fileName: string): Promise<void> {
  saveBlob(await fetchFileBlob(fileId), fileName);
}

export async function fetchFileBlob(fileId: string): Promise<Blob> {
  const res = await driveGet(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.blob();
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const ZIP_BATCH_SIZE = 4;
const GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps.";

function uniqueName(name: string, used: Set<string>): string {
  const safe = name.replace(/[\\/]/g, "_");
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

async function collectFiles(
  items: DriveItem[],
  basePath: string,
  files: { id: string; path: string }[],
  skipped: string[],
): Promise<void> {
  const used = new Set<string>();
  for (const item of items) {
    const path = basePath + uniqueName(item.name, used);
    if (item.isFolder) {
      await collectFiles(await listFolderContents(item.id), `${path}/`, files, skipped);
    } else if (item.mimeType.startsWith(GOOGLE_NATIVE_PREFIX)) {
      skipped.push(item.name);
    } else {
      files.push({ id: item.id, path });
    }
  }
}

async function zipItems(
  items: DriveItem[],
  zipName: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  onProgress?.("Scanning folders...");
  const files: { id: string; path: string }[] = [];
  const skipped: string[] = [];
  await collectFiles(items, "", files, skipped);

  const zip = new JSZip();
  let done = 0;
  for (let i = 0; i < files.length; i += ZIP_BATCH_SIZE) {
    onProgress?.(`Zipping ${done}/${files.length} files...`);
    const batch = files.slice(i, i + ZIP_BATCH_SIZE);
    const blobs = await Promise.all(batch.map((f) => fetchFileBlob(f.id)));
    batch.forEach((f, idx) => zip.file(f.path, blobs[idx]));
    done += batch.length;
  }

  onProgress?.(`Zipping ${done}/${files.length} files... compressing`);
  const blob = await zip.generateAsync({ type: "blob" });
  saveBlob(blob, `${zipName}.zip`);
  onProgress?.(
    `Downloaded ${zipName}.zip` + (skipped.length ? ` (skipped ${skipped.length} Google Docs file(s))` : ""),
  );
}

export async function downloadFolderAsZip(
  folderId: string,
  folderName: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  onProgress?.("Scanning folders...");
  await zipItems(await listFolderContents(folderId), folderName, onProgress);
}

export async function downloadItemsAsZip(
  items: DriveItem[],
  zipName: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  await zipItems(items, zipName, onProgress);
}

export async function readFileText(fileId: string): Promise<string> {
  const res = await driveGet(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return await res.text();
}