import { isHostedMode } from "@/lib/config";

export interface RecentProject {
  id: string;
  filename: string;
  updatedAt: string;
}

const STORAGE_KEY = "homeworker:recent-projects";
const LIMIT = 5;

export function getRecentProjects(): RecentProject[] {
  if (typeof window === "undefined" || isHostedMode()) return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isRecentProject).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function rememberProject(project: RecentProject): void {
  if (typeof window === "undefined" || isHostedMode()) return;
  const next = [project, ...getRecentProjects().filter((item) => item.id !== project.id)].slice(0, LIMIT);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("homeworker:recent"));
}

export function forgetProject(projectId: string): void {
  if (typeof window === "undefined" || isHostedMode()) return;
  const next = getRecentProjects().filter((item) => item.id !== projectId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("homeworker:recent"));
}

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecentProject>;
  return (
    typeof item.id === "string" &&
    typeof item.filename === "string" &&
    typeof item.updatedAt === "string"
  );
}
