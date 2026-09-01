"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthPanel } from "@/components/auth-panel";
import { FileIcon, UploadIcon, WarningIcon } from "@/components/icons";
import { useAuth } from "@/components/auth-provider";
import { createProject, HomeworkerApiError } from "@/lib/api";
import { createBrowserProject, importBrowserArchive } from "@/lib/browser-local";
import { isBrowserPreviewMode } from "@/lib/config";
import { rememberProject } from "@/lib/recent-projects";
import {
  formatFileSize,
  HOSTED_MAX_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  validateUpload,
} from "@/lib/validation";

type UploadState = "idle" | "selected" | "preparing" | "uploading" | "finalizing" | "error";

export function UploadDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef<AbortController>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const router = useRouter();
  const { hosted, loading, session } = useAuth();
  const browserPreview = isBrowserPreviewMode();
  const maxBytes = hosted ? HOSTED_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES;

  useEffect(() => () => processingRef.current?.abort(), []);

  function selectFile(file: File | undefined) {
    if (!file) return;
    if (browserPreview && file.type !== "application/pdf") {
      setSelectedFile(null);
      setMessage("Quick preview supports text-layer PDF files only. Run the full local application for PNG, JPEG, or scanned-document OCR.");
      setState("error");
      return;
    }
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
    processingRef.current = controller;
    setState("preparing");
    setMessage(browserPreview ? "Preparing private browser processing…" : "Sending the document to your local OCR service…");

    try {
      const project = browserPreview
        ? await createBrowserProject(selectedFile, {
            signal: controller.signal,
            onProcessing: () => setState("uploading"),
            onProgress: ({ completed, total }) => setMessage(`Processing page ${completed} of ${total}…`),
            onFinalizing: () => {
              setState("finalizing");
              setMessage("Finalizing local project…");
            },
          })
        : await createProject(selectedFile, controller.signal);
      rememberProject({ id: project.id, filename: project.filename, updatedAt: project.updatedAt });
      router.push(`/project?id=${encodeURIComponent(project.id)}`);
    } catch (error) {
      if (controller.signal.aborted) {
        setMessage("Processing cancelled. Your source file was not saved.");
        setState("selected");
        return;
      }
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
    } finally {
      if (processingRef.current === controller) processingRef.current = null;
    }
  }

  function cancelProcessing() {
    processingRef.current?.abort();
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
        <span className={hosted ? "hosted-pill" : "local-pill"}><span /> {hosted ? "Experimental hosted beta" : browserPreview ? "Quick PDF preview" : "Full local OCR"}</span>
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
          accept={browserPreview ? ".pdf,application/pdf" : ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"}
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
            <small id="upload-help">{browserPreview ? "Text-layer PDF" : "PDF, PNG, or JPG"} · Up to {Math.round(maxBytes / 1024 / 1024)} MB</small>
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
        disabled={!selectedFile || state === "preparing" || state === "finalizing"}
        onClick={state === "uploading" ? cancelProcessing : startUpload}
        type="button"
      >
        {state === "uploading" ? "Cancel processing" : state === "preparing" ? "Preparing…" : state === "finalizing" ? "Finalizing…" : "Turn into handwritten notes"}
      </button>

      <p className="upload-assurance"><span>✓</span> Your wording stays unchanged until you edit it.</p>
      {browserPreview ? (
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
