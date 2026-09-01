import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

import { createBrowserProject, ensureStorageCapacity, requestLocalWorker, validateLocalPdfSource, validateLocalSource, withProjectLock } from "@/lib/browser-local";
import { LocalProjectRepository, sha256, type LocalObjectStore } from "@/lib/local-store";
import { MAX_UPLOAD_BYTES } from "@/lib/validation";

describe("browser-local safety gates", () => {
  it("rejects an import before writing when the quota reserve is insufficient", async () => {
    const storage = {
      estimate: vi.fn().mockResolvedValue({ quota: 1_000, usage: 900 }),
      persist: vi.fn().mockResolvedValue(false),
    };
    await expect(ensureStorageCapacity(100, storage)).rejects.toThrow("storage space");
  });

  it("requests persistence but still works when persistence is denied and capacity exists", async () => {
    const storage = {
      estimate: vi.fn().mockResolvedValue({ quota: 100_000_000, usage: 0 }),
      persist: vi.fn().mockResolvedValue(false),
    };
    await expect(ensureStorageCapacity(100, storage)).resolves.toBe(false);
  });

  it("does not wait forever when persistence is slow to resolve", async () => {
    const storage = {
      estimate: vi.fn().mockResolvedValue({ quota: 100_000_000, usage: 0 }),
      persist: vi.fn().mockReturnValue(new Promise(() => undefined)),
    };
    await expect(ensureStorageCapacity(100, storage)).resolves.toBe(false);
  });

  it("fails closed when exclusive Web Locks are unavailable", async () => {
    await expect(withProjectLock("local_1", async () => 1, undefined)).rejects.toThrow("exclusive locking");
  });

  it("rejects a spoofed PDF before processing", () => {
    expect(() => validateLocalPdfSource(new Uint8Array([0x4e, 0x4f, 0x54, 0x50, 0x44, 0x46]))).toThrow("valid PDF");
  });

  it("rejects a PDF marker embedded in arbitrary bytes", () => {
    const source = new TextEncoder().encode("not-a-header%PDF-1.7");
    expect(() => validateLocalPdfSource(source)).toThrow("valid PDF");
  });

  it("accepts a PDF signature after leading whitespace", () => {
    expect(() => validateLocalPdfSource(new TextEncoder().encode(" \n%PDF-1.7"))).not.toThrow();
  });

  it("rejects browser-local sources over the upload limit", () => {
    expect(() => validateLocalPdfSource(new Uint8Array(MAX_UPLOAD_BYTES + 1))).toThrow("25 MB");
    expect(() => validateLocalSource(new Uint8Array(MAX_UPLOAD_BYTES + 1))).toThrow("25 MB");
  });

  it("accepts PNG and JPEG magic bytes and rejects GIF", () => {
    expect(validateLocalSource(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(validateLocalSource(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(() => validateLocalSource(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toThrow("supported source");
  });

  it("ignores non-protocol worker control messages until the deadline", async () => {
    vi.useFakeTimers();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const pending = requestLocalWorker("render", "text", { timeoutMs: 50, createWorker: () => worker });
    const rejection = expect(pending).rejects.toThrow("timed out");
    worker.onmessage?.({ data: { sourceName: "webpack", action: "building" } } as MessageEvent);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("rejects malformed worker protocol responses immediately", async () => {
    vi.useFakeTimers();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const pending = requestLocalWorker("render", "text", { timeoutMs: 50, createWorker: () => worker });
    const rejection = expect(pending).rejects.toThrow("invalid response");
    worker.onmessage?.({ data: { kind: "result" } } as MessageEvent);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("terminates a document worker that exceeds its deadline", async () => {
    vi.useFakeTimers();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const pending = requestLocalWorker("process", new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      timeoutMs: 50,
      createWorker: () => worker as unknown as Worker,
    });
    const rejection = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("reports matching progress and ignores stale replies", async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const pending = requestLocalWorker("render", "text", {
      timeoutMs: 50,
      createWorker: () => worker as unknown as Worker,
      requestId: "current",
      onProgress,
    });
    worker.onmessage?.({ data: { kind: "progress", requestId: "stale", completed: 1, total: 2 } } as MessageEvent);
    worker.onmessage?.({ data: { kind: "progress", requestId: "current", completed: 1, total: 2 } } as MessageEvent);
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({ completed: 1, total: 2 });
    const rejection = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    vi.useRealTimers();
  });

  it("ignores malformed stale terminal replies", async () => {
    vi.useFakeTimers();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const pending = requestLocalWorker("render", "text", {
      timeoutMs: 50,
      createWorker: () => worker as unknown as Worker,
      requestId: "current",
    });
    worker.onmessage?.({ data: { kind: "result", requestId: "stale", pdf: "invalid" } } as MessageEvent);
    const rejection = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    vi.useRealTimers();
  });

  it("terminates once after a matching result and clears the deadline", async () => {
    vi.useFakeTimers();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const pending = requestLocalWorker("render", "text", {
      timeoutMs: 50,
      createWorker: () => worker as unknown as Worker,
      requestId: "current",
    });
    worker.onmessage?.({ data: { kind: "result", requestId: "current", pdf: new Uint8Array([1]) } } as MessageEvent);
    await expect(pending).resolves.toMatchObject({ requestId: "current" });
    await vi.advanceTimersByTimeAsync(50);
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("terminates processing when aborted", async () => {
    const controller = new AbortController();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const pending = requestLocalWorker("render", "text", { createWorker: () => worker, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

class MemoryObjects implements LocalObjectStore {
  readonly values = new Map<string, Uint8Array>();
  async put(digest: string, bytes: Uint8Array) { this.values.set(digest, bytes.slice()); }
  async get(digest: string) {
    const value = this.values.get(digest);
    if (!value) throw new Error("missing object");
    return value.slice();
  }
}

describe("browser-local checkpoints", () => {
  const storage = {
    estimate: vi.fn().mockResolvedValue({ quota: 100_000_000, usage: 0 }),
    persist: vi.fn().mockResolvedValue(true),
  };
  const locks = {
    request: (_name: string, _opts: unknown, operation: () => Promise<unknown>) => operation(),
  } as unknown as LockManager;

  it("keeps a checkpoint when cancelled after the worker and resumes by rendering it", async () => {
    const repo = new LocalProjectRepository(`test-${crypto.randomUUID()}`, new MemoryObjects());
    const source = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new File([source], "notes.png", { type: "image/png" });
    const controller = new AbortController();
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null,
      postMessage(data: { requestId: string }) {
        worker.onmessage?.({ data: { kind: "result", requestId: data.requestId, text: "HOMEWORKER", pdf: new Uint8Array([1]) } } as MessageEvent);
        controller.abort();
      },
      terminate: vi.fn(),
    };

    await expect(createBrowserProject(file, {
      signal: controller.signal,
      createWorker: () => worker as unknown as Worker,
      repository: repo,
      storage,
      locks,
    })).rejects.toThrow("cancelled");

    const digest = await sha256(source);
    expect(await repo.getCheckpoint(digest)).toMatchObject({ text: "HOMEWORKER" });
    await expect(repo.get("missing")).rejects.toThrow();

    const resumed = await createBrowserProject(file, {
      createWorker: () => worker as unknown as Worker,
      repository: repo,
      storage,
      locks,
    });
    expect(resumed.text).toBe("HOMEWORKER");
    expect(await repo.getCheckpoint(digest)).toBeUndefined();
  });
});
