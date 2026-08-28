import { describe, expect, it, vi } from "vitest";

import { ensureStorageCapacity, withProjectLock } from "@/lib/browser-local";

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
});
