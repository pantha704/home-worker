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

  it("offers cancellation while local processing is active", async () => {
    vi.mocked(createBrowserProject).mockImplementation((_file: File, options?: { signal?: AbortSignal; onProcessing?: () => void }) => new Promise<never>((_resolve, reject) => {
      options?.onProcessing?.();
      options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const user = userEvent.setup();
    render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/drop your notes/i), new File(["%PDF-1.7"], "large.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /turn into handwritten notes/i }));
    const cancel = screen.getByRole("button", { name: /cancel processing/i });
    expect(cancel).toBeEnabled();
    await user.click(cancel);
    expect(await screen.findByRole("status")).toHaveTextContent(/cancelled.*not saved/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("removes cancellation at the persistence point of no return", async () => {
    vi.mocked(createBrowserProject).mockImplementation((_file, options) => {
      options?.onProcessing?.();
      options?.onFinalizing?.();
      return new Promise(() => {});
    });
    const user = userEvent.setup();
    render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/drop your notes/i), new File(["%PDF-1.7"], "large.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /turn into handwritten notes/i }));
    expect(screen.queryByRole("button", { name: /cancel processing/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finalizing/i })).toBeDisabled();
  });

  it("cancels processing when the dropzone unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(createBrowserProject).mockImplementation((_file, options) => {
      signal = options?.signal;
      options?.onProcessing?.();
      return new Promise(() => {});
    });
    const user = userEvent.setup();
    const view = render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/drop your notes/i), new File(["%PDF-1.7"], "large.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /turn into handwritten notes/i }));
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("does not offer cancellation before the local worker starts", async () => {
    vi.mocked(createBrowserProject).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/drop your notes/i), new File(["%PDF-1.7"], "large.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /turn into handwritten notes/i }));
    expect(screen.queryByRole("button", { name: /cancel processing/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preparing/i })).toBeDisabled();
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
