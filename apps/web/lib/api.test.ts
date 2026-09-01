import { afterEach, describe, expect, it, vi } from "vitest";

import { confirmProject, deleteProject, updateBlock, updateProjectSettings } from "@/lib/api";
import { makeProject } from "@/tests/fixtures";

afterEach(() => vi.restoreAllMocks());

function mockJsonResponse() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(makeProject()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("API mutation contracts", () => {
  it("sends an optimistic revision with block corrections", async () => {
    const fetchMock = mockJsonResponse();
    await updateBlock("project-42", "block-1", "Correct text", 7);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ text: "Correct text", expectedRevision: 7 });
  });

  it("sends a project-level review confirmation", async () => {
    const fetchMock = mockJsonResponse();
    await confirmProject("project-42", 7);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      expectedRevision: 7,
    });
  });

  it("sends flat render settings matching the backend contract", async () => {
    const fetchMock = mockJsonResponse();
    const settings = makeProject().settings;
    await updateProjectSettings("project-42", settings, 7);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ ...settings, expectedRevision: 7 });
  });

  it("deletes only the expected local project revision", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await deleteProject("project-42", 7);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/projects/project-42?expectedRevision=7",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
