"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Persona, ProjectDocument, RenderSettings } from "@homeworker/contracts";

import { A4Preview } from "@/components/a4-preview";
import { useAuth } from "@/components/auth-provider";
import { BlockEditor } from "@/components/block-editor";
import { CheckIcon, FileIcon, RefreshIcon, WarningIcon } from "@/components/icons";
import { ProjectToolbar } from "@/components/project-toolbar";
import { RenderSettingsPanel } from "@/components/render-settings-panel";
import {
  confirmProject,
  deleteProject,
  fetchArtifact,
  getPersonas,
  getProject,
  isConflictError,
  HomeworkerApiError,
  saveBlob,
  updateBlock,
  updateProjectSettings,
} from "@/lib/api";
import { flattenBlocks, needsHumanReview } from "@/lib/project";
import { forgetProject, rememberProject } from "@/lib/recent-projects";

const FALLBACK_PERSONAS: Persona[] = [
  { id: "scholar", name: "Scholar", description: "Thoughtful and steady", license: "SIL Open Font License 1.1" },
  { id: "casual", name: "Casual", description: "Loose and lively", license: "SIL Open Font License 1.1" },
  { id: "compact", name: "Compact", description: "Clear and space-efficient", license: "SIL Open Font License 1.1" },
];

type WorkspacePane = "review" | "style" | "preview";
type BlockFilter = "checks" | "all";

export function ReviewWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { hosted, loading: authLoading, session } = useAuth();
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [personas, setPersonas] = useState<Persona[]>(FALLBACK_PERSONAS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(() => new Set());
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [filter, setFilter] = useState<BlockFilter>("checks");
  const [activePane, setActivePane] = useState<WorkspacePane>("review");
  const [reloadToken, setReloadToken] = useState(0);

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

  const blocks = useMemo(() => project ? flattenBlocks(project.pages) : [], [project]);
  const reviewableBlocks = useMemo(() => blocks.filter((block) => needsHumanReview(block) || block.reviewed), [blocks]);
  const remainingBlocks = useMemo(
    () => reviewableBlocks.filter((block) => !block.reviewed && !acknowledgedIds.has(block.id)),
    [acknowledgedIds, reviewableBlocks],
  );
  const reviewedCount = reviewableBlocks.length - remainingBlocks.length;
  const progressPercent = reviewableBlocks.length === 0 ? 100 : Math.round((reviewedCount / reviewableBlocks.length) * 100);
  const visibleBlocks = filter === "checks" ? blocks.filter((block) => needsHumanReview(block) || acknowledgedIds.has(block.id)) : blocks;

  async function recoverConflict(message: string) {
    try {
      const fresh = await getProject(projectId);
      setProject(fresh);
      setAcknowledgedIds(new Set());
      setMutationError(message);
    } catch {
      setMutationError("This project changed elsewhere. Reload the page before continuing.");
    }
  }

  async function saveBlock(blockId: string, text: string) {
    if (!project) return;
    setBusyAction(`block:${blockId}`);
    setMutationError(null);
    try {
      const next = await updateBlock(project.id, blockId, text, project.revision);
      setProject(next);
      setAcknowledgedIds((current) => new Set(current).add(blockId));
    } catch (error) {
      if (isConflictError(error)) {
        await recoverConflict("A newer revision was loaded. Please check your correction and try again.");
      } else {
        setMutationError(error instanceof HomeworkerApiError ? error.message : "The correction could not be saved.");
      }
      throw error;
    } finally {
      setBusyAction(null);
    }
  }

  function acknowledgeBlock(blockId: string) {
    setAcknowledgedIds((current) => new Set(current).add(blockId));
  }

  async function applySettings(settings: RenderSettings) {
    if (!project) return;
    setBusyAction("settings");
    setMutationError(null);
    try {
      const next = await updateProjectSettings(project.id, settings, project.revision);
      setProject(next);
    } catch (error) {
      if (isConflictError(error)) {
        await recoverConflict("A newer revision was loaded. Reapply your page settings.");
      } else {
        setMutationError(error instanceof HomeworkerApiError ? error.message : "Page settings could not be applied.");
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function finishReview() {
    if (!project || remainingBlocks.length > 0) return;
    setBusyAction("confirm");
    setMutationError(null);
    try {
      const next = await confirmProject(
        project.id,
        project.revision,
        [...acknowledgedIds],
      );
      setProject(next);
      setAcknowledgedIds(new Set());
    } catch (error) {
      if (isConflictError(error)) {
        await recoverConflict("The document changed during review. Recheck the updated blocks before confirming.");
      } else {
        setMutationError(error instanceof HomeworkerApiError ? error.message : "The review could not be confirmed.");
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function removeProject() {
    if (!project) return;
    const confirmed = window.confirm(`Delete “${project.filename}” and its ${hosted ? "private stored source" : "local source file"}? This cannot be undone.`);
    if (!confirmed) return;
    setBusyAction("delete");
    setMutationError(null);
    try {
      await deleteProject(project.id, project.revision);
      forgetProject(project.id);
      router.push("/");
      router.refresh();
    } catch (error) {
      if (isConflictError(error)) {
        await recoverConflict("The project changed before deletion. Review the latest revision, then delete again.");
      } else {
        setMutationError(error instanceof HomeworkerApiError ? error.message : "The local project could not be deleted.");
      }
    } finally {
      setBusyAction(null);
    }
  }

  function jumpToNextCheck() {
    const next = remainingBlocks[0];
    if (!next) return;
    setFilter("checks");
    setSelectedBlockId(next.id);
    document.getElementById(`block-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function downloadHandwritten() {
    if (!project || project.status !== "ready") return;
    setBusyAction("download:handwritten");
    setMutationError(null);
    try {
      saveBlob(await fetchArtifact(project.id, project.revision, "handwritten_pdf"));
    } catch (error) {
      setMutationError(error instanceof HomeworkerApiError ? error.message : "The export could not be prepared.");
    } finally {
      setBusyAction(null);
    }
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

  const previewAvailable = project.status !== "processing" && project.status !== "failed" && blocks.length > 0;
  const exportReady = project.status === "ready";
  return (
    <main className="project-app">
      <ProjectToolbar
        downloading={busyAction === "download:handwritten"}
        filename={project.filename}
        onExport={() => void downloadHandwritten()}
        previewReady={exportReady}
        revision={project.revision}
        status={project.status}
      />

      <nav aria-label="Workspace views" className="mobile-workspace-tabs">
        {(["review", "style", "preview"] as const).map((pane) => (
          <button aria-pressed={activePane === pane} className={activePane === pane ? "is-active" : ""} key={pane} onClick={() => setActivePane(pane)} type="button">
            {pane === "review" ? "Review" : pane === "style" ? "Style" : "Preview"}
          </button>
        ))}
      </nav>

      {project.status === "processing" ? (
        <div className="processing-banner" role="status">
          <span className="spinner" />
          <div><strong>Extraction is in progress</strong><span>This page updates automatically. Your source is treated as content, never as an instruction.</span></div>
        </div>
      ) : null}

      {project.error ? (
        <div className="workspace-error" role="alert"><WarningIcon size={20} /><div><strong>Processing stopped</strong><span>{project.error.message}</span></div></div>
      ) : null}

      {mutationError ? (
        <div className="mutation-error" role="alert"><WarningIcon size={18} /><span>{mutationError}</span><button aria-label="Dismiss error" onClick={() => setMutationError(null)} type="button">×</button></div>
      ) : null}

      <div className="workspace-grid">
        <section className={`review-column mobile-pane ${activePane === "review" ? "is-mobile-active" : ""}`}>
          <div className="review-header">
            <div>
              <span className="eyebrow">Content review</span>
              <h1>Check before you print</h1>
              <p>Every word below comes from the source. Correct uncertainty; nothing is rewritten automatically.</p>
            </div>
            <div className="review-progress-card">
              <div className="progress-copy"><strong>{progressPercent}%</strong><span>{remainingBlocks.length === 0 ? "Checks complete" : `${remainingBlocks.length} left to check`}</span></div>
              <div aria-label={`${progressPercent}% of required review completed`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progressPercent} className="progress-track" role="progressbar"><span style={{ width: `${progressPercent}%` }} /></div>
            </div>
          </div>

          <div className="review-controls">
            <div className="filter-tabs" role="group" aria-label="Filter extracted blocks">
              <button aria-pressed={filter === "checks"} className={filter === "checks" ? "is-active" : ""} onClick={() => setFilter("checks")} type="button">Needs attention <span>{remainingBlocks.length}</span></button>
              <button aria-pressed={filter === "all"} className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")} type="button">All blocks <span>{blocks.length}</span></button>
            </div>
            {remainingBlocks.length > 0 ? <button className="jump-button" onClick={jumpToNextCheck} type="button">Next check →</button> : null}
          </div>

          {visibleBlocks.length > 0 ? (
            <div className="block-list">
              {visibleBlocks.map((block, index) => {
                const showPageDivider = index === 0 || visibleBlocks[index - 1]?.documentPage !== block.documentPage;
                return (
                  <div id={`block-${block.id}`} key={block.id}>
                    {showPageDivider ? <div className="page-divider"><span>Page {block.documentPage}</span></div> : null}
                    <BlockEditor
                      acknowledged={acknowledgedIds.has(block.id)}
                      block={block}
                      busy={busyAction === `block:${block.id}`}
                      isSelected={selectedBlockId === block.id}
                      onAcknowledge={acknowledgeBlock}
                      onSave={saveBlock}
                    />
                  </div>
                );
              })}
            </div>
          ) : project.status === "processing" ? (
            <div className="review-empty"><span className="spinner spinner-large" /><h2>Finding content blocks…</h2><p>Clear sections will appear here as processing completes.</p></div>
          ) : filter === "checks" && blocks.length > 0 ? (
            <div className="review-empty success"><CheckIcon size={28} /><h2>No uncertain blocks left.</h2><p>Open “All blocks” for a final scan, then confirm the review.</p></div>
          ) : (
            <div className="review-empty"><FileIcon size={28} /><h2>No readable content was found.</h2><p>Try a clearer scan or a PDF with selectable text.</p><Link className="button button-secondary button-small" href="/">Upload another file</Link></div>
          )}

          {project.status === "needs_review" ? (
            <div className="confirm-review-bar">
              <div>
                <strong>{remainingBlocks.length === 0 ? "Ready to confirm" : "Review is not finished"}</strong>
                <span>{remainingBlocks.length === 0 ? "Confirming locks this reviewed revision for export." : `Check ${remainingBlocks.length} remaining ${remainingBlocks.length === 1 ? "block" : "blocks"} before export.`}</span>
              </div>
              <button className="button button-primary" disabled={remainingBlocks.length > 0 || busyAction === "confirm"} onClick={finishReview} type="button">
                {busyAction === "confirm" ? <><span className="spinner" /> Confirming…</> : <><CheckIcon size={17} /> Confirm review</>}
              </button>
            </div>
          ) : project.status === "ready" ? (
            <div className="confirmed-banner"><CheckIcon size={20} /><div><strong>Reviewed revision confirmed</strong><span>Downloads are unlocked. Any later edit creates a new revision to review.</span></div></div>
          ) : null}
        </section>

        <aside className="studio-column" aria-label="Page design and preview">
          <div className={`style-pane mobile-pane ${activePane === "style" ? "is-mobile-active" : ""}`}>
            <RenderSettingsPanel
              busy={busyAction === "settings"}
              deleting={busyAction === "delete"}
              key={`${project.settings.personaId}-${project.settings.seed}-${project.settings.inkColor}-${project.settings.paperStyle}-${project.settings.marginMm}-${project.settings.lineSpacing}`}
              onApply={applySettings}
              onDelete={removeProject}
              personas={personas}
              settings={project.settings}
            />
          </div>
          <div className={`preview-pane mobile-pane ${activePane === "preview" ? "is-mobile-active" : ""}`}>
            <A4Preview
              exportReady={exportReady}
              filename={project.filename}
              previewAvailable={previewAvailable}
              projectId={project.id}
              revision={project.revision}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}
