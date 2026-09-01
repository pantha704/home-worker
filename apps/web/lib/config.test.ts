import { afterEach, describe, expect, it } from "vitest";

import { getRuntimeMode, isBrowserPreviewMode, isHostedMode } from "@/lib/config";

const originalMode = process.env.NEXT_PUBLIC_RUNTIME_MODE;
const originalStaticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT;

afterEach(() => {
  if (originalMode === undefined) delete process.env.NEXT_PUBLIC_RUNTIME_MODE;
  else process.env.NEXT_PUBLIC_RUNTIME_MODE = originalMode;
  if (originalStaticExport === undefined) delete process.env.NEXT_PUBLIC_STATIC_EXPORT;
  else process.env.NEXT_PUBLIC_STATIC_EXPORT = originalStaticExport;
});

describe("runtime mode", () => {
  it("defaults native development to the full local service", () => {
    delete process.env.NEXT_PUBLIC_RUNTIME_MODE;
    delete process.env.NEXT_PUBLIC_STATIC_EXPORT;
    expect(getRuntimeMode()).toBe("local-service");
    expect(isHostedMode()).toBe(false);
    expect(isBrowserPreviewMode()).toBe(false);
  });

  it("uses browser preview for a static export", () => {
    delete process.env.NEXT_PUBLIC_RUNTIME_MODE;
    process.env.NEXT_PUBLIC_STATIC_EXPORT = "1";
    expect(getRuntimeMode()).toBe("browser-preview");
    expect(isBrowserPreviewMode()).toBe(true);
  });

  it("keeps the authenticated hosted beta explicit", () => {
    process.env.NEXT_PUBLIC_RUNTIME_MODE = "hosted";
    delete process.env.NEXT_PUBLIC_STATIC_EXPORT;
    expect(getRuntimeMode()).toBe("hosted");
    expect(isHostedMode()).toBe(true);
  });
});
