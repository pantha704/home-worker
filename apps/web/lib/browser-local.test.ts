import { describe, expect, it, vi } from "vitest";

import { ensureStorageCapacity, requestLocalWorker, validateLocalPdfSource, withProjectLock } from "@/lib/browser-local";
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
  });

  it("ignores non-protocol worker control messages until the deadline", async () => {
    vi.useFakeTimers();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const pending = requestLocalWorker("render", "text", 50, () => worker);
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
    const pending = requestLocalWorker("render", "text", 50, () => worker);
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
    const pending = requestLocalWorker("process", new Uint8Array([0x25, 0x50, 0x44, 0x46]), 50, () => worker);
    const rejection = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
