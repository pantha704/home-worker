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
vi.mock("@/components/a4-preview", () => ({ A4Preview: () => <div>Preview</div> }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    confirmProject: vi.fn(),
    getPersonas: vi.fn(),
    getProject: vi.fn(),
    updateBlock: vi.fn(),
    updateProjectSettings: vi.fn(),
  };
});

describe("ReviewWorkspace export gate", () => {
  beforeEach(() => {
    vi.mocked(getProject).mockResolvedValue(makeProject());
    vi.mocked(getPersonas).mockResolvedValue([]);
    vi.mocked(confirmProject).mockResolvedValue(makeProject({ status: "ready", revision: 3 }));
  });

  it("keeps final downloads locked until every required block is checked and review is confirmed", async () => {
    const user = userEvent.setup();
    render(<ReviewWorkspace projectId="project-42" />);

    await screen.findByRole("heading", { name: /check before you print/i });
    const exportControl = screen.getByRole("button", { name: /^export$/i });
    expect(exportControl).toBeDisabled();
    expect(screen.getByRole("button", { name: /confirm review/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /looks correct/i }));
    const confirm = screen.getByRole("button", { name: /confirm review/i });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(confirmProject).toHaveBeenCalledWith("project-42", 2, ["block-1"]));
    await waitFor(() => expect(exportControl).toBeEnabled());
  });
});
