import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecentProjects } from "@/components/recent-projects";
import { deleteBrowserProject } from "@/lib/browser-local";
import { isBrowserPreviewMode } from "@/lib/config";
import { rememberProject } from "@/lib/recent-projects";

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hosted: false, loading: false, session: null }),
}));
vi.mock("@/lib/browser-local", () => ({ deleteBrowserProject: vi.fn() }));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, isBrowserPreviewMode: vi.fn(() => true) };
});

describe("RecentProjects", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(isBrowserPreviewMode).mockReturnValue(true);
    vi.mocked(deleteBrowserProject).mockReset().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("deletes a browser-local project from the home list", async () => {
    rememberProject({ id: "local_1", filename: "notes.pdf", updatedAt: "2026-09-07T00:00:00.000Z" });
    const user = userEvent.setup();
    render(<RecentProjects />);
    expect(screen.getByRole("link", { name: /notes/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(deleteBrowserProject).toHaveBeenCalledWith("local_1");
    expect(screen.queryByRole("link", { name: /notes/i })).not.toBeInTheDocument();
  });
});
