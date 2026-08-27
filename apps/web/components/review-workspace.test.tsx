import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewWorkspace } from "@/components/review-workspace";
import { confirmProject, getPersonas, getProject } from "@/lib/api";
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
    updatePageText: vi.fn(),
    updateProjectSettings: vi.fn(),
  };
});

describe("ReviewWorkspace page submit gate", () => {
  beforeEach(() => {
    vi.mocked(getProject).mockResolvedValue(makeProject());
    vi.mocked(getPersonas).mockResolvedValue([]);
    vi.mocked(confirmProject).mockResolvedValue(makeProject({ status: "ready", revision: 3 }));
  });

  it("lets the user submit after page review and then unlocks export", async () => {
    const user = userEvent.setup();
    render(<ReviewWorkspace projectId="project-42" />);

    await screen.findByRole("heading", { name: /page 1/i }).catch(() => screen.findByText(/Page 1/));
    const exportControl = screen.getByRole("button", { name: /^export$/i });
    expect(exportControl).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /submit for handwriting/i }));
    await waitFor(() => expect(confirmProject).toHaveBeenCalled());
    await waitFor(() => expect(exportControl).toBeEnabled());
  });
});
