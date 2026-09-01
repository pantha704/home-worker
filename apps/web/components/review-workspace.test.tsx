import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewWorkspace } from "@/components/review-workspace";
import { confirmProject, getPersonas, getProject, reviewBlock, updatePageText } from "@/lib/api";
import { makeProject } from "@/tests/fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hosted: false, loading: false, session: null }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    confirmProject: vi.fn(),
    fetchPngObjectUrl: vi.fn().mockResolvedValue("blob:page"),
    getPersonas: vi.fn(),
    getProject: vi.fn(),
    retryPages: vi.fn(),
    reviewBlock: vi.fn(),
    updatePageText: vi.fn(),
    updateProjectSettings: vi.fn(),
  };
});

describe("ReviewWorkspace page submit gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const reviewedProject = makeProject({
      revision: 3,
      pages: [{ ...makeProject().pages[0], blocks: [{ ...makeProject().pages[0].blocks[0], reviewed: true, confidence: 1 }] }],
    });
    vi.mocked(getProject).mockReset().mockResolvedValueOnce(makeProject()).mockResolvedValue(reviewedProject);
    vi.mocked(getPersonas).mockResolvedValue([]);
    vi.mocked(confirmProject).mockResolvedValue(makeProject({ status: "ready", revision: 4 }));
    vi.mocked(reviewBlock).mockResolvedValue(reviewedProject);
  });

  it("requires an explicit uncertain-block decision before submission", async () => {
    const user = userEvent.setup();
    render(<ReviewWorkspace projectId="project-42" />);

    await screen.findByRole("heading", { name: /page 1/i }).catch(() => screen.findByText(/Page 1/));
    const exportControl = screen.getByRole("button", { name: /^export$/i });
    expect(exportControl).toBeDisabled();

    const submit = screen.getByRole("button", { name: /submit for handwriting/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/check the highlighted OCR wording/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /approve extracted text/i }));
    await waitFor(() => expect(reviewBlock).toHaveBeenCalledWith(
      "project-42",
      "block-1",
      2,
    ));
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(confirmProject).toHaveBeenCalledWith("project-42", 3));
    await waitFor(() => expect(exportControl).toBeEnabled());
  });

  it("does not confirm when saving the visible draft fails", async () => {
    const reviewedProject = makeProject({
      revision: 3,
      pages: [{
        ...makeProject().pages[0],
        blocks: [{
          ...makeProject().pages[0].blocks[0],
          reviewed: true,
          confidence: 1,
          warnings: [],
        }],
      }],
    });
    vi.mocked(getProject).mockReset().mockResolvedValue(reviewedProject);
    vi.mocked(updatePageText).mockRejectedValue(new Error("save failed"));
    const user = userEvent.setup();
    render(<ReviewWorkspace projectId="project-42" />);

    const editor = await screen.findByRole("textbox", { name: /extracted text for page 1/i });
    await user.clear(editor);
    await user.type(editor, "unsaved correction");
    await user.click(screen.getByRole("button", { name: /submit for handwriting/i }));

    await waitFor(() => expect(updatePageText).toHaveBeenCalled());
    expect(confirmProject).not.toHaveBeenCalled();
    expect(editor).toHaveValue("unsaved correction");
  });
});
