import { LocalProjectRepository, sha256, type LocalObjectStore, type LocalProject } from "@/lib/local-store";
import { sniffSource } from "@/lib/local-engine";
import { MAX_UPLOAD_BYTES } from "@/lib/validation";

interface StorageGate {
  estimate(): Promise<StorageEstimate>;
  persist(): Promise<boolean>;
}

interface WorkerResult {
  kind: "result";
  requestId: string;
  text?: string;
  pdf: Uint8Array;
}

interface WorkerFailure { kind: "error"; requestId: string; error: string }
interface WorkerProgress { kind: "progress"; requestId: string; completed: number; total: number; text?: string }

interface WorkerRequestOptions {
  timeoutMs?: number;
  createWorker?: () => Worker;
  requestId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number; text?: string }) => void;
  onProcessing?: () => void;
  onFinalizing?: () => void;
  resumeFrom?: number;
  priorPages?: string[];
  repository?: LocalProjectRepository;
  storage?: StorageGate;
  locks?: LockManager;
}

function isWorkerResponse(value: unknown): value is WorkerResult | WorkerFailure {
  if (value === null || typeof value !== "object" || !("kind" in value)) return false;
  if (!("requestId" in value) || typeof value.requestId !== "string") return false;
  if (value.kind === "error") return "error" in value && typeof value.error === "string";
  return value.kind === "result" && "pdf" in value
    && Object.prototype.toString.call(value.pdf) === "[object Uint8Array]";
}

function isWorkerProgress(value: unknown): value is WorkerProgress {
  return value !== null && typeof value === "object"
    && "kind" in value && value.kind === "progress"
    && "requestId" in value && typeof value.requestId === "string"
    && "completed" in value && typeof value.completed === "number" && Number.isInteger(value.completed)
    && "total" in value && typeof value.total === "number" && Number.isInteger(value.total)
    && value.completed >= 0 && value.total > 0 && value.completed <= value.total
    && (!("text" in value) || typeof value.text === "string");
}

const DB_NAME = "homeworker-local-v1";
const RESERVE_BYTES = 10 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 120_000;

export function validateLocalPdfSource(source: Uint8Array): void {
  if (source.length > MAX_UPLOAD_BYTES) throw new Error("This PDF is larger than the 25 MB local limit.");
  const header = new TextDecoder("ascii").decode(source.subarray(0, Math.min(source.length, 1024)));
  if (!/^\s*%PDF-\d\.\d/.test(header)) throw new Error("This file is not a valid PDF.");
}

export function validateLocalSource(source: Uint8Array): "application/pdf" | "image/png" | "image/jpeg" {
  if (source.length > MAX_UPLOAD_BYTES) throw new Error("This file is larger than the 25 MB local limit.");
  return sniffSource(source);
}

export async function ensureStorageCapacity(sourceBytes: number, storage: StorageGate = navigator.storage): Promise<boolean> {
  const { quota = 0, usage = 0 } = await storage.estimate();
  if (quota - usage < sourceBytes * 3 + RESERVE_BYTES) {
    throw new Error("Not enough browser storage space. Export or remove projects, then retry.");
  }
  try {
    return await Promise.race([
      storage.persist(),
      new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(false), 500);
      }),
    ]);
  } catch {
    return false;
  }
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

  async list(): Promise<string[]> {
    const root = await navigator.storage.getDirectory();
    const objects = await root.getDirectoryHandle("objects", { create: true });
    const digests: string[] = [];
    const prefixes = objects as FileSystemDirectoryHandle & {
      values(): AsyncIterableIterator<FileSystemHandle & { values?: () => AsyncIterableIterator<FileSystemHandle> }>;
    };
    for await (const prefix of prefixes.values()) {
      if (prefix.kind !== "directory" || !prefix.values) continue;
      for await (const entry of prefix.values()) {
        if (entry.kind === "file") digests.push(entry.name);
      }
    }
    return digests;
  }

  async delete(digest: string): Promise<void> {
    try {
      await (await this.directory(digest)).removeEntry(digest);
    } catch {
      // already gone
    }
  }
}

let repository: LocalProjectRepository | undefined;
export function browserRepository(): LocalProjectRepository {
  repository ??= new LocalProjectRepository(DB_NAME, new BrowserOpfsObjectStore());
  return repository;
}

export function requestLocalWorker(
  action: "process" | "render",
  payload: Uint8Array | string,
  options: WorkerRequestOptions = {},
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const requestId = options.requestId ?? crypto.randomUUID();
    const createWorker = options.createWorker
      ?? (() => new Worker(new URL("../workers/local-document.worker.ts", import.meta.url), { type: "module" }));
    const worker = createWorker();
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      operation();
    };
    const abort = () => finish(() => reject(new Error("Local document processing was cancelled.")));
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("Local document processing timed out.")));
    }, options.timeoutMs ?? WORKER_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<WorkerResult | WorkerFailure | WorkerProgress | unknown>) => {
      const response = event.data;
      if (response === null || typeof response !== "object" || !("kind" in response)) return;
      if ("requestId" in response && typeof response.requestId === "string" && response.requestId !== requestId) return;
      if (isWorkerProgress(response)) {
        if (response.requestId === requestId) {
          options.onProgress?.({ completed: response.completed, total: response.total });
        }
        return;
      }
      if (!isWorkerResponse(response)) {
        finish(() => reject(new Error("The local document worker returned an invalid response.")));
        return;
      }
      if (response.requestId !== requestId) return;
      if (response.kind === "error") finish(() => reject(new Error(response.error)));
      else finish(() => resolve(response));
    };
    worker.onerror = () => {
      finish(() => reject(new Error("The local document worker stopped unexpectedly.")));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    if (payload instanceof Uint8Array) {
      const copy = payload.slice();
      worker.postMessage({
        action,
        requestId,
        source: copy,
        resumeFrom: options.resumeFrom,
        priorPages: options.priorPages,
      }, [copy.buffer]);
    } else {
      worker.postMessage({ action, requestId, text: payload });
    }
  });
}

export async function createBrowserProject(
  file: File,
  options: Pick<WorkerRequestOptions, "signal" | "onProgress" | "onProcessing" | "onFinalizing" | "createWorker" | "repository" | "storage" | "locks"> = {},
): Promise<LocalProject> {
  const source = new Uint8Array(await file.arrayBuffer());
  const mimeType = validateLocalSource(source);
  await ensureStorageCapacity(source.length, options.storage);
  const repo = options.repository ?? browserRepository();
  return withProjectLock("create", async () => {
    const digest = await sha256(source);
    const checkpoint = await repo.getCheckpoint(digest);
    const pages = checkpoint?.pages.slice() ?? [];
    options.onProcessing?.();
    let text = typeof checkpoint?.text === "string" && checkpoint.text.trim() ? checkpoint.text : undefined;
    let pdf: Uint8Array;
    if (text) {
      const result = await requestLocalWorker("render", text, options);
      pdf = result.pdf;
    } else {
      const writes: Promise<void>[] = [];
      const result = await requestLocalWorker("process", source, {
        ...options,
        resumeFrom: pages.length + 1,
        priorPages: pages,
        onProgress: (progress) => {
          if (typeof progress.text === "string" && progress.text.trim() !== "") {
            pages.push(progress.text);
            writes.push(repo.saveCheckpoint({
              digest,
              filename: file.name,
              mimeType,
              pages: pages.slice(),
              total: progress.total,
              updatedAt: new Date().toISOString(),
            }));
          }
          options.onProgress?.(progress);
        },
      });
      await Promise.all(writes);
      if (typeof result.text !== "string" || result.text.trim() === "") {
        throw new Error(`The local worker returned no text (${Object.keys(result).join(", ") || "empty response"}).`);
      }
      text = result.text;
      pdf = result.pdf;
      await repo.saveCheckpoint({
        digest,
        filename: file.name,
        mimeType,
        pages: pages.length > 0 ? pages : [text],
        total: Math.max(pages.length, 1),
        text,
        updatedAt: new Date().toISOString(),
      });
    }
    if (options.signal?.aborted) throw new Error("Local document processing was cancelled.");
    options.onFinalizing?.();
    const project = await repo.create({ filename: file.name, mimeType, source, text, exportPdf: pdf });
    await repo.deleteCheckpoint(digest);
    await repo.sweepOrphans();
    return project;
  }, options.locks);
}

export async function updateBrowserProject(projectId: string, expectedRevision: number, text: string): Promise<LocalProject> {
  return withProjectLock(projectId, async () => {
    const result = await requestLocalWorker("render", text);
    return browserRepository().updateText(projectId, expectedRevision, text, result.pdf);
  });
}

export async function importBrowserArchive(archive: Uint8Array): Promise<LocalProject> {
  await ensureStorageCapacity(archive.length);
  return withProjectLock("import", () => browserRepository().importArchive(archive));
}
