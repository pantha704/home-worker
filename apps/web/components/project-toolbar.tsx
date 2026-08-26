import Link from "next/link";

import { ArrowLeftIcon, DownloadIcon } from "@/components/icons";
import { Brand } from "@/components/brand";
import { safeProjectTitle } from "@/lib/project";

interface ProjectToolbarProps {
  downloading: boolean;
  filename: string;
  onExport: () => void;
  previewReady: boolean;
  revision: number;
  status: string;
}

export function ProjectToolbar({ downloading, filename, onExport, previewReady, revision, status }: ProjectToolbarProps) {
  const statusCopy = status === "processing" ? "Processing" : status === "needs_review" ? "Needs review" : status === "ready" ? "Ready to print" : "Paused";
  return (
    <header className="project-toolbar">
      <div className="toolbar-left">
        <Link aria-label="Back to home" className="back-button" href="/"><ArrowLeftIcon size={18} /></Link>
        <Brand compact />
        <span className="toolbar-divider" />
        <div className="project-title-group">
          <strong>{safeProjectTitle(filename)}</strong>
          <span>{filename} · Revision {revision}</span>
        </div>
      </div>
      <div className="toolbar-right">
        <span className={`project-status status-${status.replace("_", "-")}`}><span />{statusCopy}</span>
        <button className="button button-primary button-small" disabled={!previewReady || downloading} onClick={onExport} type="button">
          {downloading ? <span className="spinner" /> : <DownloadIcon size={17} />} Export
        </button>
      </div>
    </header>
  );
}
