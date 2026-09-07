import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import {
  LocalProjectRepository,
  LocalRevisionConflictError,
  backupDownloadName,
  reviewedPdfDownloadName,
  type LocalObjectStore,
} from "@/lib/local-store";

class MemoryObjects implements LocalObjectStore {
  readonly values = new Map<string, Uint8Array>();
  async put(digest: string, bytes: Uint8Array) {
    const existing = this.values.get(digest);
    if (existing && existing.toString() !== bytes.toString()) throw new Error("digest collision");
    this.values.set(digest, bytes.slice());
  }
  async get(digest: string) {
    const value = this.values.get(digest);
    if (!value) throw new Error("missing object");
    return value.slice();
  }
  async list() {
    return [...this.values.keys()];
  }
  async delete(digest: string) {
    this.values.delete(digest);
  }
}

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

describe("local project repository", () => {
  it("commits immutable source and revision objects then reopens them", async () => {
    const objects = new MemoryObjects();
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, objects);
    const project = await repo.create({
      filename: "notes.pdf",
      mimeType: "application/pdf",
      source: bytes("source"),
      text: "first text",
      exportPdf: bytes("pdf-one"),
    });
    const reopened = await repo.get(project.id);
    expect(reopened).toMatchObject({ filename: "notes.pdf", revision: 1, text: "first text" });
    expect(await repo.readSource(project.id)).toEqual(bytes("source"));
  });

  it("fails closed on stale revisions and preserves the confirmed revision", async () => {
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    const project = await repo.create({ filename: "a.pdf", mimeType: "application/pdf", source: bytes("a"), text: "one", exportPdf: bytes("p1") });
    const updated = await repo.updateText(project.id, 1, "two", bytes("p2"));
    expect(updated.revision).toBe(2);
    await expect(repo.updateText(project.id, 1, "lost", bytes("p3"))).rejects.toBeInstanceOf(LocalRevisionConflictError);
    expect((await repo.get(project.id)).text).toBe("two");
  });

  it("exports and imports a digest-verified portable archive", async () => {
    const objects = new MemoryObjects();
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, objects);
    const project = await repo.create({ filename: "a.pdf", mimeType: "application/pdf", source: bytes("%PDF-1.7\n"), text: "reviewed", exportPdf: bytes("rendered") });
    const archive = await repo.exportArchive(project.id);
    const importedRepo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    const imported = await importedRepo.importArchive(archive);
    expect(imported).toMatchObject({ filename: "a.pdf", text: "reviewed", revision: 1 });
    const tampered = archive.slice();
    tampered[tampered.length - 3] ^= 1;
    await expect(importedRepo.importArchive(tampered)).rejects.toThrow();
  });

  it("round-trips a PNG project through a digest-verified archive", async () => {
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const project = await repo.create({
      filename: "notes.png",
      mimeType: "image/png",
      source: png,
      text: "HOMEWORKER",
      exportPdf: bytes("rendered"),
    });
    const imported = await new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects()).importArchive(await repo.exportArchive(project.id));
    expect(imported).toMatchObject({ filename: "notes.png", mimeType: "image/png", text: "HOMEWORKER" });
  });

  it("rejects an archive whose mimeType is not a supported source", async () => {
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    const project = await repo.create({ filename: "a.pdf", mimeType: "application/pdf", source: bytes("%PDF-1.7\n"), text: "reviewed", exportPdf: bytes("rendered") });
    const archive = JSON.parse(new TextDecoder().decode(await repo.exportArchive(project.id))) as { project: { mimeType: string } };
    archive.project.mimeType = "image/gif";
    await expect(repo.importArchive(new TextEncoder().encode(JSON.stringify(archive)))).rejects.toThrow("Unsupported Homeworker archive");
  });

  it("saves, resumes, and clears a processing checkpoint without creating a project", async () => {
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    const digest = "abc123";
    expect(await repo.getCheckpoint(digest)).toBeUndefined();
    await repo.saveCheckpoint({
      digest,
      filename: "notes.pdf",
      mimeType: "application/pdf",
      pages: ["FIRST_PAGE_MARKER"],
      total: 3,
      extractionVersion: 1,
      updatedAt: new Date().toISOString(),
    });
    expect(await repo.getCheckpoint(digest)).toMatchObject({ pages: ["FIRST_PAGE_MARKER"], total: 3 });
    await repo.saveCheckpoint({
      digest,
      filename: "notes.pdf",
      mimeType: "application/pdf",
      pages: ["FIRST_PAGE_MARKER", "SECOND_PAGE_MARKER"],
      total: 3,
      text: "FIRST_PAGE_MARKER\n\nSECOND_PAGE_MARKER",
      extractionVersion: 1,
      updatedAt: new Date().toISOString(),
    });
    expect((await repo.getCheckpoint(digest))?.text).toContain("SECOND_PAGE_MARKER");
    await repo.deleteCheckpoint(digest);
    expect(await repo.getCheckpoint(digest)).toBeUndefined();
  });

  it("sweeps unreferenced objects without deleting live source or exports", async () => {
    const objects = new MemoryObjects();
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, objects);
    const project = await repo.create({ filename: "a.pdf", mimeType: "application/pdf", source: bytes("source"), text: "one", exportPdf: bytes("p1") });
    await objects.put("deadbeef", bytes("orphan"));
    expect(await repo.sweepOrphans()).toBe(1);
    expect(objects.values.has("deadbeef")).toBe(false);
    expect(await repo.readSource(project.id)).toEqual(bytes("source"));
  });

  it("deletes a project, its revisions, and unreferenced objects", async () => {
    const objects = new MemoryObjects();
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, objects);
    const keep = await repo.create({
      filename: "keep.pdf",
      mimeType: "application/pdf",
      source: bytes("keep-source"),
      text: "keep",
      exportPdf: bytes("keep-pdf"),
    });
    const gone = await repo.create({
      filename: "gone.pdf",
      mimeType: "application/pdf",
      source: bytes("gone-source"),
      text: "gone",
      exportPdf: bytes("gone-pdf"),
    });
    await repo.delete(gone.id);
    await expect(repo.get(gone.id)).rejects.toThrow("Local project not found");
    expect(await repo.get(keep.id)).toMatchObject({ filename: "keep.pdf", text: "keep" });
    expect(await repo.readSource(keep.id)).toEqual(bytes("keep-source"));
    expect(objects.values.size).toBe(2);
  });

  it("does not sweep objects written before metadata commit", async () => {
    const objects = new MemoryObjects();
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, objects);
    const originalPut = objects.put.bind(objects);
    objects.put = async (digest: string, value: Uint8Array) => {
      await originalPut(digest, value);
      await repo.sweepOrphans();
    };
    const project = await repo.create({ filename: "a.pdf", mimeType: "application/pdf", source: bytes("source"), text: "one", exportPdf: bytes("p1") });
    expect(await repo.readSource(project.id)).toEqual(bytes("source"));
    expect(await repo.readExport(project.id)).toEqual(bytes("p1"));
  });

  it("keeps historical export objects after a later revision", async () => {
    const objects = new MemoryObjects();
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, objects);
    const project = await repo.create({ filename: "a.pdf", mimeType: "application/pdf", source: bytes("source"), text: "one", exportPdf: bytes("p1") });
    await repo.updateText(project.id, 1, "two", bytes("p2"));
    expect(await repo.sweepOrphans()).toBe(0);
    expect(objects.values.size).toBe(3);
  });

  it("discards expired or incompatible checkpoints", async () => {
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    await repo.saveCheckpoint({
      digest: "abc",
      filename: "notes.pdf",
      mimeType: "application/pdf",
      pages: ["P1"],
      total: 2,
      extractionVersion: 0,
      updatedAt: new Date().toISOString(),
    });
    expect(await repo.getCheckpoint("abc")).toBeUndefined();
    await repo.saveCheckpoint({
      digest: "def",
      filename: "notes.pdf",
      mimeType: "application/pdf",
      pages: ["P1"],
      total: 2,
      extractionVersion: 1,
      updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(await repo.getCheckpoint("def")).toBeUndefined();
  });

  it("rejects archives whose bytes do not match the declared type or active-PDF policy", async () => {
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const project = await repo.create({ filename: "notes.png", mimeType: "image/png", source: png, text: "reviewed", exportPdf: bytes("rendered") });
    const archive = JSON.parse(new TextDecoder().decode(await repo.exportArchive(project.id))) as {
      project: { mimeType: string };
      objects: { source: { digest: string; data: string } };
    };
    archive.project.mimeType = "application/pdf";
    await expect(repo.importArchive(new TextEncoder().encode(JSON.stringify(archive)))).rejects.toThrow("does not match");
  });

  it("rejects oversized archives before parsing JSON", async () => {
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    await expect(repo.importArchive(new Uint8Array(80 * 1024 * 1024 + 1))).rejects.toThrow("backup is larger");
  });

  it("keeps the original filename stem in backup and PDF download names", () => {
    expect(backupDownloadName("notes.png")).toBe("notes.homeworker");
    expect(backupDownloadName("notes.PDF")).toBe("notes.homeworker");
    expect(reviewedPdfDownloadName("notes.png")).toBe("notes-reviewed.pdf");
  });
});
