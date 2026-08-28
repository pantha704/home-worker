import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import {
  LocalProjectRepository,
  LocalRevisionConflictError,
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
    const project = await repo.create({ filename: "a.pdf", mimeType: "application/pdf", source: bytes("source"), text: "reviewed", exportPdf: bytes("rendered") });
    const archive = await repo.exportArchive(project.id);
    const importedRepo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    const imported = await importedRepo.importArchive(archive);
    expect(imported).toMatchObject({ filename: "a.pdf", text: "reviewed", revision: 1 });
    const tampered = archive.slice();
    tampered[tampered.length - 3] ^= 1;
    await expect(importedRepo.importArchive(tampered)).rejects.toThrow();
  });
});
