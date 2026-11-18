const CLIENT_ID = "415993271124-66el8s33kk8duorerfufuf5n4kk7mvn5.apps.googleusercontent.com";
export const ROOT_FOLDER_ID = "1nbAPh_jvKFAItbTfVWMXoSfaHDHOqsnn";
const SCOPES = "https://googleapis.com";

let accessToken: string | null = null;

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  isFolder: boolean;
}

export function signInWithGoogle(): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
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

/** List all folders and files directly inside a given folder ID */
export async function listFolderContents(folderId: string): Promise<DriveItem[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,size)");
  const orderBy = encodeURIComponent("folder,name desc");
  const url = `https://googleapis.com{q}&fields=${fields}&orderBy=${orderBy}&pageSize=500`;

  const res = await driveGet(url);
  const data = await res.json();

  return (data.files ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    size: f.size,
    isFolder: f.mimeType === "application/vnd.google-apps.folder",
  }));
}

/** Download text content of a selected file */
export async function readFileText(fileId: string): Promise<string> {
  const res = await driveGet(`https://googleapis.com{fileId}?alt=media`);
  return await res.text();
}
