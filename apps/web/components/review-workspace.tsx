"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Persona, ProjectDocument, RenderSettings } from "@homeworker/contracts";

import { BookStudio } from "@/components/book-studio";
import { useAuth } from "@/components/auth-provider";
import { CheckIcon, FileIcon, RefreshIcon, WarningIcon } from "@/components/icons";
import { PageReviewer } from "@/components/page-reviewer";
import { ProjectToolbar } from "@/components/project-toolbar";
import {
  confirmProject,
  deleteProject,
  fetchArtifact,
  getPersonas,
  getProject,
  isConflictError,
  HomeworkerApiError,
  retryPages,
  saveBlob,
  reviewBlock,
  updatePageText,
  updateProjectSettings,
} from "@/lib/api";
import { flattenBlocks, pagePlainText } from "@/lib/project";
import { forgetProject, rememberProject } from "@/lib/recent-projects";

// Placeholder cards shown only until /v1/personas responds; descriptions and licences are API-owned.
const FALLBACK_PERSONAS: Persona[] = [
  { id: "scholar", name: "Scholar", description: "", license: "" },
  { id: "casual", name: "Casual", description: "", license: "" },
  { id: "compact", name: "Compact", description: "", license: "" },
];

export function ReviewWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { hosted, loading: authLoading, session } = useAuth();
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [personas, setPersonas] = useState<Persona[]>(FALLBACK_PERSONAS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set());
  const [refreshingPage, setRefreshingPage] = useState<number | null>(null);

  useEffect(() => {
    if (authLoading || (hosted && !session)) {
      return;
    }
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let active = true;

    async function load() {
      try {
        const nextProject = await getProject(projectId, controller.signal);
        if (!active) return;
        setProject(nextProject);
        setLoadError(null);
        setLoading(false);
        rememberProject({ id: nextProject.id, filename: nextProject.filename, updatedAt: nextProject.updatedAt });
        if (nextProject.status === "processing") {
          pollTimer = setTimeout(load, 1_500);
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        const message = error instanceof HomeworkerApiError
          ? error.message
          : "Could not connect to the local Homeworker API.";
        setLoadError(message);
        setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [authLoading, hosted, projectId, reloadToken, session]);

  useEffect(() => {
    if (authLoading || (hosted && !session)) return;
    const controller = new AbortController();
    getPersonas(controller.signal)
      .then((items) => { if (items.length > 0) setPersonas(items); })
      .catch(() => { /* Licensed built-ins remain available if discovery is offline. */ });
    return () => controller.abort();
  }, [authLoading, hosted, session]);

  const pages = project?.pages ?? [];
  const currentPage = pages[pageIndex] ?? pages[0];
  const draftText = currentPage ? (drafts[currentPage.number] ?? pagePlainText(currentPage)) : "";
  const isReady = project?.status === "ready";
  const stage: "review" | "finalize" = isReady ? "finalize" : "review";
  const refreshing = refreshingPage !== null;
  const pendingReviewBlocks = flattenBlocks(pages).filter(
    (block) => !block.reviewed && (block.confidence < 0.9 || block.warnings.length > 0),
  );

  async function recoverConflict(message: string) {
    try {
      const fresh = await getProject(projectId);
      setProject(fresh);
      setDrafts({});
      setMutationError(message);
    } catch {
      setMutationError("This project changed elsewhere. Reload the page before continuing.");
    }
  }

  async function runMutation<T>(
    busyKey: string,
    failureMessage: string,
    operation: () => Promise<T>,
    options: { conflictMessage?: string; onSettled?: () => void } = {},
  ): Promise<T | null> {
    setBusyAction(busyKey);
    setMutationError(null);
    try {
      return await operation();
    } catch (error) {
      if (options.conflictMessage !== undefined && isConflictError(error)) {
        await recoverConflict(options.conflictMessage);
      } else {
        setMutationError(error instanceof HomeworkerApiError ? error.message : failureMessage);
      }
      return null;
    } finally {
      setBusyAction(null);
      options.onSettled?.();
    }
  }

  async function approveBlock(blockId: string) {
    if (!project) return;
    await runMutation(
      `block:${blockId}`,
      "The block review could not be saved.",
      async () => {
        setProject(await reviewBlock(project.id, blockId, project.revision));
      },
      { conflictMessage: "The document changed. Review this block again." },
    );
  }

  async function saveCurrentPage() {
    if (!project || !currentPage || busyAction !== null) return null;
    return runMutation(
      `page:${currentPage.number}`,
      "The page could not be saved.",
      async () => {
        const next = await updatePageText(project.id, currentPage.number, draftText, project.revision);
        setProject(next);
        setDrafts((current) => {
          const copy = { ...current };
          delete copy[currentPage.number];
          return copy;
        });
        return next;
      },
      { conflictMessage: "A newer revision was loaded. Check this page and save again." },
    );
  }

  async function retrySelected() {
    if (!project || selectedPages.size === 0) return;
    const numbers = [...selectedPages].sort((a, b) => a - b);
    setRefreshingPage(numbers[0] ?? null);
    await runMutation(
      "retry",
      "Those pages could not be re-extracted.",
      async () => {
        let revision = project.revision;
        let latest = project;
        for (const number of numbers) {
          setRefreshingPage(number);
          latest = await retryPages(latest.id, [number], revision, { forceOcr: true });
          revision = latest.revision;
        }
        setProject(latest);
        setSelectedPages(new Set());
        setDrafts({});
      },
      {
        conflictMessage: "The document changed. Re-select pages to retry.",
        onSettled: () => setRefreshingPage(null),
      },
    );
  }

  async function applySettings(settings: RenderSettings) {
    if (!project) return;
    await runMutation(
      "settings",
      "Page settings could not be applied.",
      async () => {
        setProject(await updateProjectSettings(project.id, settings, project.revision));
      },
      { conflictMessage: "A newer revision was loaded. Reapply your page settings." },
    );
  }

  async function submitReview() {
    if (!project || busyAction !== null) return;
    await runMutation(
      "confirm",
      "The review could not be submitted.",
      async () => {
        let revision = project.revision;
        let latest = project;
        const dirtyPages = pages.filter((page) => (drafts[page.number] ?? pagePlainText(page)) !== pagePlainText(page));
        for (const page of dirtyPages) {
          latest = await updatePageText(latest.id, page.number, drafts[page.number] ?? pagePlainText(page), revision);
          revision = latest.revision;
          setProject(latest);
          setDrafts((current) => {
            const copy = { ...current };
            delete copy[page.number];
            return copy;
          });
        }
        setProject(await confirmProject(latest.id, revision));
      },
      { conflictMessage: "The document changed during review. Recheck pages before submitting." },
    );
  }

  async function removeProject() {
    if (!project) return;
    const confirmed = window.confirm(`Delete “${project.filename}” and its ${hosted ? "private stored source" : "local source file"}? This cannot be undone.`);
    if (!confirmed) return;
    await runMutation(
      "delete",
      "The local project could not be deleted.",
      async () => {
        await deleteProject(project.id, project.revision);
        forgetProject(project.id);
        router.push("/");
        router.refresh();
      },
      { conflictMessage: "The project changed before deletion. Review the latest revision, then delete again." },
    );
  }

  async function downloadHandwritten() {
    if (!project || !isReady) return;
    await runMutation(
      "download:handwritten",
      "The export could not be prepared.",
      async () => {
        saveBlob(await fetchArtifact(project.id, project.revision, "handwritten_pdf"));
      },
    );
  }

  if (authLoading) {
    return <main className="centered-state" role="status"><span className="spinner spinner-large" /><h1>Checking your session…</h1></main>;
  }

  if (hosted && !session) {
    return <main className="centered-state"><WarningIcon size={34} /><h1>Sign in to open this project.</h1><p>Your hosted projects are private to your account.</p><Link className="button button-primary" href="/#upload">Sign in</Link></main>;
  }

  if (loading) {
    return (
      <main className="centered-state" role="status">
        <span className="spinner spinner-large" />
        <h1>Reading your document…</h1>
        <p>Native text is checked first; OCR is used only where needed.</p>
      </main>
    );
  }

  if (loadError || !project) {
    return (
      <main className="centered-state">
        <WarningIcon className="state-warning" size={34} />
        <h1>We could not open this project.</h1>
        <p>{loadError ?? "The project response was empty."}</p>
        <div className="state-actions">
          <button className="button button-primary" onClick={() => { setLoading(true); setReloadToken((value) => value + 1); }} type="button"><RefreshIcon size={17} /> Try again</button>
          <Link className="button button-secondary" href="/">Return home</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="project-app">
      <ProjectToolbar
        downloading={busyAction === "download:handwritten"}
        filename={project.filename}
        onExport={() => void downloadHandwritten()}
        previewReady={isReady}
        revision={project.revision}
        status={project.status}
      />

      {project.status === "processing" ? (
        <div className="processing-banner" role="status">
          <span className="spinner" />
          <div><strong>Extraction is in progress</strong><span>This page updates automatically.</span></div>
        </div>
      ) : null}

      {project.error ? (
        <div className="workspace-error" role="alert"><WarningIcon size={20} /><div><strong>Processing stopped</strong><span>{project.error.message}</span></div></div>
      ) : null}

      {mutationError ? (
        <div className="mutation-error" role="alert"><WarningIcon size={18} /><span>{mutationError}</span><button aria-label="Dismiss error" onClick={() => setMutationError(null)} type="button">×</button></div>
      ) : null}

      {stage === "review" && currentPage ? (
        <>
          <PageReviewer
            busyPage={refreshingPage}
            draftText={draftText}
            index={Math.min(pageIndex, pages.length - 1)}
            onDraftChange={(text) => setDrafts((current) => ({ ...current, [currentPage.number]: text }))}
            onApproveBlock={(blockId) => void approveBlock(blockId)}
            onIndexChange={setPageIndex}
            onSave={() => void saveCurrentPage()}
            onToggleSelect={() => {
              setSelectedPages((current) => {
                const next = new Set(current);
                if (next.has(currentPage.number)) next.delete(currentPage.number);
                else next.add(currentPage.number);
                return next;
              });
            }}
            page={currentPage}
            pageCount={pages.length}
            projectId={project.id}
            refreshing={refreshing}
            reviewingBlockId={busyAction?.startsWith("block:") ? busyAction.slice(6) : null}
            selected={selectedPages.has(currentPage.number)}
          />
          <div className="page-review-bar">
            <span aria-live="polite" className="review-progress">
              {pendingReviewBlocks.length === 0
                ? "All uncertain blocks reviewed"
                : `${pendingReviewBlocks.length} uncertain block${pendingReviewBlocks.length === 1 ? "" : "s"} remaining`}
            </span>
            <button className="button button-secondary" disabled={selectedPages.size === 0 || refreshing} onClick={() => void retrySelected()} type="button">
              {refreshing ? "Re-extracting…" : `Retry ${selectedPages.size || ""} selected page${selectedPages.size === 1 ? "" : "s"}`}
            </button>
            <button className="button button-primary" disabled={busyAction !== null || pages.length === 0 || pendingReviewBlocks.length > 0} onClick={() => void submitReview()} type="button">
              {busyAction === "confirm" ? <><span className="spinner" /> Submitting…</> : <><CheckIcon size={17} /> Submit for handwriting</>}
            </button>
          </div>
        </>
      ) : stage === "finalize" ? (
        <BookStudio
          busy={busyAction === "settings"}
          deleting={busyAction === "delete"}
          onApply={applySettings}
          onDelete={removeProject}
          personas={personas}
          project={project}
        />
      ) : (
        <div className="review-empty"><FileIcon size={28} /><h2>No readable pages yet.</h2></div>
      )}
    </main>
  );
}
