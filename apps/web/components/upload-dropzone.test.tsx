import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UploadDropzone } from "@/components/upload-dropzone";
import { createProject } from "@/lib/api";
import { makeProject } from "@/tests/fixtures";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hosted: false, loading: false, session: null }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, createProject: vi.fn() };
});

describe("UploadDropzone", () => {
  beforeEach(() => {
    vi.mocked(createProject).mockReset();
    push.mockReset();
  });

  it("validates an unsupported file without calling the API", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/drop your notes/i), new File(["bad"], "notes.txt", { type: "text/plain" }));
    expect(screen.getByRole("status")).toHaveTextContent(/PDF, PNG, JPG/i);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("creates a project and opens its review route", async () => {
    vi.mocked(createProject).mockResolvedValue(makeProject());
    const user = userEvent.setup();
    render(<UploadDropzone />);
    await user.upload(screen.getByLabelText(/drop your notes/i), new File(["%PDF"], "biology-notes.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /turn into handwritten notes/i }));
    expect(createProject).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/project?id=project-42");
  });
});
