import { LocalProjectRepository, sha256, type LocalObjectStore, type LocalProject } from "@/lib/local-store";

interface StorageGate {
  estimate(): Promise<StorageEstimate>;
  persist(): Promise<boolean>;
}

interface WorkerResult {
  kind: "result";
  text?: string;
  pdf: Uint8Array;
}

interface WorkerFailure { kind: "error"; error: string }

const DB_NAME = "homeworker-local-v1";
const RESERVE_BYTES = 10 * 1024 * 1024;

export async function ensureStorageCapacity(sourceBytes: number, storage: StorageGate = navigator.storage): Promise<boolean> {
  const [{ quota = 0, usage = 0 }, persistent] = await Promise.all([storage.estimate(), storage.persist()]);
  if (quota - usage < sourceBytes * 3 + RESERVE_BYTES) {
    throw new Error("Not enough browser storage space. Export or remove projects, then retry.");
  }
  return persistent;
}

export async function withProjectLock<T>(
  projectId: string,
  operation: () => Promise<T>,
  locks: LockManager | undefined = navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("This browser cannot provide safe exclusive locking for local projects.");
  return locks.request(`homeworker:${projectId}`, { mode: "exclusive" }, operation);
}

export class BrowserOpfsObjectStore implements LocalObjectStore {
  private async directory(digest: string): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    const objects = await root.getDirectoryHandle("objects", { create: true });
    return objects.getDirectoryHandle(digest.slice(0, 2), { create: true });
  }

  async put(digest: string, bytes: Uint8Array): Promise<void> {
    if (await sha256(bytes) !== digest) throw new Error("Object digest does not match its content.");
    const directory = await this.directory(digest);
    const handle = await directory.getFileHandle(digest, { create: true });
    const existing = await handle.getFile();
    if (existing.size > 0) {
      const stored = new Uint8Array(await existing.arrayBuffer());
      if (await sha256(stored) !== digest) throw new Error("Committed local object failed integrity verification.");
      return;
    }
    const writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(new Blob([bytes.slice()]));
    await writable.close();
    const verified = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (verified.length !== bytes.length || await sha256(verified) !== digest) {
      throw new Error("Local object write could not be verified.");
    }
  }

  async get(digest: string): Promise<Uint8Array> {
    const handle = await (await this.directory(digest)).getFileHandle(digest);
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (await sha256(bytes) !== digest) throw new Error("Committed local object failed integrity verification.");
    return bytes;
  }
}

let repository: LocalProjectRepository | undefined;
export function browserRepository(): LocalProjectRepository {
  repository ??= new LocalProjectRepository(DB_NAME, new BrowserOpfsObjectStore());
  return repository;
}

function workerRequest(action: "process" | "render", payload: Uint8Array | string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/local-document.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResult | WorkerFailure | unknown>) => {
      if (!event.data || typeof event.data !== "object" || !("kind" in event.data)) return;
      worker.terminate();
      const response = event.data as WorkerResult | WorkerFailure;
      if (response.kind === "error") reject(new Error(response.error));
      else resolve(response);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The local document worker stopped unexpectedly."));
    };
    if (payload instanceof Uint8Array) {
      const copy = payload.slice();
      worker.postMessage({ action, source: copy }, [copy.buffer]);
    } else {
      worker.postMessage({ action, text: payload });
    }
  });
}

export async function createBrowserProject(file: File): Promise<LocalProject> {
  if (file.type !== "application/pdf") throw new Error("The browser-local preview currently supports PDF files only.");
  await ensureStorageCapacity(file.size);
  const source = new Uint8Array(await file.arrayBuffer());
  return withProjectLock("create", async () => {
    const result = await workerRequest("process", source);
    if (typeof result.text !== "string" || result.text.trim() === "") {
      throw new Error(`The PDF worker returned no text (${Object.keys(result).join(", ") || "empty response"}).`);
    }
    return browserRepository().create({
      filename: file.name,
      mimeType: "application/pdf",
      source,
      text: result.text,
      exportPdf: result.pdf,
    });
  });
}

export async function updateBrowserProject(projectId: string, expectedRevision: number, text: string): Promise<LocalProject> {
  return withProjectLock(projectId, async () => {
    const result = await workerRequest("render", text);
    return browserRepository().updateText(projectId, expectedRevision, text, result.pdf);
  });
}

export async function importBrowserArchive(archive: Uint8Array): Promise<LocalProject> {
  await ensureStorageCapacity(archive.length);
  return withProjectLock("import", () => browserRepository().importArchive(archive));
}
