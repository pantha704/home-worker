"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthPanel } from "@/components/auth-panel";
import { FileIcon, UploadIcon, WarningIcon } from "@/components/icons";
import { useAuth } from "@/components/auth-provider";
import { createProject, HomeworkerApiError } from "@/lib/api";
import { createBrowserProject, importBrowserArchive } from "@/lib/browser-local";
import { rememberProject } from "@/lib/recent-projects";
import {
  formatFileSize,
  HOSTED_MAX_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  validateUpload,
} from "@/lib/validation";

type UploadState = "idle" | "selected" | "uploading" | "error";

export function UploadDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const router = useRouter();
  const { hosted, loading, session } = useAuth();
  const maxBytes = hosted ? HOSTED_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES;

  function selectFile(file: File | undefined) {
    if (!file) return;
    const validation = validateUpload(file, maxBytes);
    if (!validation.valid) {
      setSelectedFile(null);
      setMessage(validation.message);
      setState("error");
      return;
    }
    setSelectedFile(file);
    setMessage(null);
    setState("selected");
  }

  async function startUpload() {
    if (!selectedFile || state === "uploading") return;
    const controller = new AbortController();
    setState("uploading");
    setMessage(hosted ? "Uploading securely and checking the document…" : "Processing privately in this browser…");

    try {
      const project = hosted
        ? await createProject(selectedFile, controller.signal)
        : await createBrowserProject(selectedFile);
      rememberProject({ id: project.id, filename: project.filename, updatedAt: project.updatedAt });
      router.push(`/project?id=${encodeURIComponent(project.id)}`);
    } catch (error) {
      const detail =
        error instanceof HomeworkerApiError
          ? error.message
          : hosted
            ? "Could not reach the Homeworker service."
            : error instanceof Error
              ? error.message
              : "This browser could not process the document locally.";
      setMessage(detail);
      setState("error");
    }
  }

  function reset() {
    setSelectedFile(null);
    setMessage(null);
    setState("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function restoreArchive(file: File | undefined) {
    if (!file) return;
    setState("uploading");
    setMessage("Verifying and restoring the local backup…");
    try {
      const project = await importBrowserArchive(new Uint8Array(await file.arrayBuffer()));
      rememberProject({ id: project.id, filename: project.filename, updatedAt: project.updatedAt });
      router.push(`/project?id=${encodeURIComponent(project.id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The backup could not be restored.");
      setState("error");
    }
  }

  if (loading) {
    return <div className="upload-card auth-card" id="upload"><span className="spinner spinner-large" /><h2>Checking your session…</h2></div>;
  }
  if (hosted && !session) return <AuthPanel />;

  return (
    <div className="upload-card" id="upload">
      <div className="upload-card-heading">
        <span className="eyebrow">Start with your source</span>
        <span className={hosted ? "hosted-pill" : "local-pill"}><span /> {hosted ? "Private cloud" : "Runs locally"}</span>
      </div>

      <div
        aria-describedby="upload-help"
        className={`dropzone ${isDragging ? "is-dragging" : ""} ${state === "error" ? "has-error" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          selectFile(event.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          className="sr-only"
          id="source-file"
          onChange={(event) => selectFile(event.target.files?.[0])}
          type="file"
        />

        {selectedFile ? (
          <div className="selected-file">
            <span className="file-tile"><FileIcon size={26} /></span>
            <div>
              <strong>{selectedFile.name}</strong>
              <span>{formatFileSize(selectedFile.size)} · Ready to process</span>
            </div>
            <button className="text-button" disabled={state === "uploading"} onClick={reset} type="button">Change</button>
          </div>
        ) : (
          <label className="dropzone-label" htmlFor="source-file">
            <span className="upload-icon"><UploadIcon size={27} /></span>
            <strong>Drop your notes here</strong>
            <span>or <u>choose a file</u> from your device</span>
            <small id="upload-help">PDF, PNG, or JPG · Up to {Math.round(maxBytes / 1024 / 1024)} MB</small>
          </label>
        )}
      </div>

      {message ? (
        <div aria-live="polite" className={`upload-message ${state === "error" ? "error" : ""}`} role="status">
          {state === "error" && <WarningIcon size={17} />}
          <span>{message}</span>
        </div>
      ) : null}

      <button
        className="button button-primary button-wide"
        disabled={!selectedFile || state === "uploading"}
        onClick={startUpload}
        type="button"
      >
        {state === "uploading" ? <><span className="spinner" /> Creating your project…</> : "Turn into handwritten notes"}
      </button>

      <p className="upload-assurance"><span>✓</span> Your wording stays unchanged until you edit it.</p>
      {!hosted ? (
        <label className="text-button" htmlFor="project-archive">
          Restore .homeworker backup
          <input
            accept=".homeworker,application/vnd.homeworker.project+json"
            className="sr-only"
            id="project-archive"
            onChange={(event) => void restoreArchive(event.target.files?.[0])}
            type="file"
          />
        </label>
      ) : null}
    </div>
  );
}
