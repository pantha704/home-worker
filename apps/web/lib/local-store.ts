import { sniffSource } from "@/lib/local-engine";
import { MAX_ARCHIVE_BYTES, MAX_UPLOAD_BYTES } from "@/lib/validation";

export interface LocalObjectStore {
  put(digest: string, bytes: Uint8Array): Promise<void>;
  get(digest: string): Promise<Uint8Array>;
  list?(): Promise<string[]>;
  delete?(digest: string): Promise<void>;
}

interface ProjectRow {
  id: string;
  filename: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  sourceDigest: string;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

interface RevisionRow {
  key: string;
  projectId: string;
  revision: number;
  text: string;
  exportDigest: string;
}

export interface LocalProject {
  id: string;
  filename: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  revision: number;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateInput {
  filename: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  source: Uint8Array;
  text: string;
  exportPdf: Uint8Array;
}

export class LocalRevisionConflictError extends Error {}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Local transaction aborted"));
  });
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export const EXTRACTION_VERSION = 1;
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ARCHIVE_TEXT_CHARS = 1_000_000;
export const MAX_FILENAME_CHARS = 255;

export interface LocalCheckpoint {
  digest: string;
  filename: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  pages: string[];
  total: number;
  text?: string;
  extractionVersion?: number;
  updatedAt: string;
}

export class LocalProjectRepository {
  private readonly inflight = new Set<string>();

  constructor(private readonly dbName: string, private readonly objects: LocalObjectStore) {}

  private async database(): Promise<IDBDatabase> {
    const opening = indexedDB.open(this.dbName, 2);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains("projects")) database.createObjectStore("projects", { keyPath: "id" });
      if (!database.objectStoreNames.contains("revisions")) database.createObjectStore("revisions", { keyPath: "key" });
      if (!database.objectStoreNames.contains("checkpoints")) database.createObjectStore("checkpoints", { keyPath: "digest" });
    };
    return request(opening);
  }

  async create(input: CreateInput): Promise<LocalProject> {
    const [sourceDigest, exportDigest] = await Promise.all([sha256(input.source), sha256(input.exportPdf)]);
    this.inflight.add(sourceDigest);
    this.inflight.add(exportDigest);
    try {
      await Promise.all([
        this.objects.put(sourceDigest, input.source),
        this.objects.put(exportDigest, input.exportPdf),
      ]);
      const id = `local_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const project: ProjectRow = {
        id,
        filename: input.filename,
        mimeType: input.mimeType,
        sourceDigest,
        currentRevision: 1,
        createdAt: now,
        updatedAt: now,
      };
      const revision: RevisionRow = { key: `${id}:1`, projectId: id, revision: 1, text: input.text, exportDigest };
      const database = await this.database();
      const transaction = database.transaction(["projects", "revisions"], "readwrite");
      transaction.objectStore("projects").add(project);
      transaction.objectStore("revisions").add(revision);
      await complete(transaction);
      database.close();
      return this.view(project, revision);
    } finally {
      this.inflight.delete(sourceDigest);
      this.inflight.delete(exportDigest);
    }
  }

  async get(id: string): Promise<LocalProject> {
    const database = await this.database();
    const transaction = database.transaction(["projects", "revisions"], "readonly");
    const project = await request(transaction.objectStore("projects").get(id)) as ProjectRow | undefined;
    if (!project) throw new Error("Local project not found");
    const revision = await request(transaction.objectStore("revisions").get(`${id}:${project.currentRevision}`)) as RevisionRow | undefined;
    if (!revision) throw new Error("Local project revision is missing");
    await complete(transaction);
    database.close();
    return this.view(project, revision);
  }

  async readSource(id: string): Promise<Uint8Array> {
    const database = await this.database();
    const transaction = database.transaction("projects", "readonly");
    const project = await request(transaction.objectStore("projects").get(id)) as ProjectRow | undefined;
    await complete(transaction);
    database.close();
    if (!project) throw new Error("Local project not found");
    return this.objects.get(project.sourceDigest);
  }

  async readExport(id: string): Promise<Uint8Array> {
    const database = await this.database();
    const transaction = database.transaction(["projects", "revisions"], "readonly");
    const project = await request(transaction.objectStore("projects").get(id)) as ProjectRow | undefined;
    if (!project) throw new Error("Local project not found");
    const revision = await request(transaction.objectStore("revisions").get(`${id}:${project.currentRevision}`)) as RevisionRow;
    await complete(transaction);
    database.close();
    return this.objects.get(revision.exportDigest);
  }

  async updateText(id: string, expectedRevision: number, text: string, exportPdf: Uint8Array): Promise<LocalProject> {
    const exportDigest = await sha256(exportPdf);
    this.inflight.add(exportDigest);
    try {
      await this.objects.put(exportDigest, exportPdf);
      const database = await this.database();
      const transaction = database.transaction(["projects", "revisions"], "readwrite");
      const projects = transaction.objectStore("projects");
      const project = await request(projects.get(id)) as ProjectRow | undefined;
      if (!project) throw new Error("Local project not found");
      if (project.currentRevision !== expectedRevision) {
        transaction.abort();
        database.close();
        throw new LocalRevisionConflictError("This project changed in another tab.");
      }
      const revision: RevisionRow = {
        key: `${id}:${expectedRevision + 1}`,
        projectId: id,
        revision: expectedRevision + 1,
        text,
        exportDigest,
      };
      project.currentRevision = revision.revision;
      project.updatedAt = new Date().toISOString();
      transaction.objectStore("revisions").add(revision);
      projects.put(project);
      await complete(transaction);
      database.close();
      return this.view(project, revision);
    } finally {
      this.inflight.delete(exportDigest);
    }
  }

  async exportArchive(id: string): Promise<Uint8Array> {
    const project = await this.get(id);
    const [source, rendered] = await Promise.all([this.readSource(id), this.readExport(id)]);
    const archive = {
      format: "homeworker-project",
      version: 1,
      project: { filename: project.filename, mimeType: project.mimeType, text: project.text },
      objects: {
        source: { digest: await sha256(source), data: encode(source) },
        rendered: { digest: await sha256(rendered), data: encode(rendered) },
      },
    };
    return new TextEncoder().encode(JSON.stringify(archive));
  }

  async importArchive(bytes: Uint8Array): Promise<LocalProject> {
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error("This backup is larger than the local restore limit.");
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as {
      format?: string;
      version?: number;
      project?: { filename?: string; mimeType?: string; text?: string };
      objects?: { source?: { digest?: string; data?: string }; rendered?: { digest?: string; data?: string } };
    };
    if (value.format !== "homeworker-project" || value.version !== 1) {
      throw new Error("Unsupported Homeworker archive");
    }
    const project = value.project;
    const mimeType = project?.mimeType;
    if (!project || (mimeType !== "application/pdf" && mimeType !== "image/png" && mimeType !== "image/jpeg")) {
      throw new Error("Unsupported Homeworker archive");
    }
    if (typeof project.filename !== "string" || project.filename.length === 0 || project.filename.length > MAX_FILENAME_CHARS) {
      throw new Error("Incomplete Homeworker archive");
    }
    if (typeof project.text !== "string" || project.text.length > MAX_ARCHIVE_TEXT_CHARS) {
      throw new Error("Incomplete Homeworker archive");
    }
    if (typeof value.objects?.source?.data !== "string" || typeof value.objects.rendered?.data !== "string") {
      throw new Error("Incomplete Homeworker archive");
    }
    if (typeof value.objects.source.digest !== "string" || typeof value.objects.rendered.digest !== "string") {
      throw new Error("Incomplete Homeworker archive");
    }
    const source = decode(value.objects.source.data);
    const rendered = decode(value.objects.rendered.data);
    if (source.byteLength > MAX_UPLOAD_BYTES || rendered.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error("This backup is larger than the local restore limit.");
    }
    if (await sha256(source) !== value.objects.source.digest || await sha256(rendered) !== value.objects.rendered.digest) {
      throw new Error("Homeworker archive integrity check failed");
    }
    const actualType = sniffSource(source);
    if (actualType !== mimeType) {
      throw new Error("Homeworker archive source type does not match its contents.");
    }
    return this.create({ filename: project.filename, mimeType, source, text: project.text, exportPdf: rendered });
  }

  async delete(id: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(["projects", "revisions", "checkpoints"], "readwrite");
    const project = (await request(transaction.objectStore("projects").get(id))) as ProjectRow | undefined;
    if (!project) {
      transaction.abort();
      database.close();
      throw new Error("Local project not found");
    }
    const revisions = (await request(transaction.objectStore("revisions").getAll())) as RevisionRow[];
    for (const revision of revisions) {
      if (revision.projectId === id) {
        transaction.objectStore("revisions").delete(revision.key);
      }
    }
    transaction.objectStore("projects").delete(id);
    transaction.objectStore("checkpoints").delete(project.sourceDigest);
    await complete(transaction);
    database.close();
    await this.sweepOrphans();
  }

  async getCheckpoint(digest: string): Promise<LocalCheckpoint | undefined> {
    const database = await this.database();
    const transaction = database.transaction("checkpoints", "readonly");
    const value = await request(transaction.objectStore("checkpoints").get(digest)) as LocalCheckpoint | undefined;
    await complete(transaction);
    database.close();
    if (!value) return undefined;
    const age = Date.now() - Date.parse(value.updatedAt);
    if (value.extractionVersion !== EXTRACTION_VERSION || !Number.isFinite(age) || age > CHECKPOINT_TTL_MS) {
      await this.deleteCheckpoint(digest);
      return undefined;
    }
    return value;
  }

  async saveCheckpoint(checkpoint: LocalCheckpoint): Promise<void> {
    if (!Array.isArray(checkpoint.pages) || checkpoint.total < 1 || checkpoint.pages.length > checkpoint.total) {
      throw new Error("Invalid processing checkpoint");
    }
    const database = await this.database();
    const transaction = database.transaction("checkpoints", "readwrite");
    transaction.objectStore("checkpoints").put(checkpoint);
    await complete(transaction);
    database.close();
  }

  async deleteCheckpoint(digest: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("checkpoints", "readwrite");
    transaction.objectStore("checkpoints").delete(digest);
    await complete(transaction);
    database.close();
  }

  async sweepOrphans(): Promise<number> {
    if (!this.objects.list || !this.objects.delete) return 0;
    const database = await this.database();
    const transaction = database.transaction(["projects", "revisions"], "readonly");
    const projects = await request(transaction.objectStore("projects").getAll()) as ProjectRow[];
    const revisions = await request(transaction.objectStore("revisions").getAll()) as RevisionRow[];
    await complete(transaction);
    database.close();
    const live = new Set<string>(this.inflight);
    for (const project of projects) live.add(project.sourceDigest);
    for (const revision of revisions) live.add(revision.exportDigest);
    let removed = 0;
    for (const digest of await this.objects.list()) {
      if (!live.has(digest)) {
        await this.objects.delete(digest);
        removed += 1;
      }
    }
    return removed;
  }

  private view(project: ProjectRow, revision: RevisionRow): LocalProject {
    return {
      id: project.id,
      filename: project.filename,
      mimeType: project.mimeType,
      revision: revision.revision,
      text: revision.text,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }
}

export function backupDownloadName(filename: string): string {
  return `${filename.replace(/\.(pdf|png|jpe?g|homeworker)$/i, "")}.homeworker`;
}

export function reviewedPdfDownloadName(filename: string): string {
  return `${filename.replace(/\.(pdf|png|jpe?g)$/i, "")}-reviewed.pdf`;
}
