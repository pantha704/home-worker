"use client";

import type { ProjectSummary } from "@homeworker/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth-provider";
import { ArrowRightIcon, FileIcon } from "@/components/icons";
import { deleteProject, listProjects } from "@/lib/api";
import { deleteBrowserProject } from "@/lib/browser-local";
import { isBrowserPreviewMode } from "@/lib/config";
import { safeProjectTitle } from "@/lib/project";
import { forgetProject, type RecentProject } from "@/lib/recent-projects";

export function RecentProjects() {
  const { hosted, session } = useAuth();
  const browserPreview = isBrowserPreviewMode();
  const snapshot = useSyncExternalStore(subscribe, getStorageSnapshot, () => "[]");
  const [accountProjects, setAccountProjects] = useState<ProjectSummary[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (browserPreview || (hosted && !session)) {
      return;
    }
    const controller = new AbortController();
    void listProjects(controller.signal)
      .then((result) => setAccountProjects(result.items.slice(0, 5)))
      .catch(() => setAccountProjects([]));
    return () => controller.abort();
  }, [browserPreview, hosted, session]);

  const localProjects = useMemo(() => {
    try {
      const value = JSON.parse(snapshot) as unknown;
      return Array.isArray(value) ? value.filter(isRecentProject) : [];
    } catch {
      return [];
    }
  }, [snapshot]);
  const projects = (browserPreview ? localProjects : (hosted && !session ? [] : accountProjects))
    .filter((project) => !removedIds.has(project.id));
  if (projects.length === 0 && !deleteError) return null;

  async function remove(project: { id: string; filename: string; revision?: number }) {
    if (!window.confirm(`Delete “${project.filename}”? This cannot be undone.`)) return;
    setDeleteError(null);
    try {
      if (browserPreview) {
        await deleteBrowserProject(project.id);
        forgetProject(project.id);
      } else {
        if (typeof project.revision !== "number") {
          throw new Error("Missing revision");
        }
        await deleteProject(project.id, project.revision);
      }
      setRemovedIds((current) => new Set(current).add(project.id));
    } catch {
      setDeleteError("The project could not be deleted.");
    }
  }

  return (
    <section aria-labelledby="recent-heading" className="recent-section">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">Continue working</span>
          <h2 id="recent-heading">Recent projects</h2>
        </div>
        <span className="muted-caption">{hosted ? "Private to your account" : browserPreview ? "Stored on this browser" : "Stored by your local service"}</span>
      </div>
      {deleteError ? <p className="mutation-error" role="alert">{deleteError}</p> : null}
      <div className="recent-grid">
        {projects.map((project) => (
          <article className="recent-item" key={project.id}>
            <Link className="recent-card" href={`/project?id=${encodeURIComponent(project.id)}`}>
              <span className="recent-icon"><FileIcon /></span>
              <span className="recent-copy">
                <strong>{safeProjectTitle(project.filename)}</strong>
                <small>{project.filename}</small>
              </span>
              <ArrowRightIcon className="recent-arrow" />
            </Link>
            <button
              className="button button-ghost recent-delete"
              onClick={() => void remove(project)}
              type="button"
            >
              Delete
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function getStorageSnapshot(): string {
  if (!isBrowserPreviewMode()) return "[]";
  return window.localStorage.getItem("homeworker:recent-projects") ?? "[]";
}

function subscribe(onStoreChange: () => void): () => void {
  if (!isBrowserPreviewMode()) return () => undefined;
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("homeworker:recent", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("homeworker:recent", onStoreChange);
  };
}

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecentProject>;
  return typeof item.id === "string" && typeof item.filename === "string" && typeof item.updatedAt === "string";
}
