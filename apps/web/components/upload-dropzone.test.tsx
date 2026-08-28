import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UploadDropzone } from "@/components/upload-dropzone";
import { createProject } from "@/lib/api";
import { createBrowserProject, importBrowserArchive } from "@/lib/browser-local";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hosted: false, loading: false, session: null }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, createProject: vi.fn() };
});
vi.mock("@/lib/browser-local", () => ({ createBrowserProject: vi.fn(), importBrowserArchive: vi.fn() }));

describe("UploadDropzone", () => {
  beforeEach(() => {
    vi.mocked(createProject).mockReset();
    vi.mocked(createBrowserProject).mockReset();
    vi.mocked(importBrowserArchive).mockReset();
    push.mockReset();
  });

  it("validates an unsupported file without processing it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/drop your notes/i), new File(["bad"], "notes.txt", { type: "text/plain" }));
    expect(screen.getByRole("status")).toHaveTextContent(/PDF, PNG, JPG/i);
    expect(createBrowserProject).not.toHaveBeenCalled();
  });

  it("creates a browser-local project without calling the API", async () => {
    vi.mocked(createBrowserProject).mockResolvedValue({
      id: "local_42",
      filename: "biology-notes.pdf",
      mimeType: "application/pdf",
      revision: 1,
      text: "Biology",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const user = userEvent.setup();
    render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/drop your notes/i), new File(["%PDF"], "biology-notes.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /turn into handwritten notes/i }));
    expect(createBrowserProject).toHaveBeenCalledOnce();
    expect(createProject).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/project?id=local_42");
  });

  it("restores a portable local archive", async () => {
    vi.mocked(importBrowserArchive).mockResolvedValue({
      id: "local_restored", filename: "restored.pdf", mimeType: "application/pdf", revision: 1,
      text: "Restored", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const user = userEvent.setup({ applyAccept: false });
    render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/restore .homeworker backup/i), new File(["archive"], "notes.homeworker"));
    expect(importBrowserArchive).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/project?id=local_restored");
  });
});
