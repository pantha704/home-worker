import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LocalReviewWorkspace } from "@/components/local-review-workspace";
import { browserRepository, updateBrowserProject } from "@/lib/browser-local";

vi.mock("@/lib/browser-local", () => ({
  browserRepository: vi.fn(),
  updateBrowserProject: vi.fn(),
}));

const project = {
  id: "local_42",
  filename: "notes.pdf",
  mimeType: "application/pdf" as const,
  revision: 1,
  text: "Original wording",
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

describe("LocalReviewWorkspace", () => {
  it("reopens a local revision and saves reviewed text", async () => {
    vi.mocked(browserRepository).mockReturnValue({
      get: vi.fn().mockResolvedValue(project),
      readSource: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])),
    } as never);
    vi.mocked(updateBrowserProject).mockResolvedValue({ ...project, revision: 2, text: "Reviewed wording" });
    const user = userEvent.setup();
    render(<LocalReviewWorkspace projectId="local_42" />);
    expect(await screen.findByLabelText(/source document/i)).toBeInTheDocument();
    const editor = await screen.findByRole("textbox", { name: /review extracted text/i });
    await user.clear(editor);
    await user.type(editor, "Reviewed wording");
    await user.click(screen.getByRole("button", { name: /save revision/i }));
    expect(updateBrowserProject).toHaveBeenCalledWith("local_42", 1, "Reviewed wording");
    expect(await screen.findByText(/revision 2/i)).toBeInTheDocument();
  });

  it("regenerates an existing project's PDF without requiring a fake text edit", async () => {
    vi.mocked(browserRepository).mockReturnValue({
      get: vi.fn().mockResolvedValue(project),
      readSource: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])),
    } as never);
    vi.mocked(updateBrowserProject).mockResolvedValue({ ...project, revision: 2 });
    const user = userEvent.setup();
    render(<LocalReviewWorkspace projectId="local_42" />);

    await user.click(await screen.findByRole("button", { name: /regenerate PDF/i }));

    expect(updateBrowserProject).toHaveBeenCalledWith("local_42", 1, "Original wording");
    expect(await screen.findByText(/revision 2/i)).toBeInTheDocument();
  });
});
