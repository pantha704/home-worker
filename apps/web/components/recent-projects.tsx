"use client";

import type { ProjectSummary } from "@homeworker/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth-provider";
import { ArrowRightIcon, FileIcon } from "@/components/icons";
import { listProjects } from "@/lib/api";
import { isHostedMode } from "@/lib/config";
import { safeProjectTitle } from "@/lib/project";
import type { RecentProject } from "@/lib/recent-projects";

export function RecentProjects() {
  const { hosted, session } = useAuth();
  const snapshot = useSyncExternalStore(subscribe, getStorageSnapshot, () => "[]");
  const [accountProjects, setAccountProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    if (!hosted || !session) {
      return;
    }
    const controller = new AbortController();
    void listProjects(controller.signal)
      .then((result) => setAccountProjects(result.items.slice(0, 5)))
      .catch(() => setAccountProjects([]));
    return () => controller.abort();
  }, [hosted, session]);

  const localProjects = useMemo(() => {
    try {
      const value = JSON.parse(snapshot) as unknown;
      return Array.isArray(value) ? value.filter(isRecentProject) : [];
    } catch {
      return [];
    }
  }, [snapshot]);
  const projects = hosted ? (session ? accountProjects : []) : localProjects;
  if (projects.length === 0) return null;

  return (
    <section aria-labelledby="recent-heading" className="recent-section">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">Continue working</span>
          <h2 id="recent-heading">Recent projects</h2>
        </div>
        <span className="muted-caption">{hosted ? "Private to your account" : "Stored on this browser"}</span>
      </div>
      <div className="recent-grid">
        {projects.map((project) => (
          <Link className="recent-card" href={`/project?id=${encodeURIComponent(project.id)}`} key={project.id}>
            <span className="recent-icon"><FileIcon /></span>
            <span className="recent-copy">
              <strong>{safeProjectTitle(project.filename)}</strong>
              <small>{project.filename}</small>
            </span>
            <ArrowRightIcon className="recent-arrow" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function getStorageSnapshot(): string {
  if (isHostedMode()) return "[]";
  return window.localStorage.getItem("homeworker:recent-projects") ?? "[]";
}

function subscribe(onStoreChange: () => void): () => void {
  if (isHostedMode()) return () => undefined;
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
