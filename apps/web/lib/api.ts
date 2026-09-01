import type {
  ApiError as ApiErrorBody,
  ArtifactManifest,
  Persona,
  ProjectDocument,
  ProjectList,
  RenderSettings,
} from "@homeworker/contracts";

import { getApiBaseUrl, isHostedMode } from "@/lib/config";
import { clearBrowserSession, getAccessToken } from "@/lib/supabase";

type ErrorDetails = Record<string, unknown> | undefined;

export class HomeworkerApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: ErrorDetails;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      requestId?: string | null;
      details?: ErrorDetails;
    },
  ) {
    super(message);
    this.name = "HomeworkerApiError";
    this.status = options.status;
    this.code = options.code ?? "request_failed";
    this.requestId = options.requestId ?? null;
    this.details = options.details;
  }
}

function isApiError(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string",
  );
}

async function errorFromResponse(response: Response): Promise<HomeworkerApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The fallback below still gives the user an actionable status.
  }
  const requestId = response.headers.get("x-request-id");
  if (isApiError(body)) {
    return new HomeworkerApiError(body.error.message, {
      status: response.status,
      code: body.error.code,
      requestId: body.error.requestId || requestId,
      details: body.error.details,
    });
  }
  return new HomeworkerApiError(`The server returned ${response.status}.`, {
    status: response.status,
    requestId,
  });
}

async function authorizedFetch(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", headers.get("Accept") ?? "application/json");
  if (!(init.body instanceof FormData) && init.body != null) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  }
  if (init.method && ["POST", "PATCH", "PUT", "DELETE"].includes(init.method)) {
    headers.set("X-Homeworker-Client", "web");
  }
  const token = await getAccessToken();
  if (isHostedMode()) {
    if (!token) {
      throw new HomeworkerApiError("Sign in to continue.", {
        status: 401,
        code: "AUTHENTICATION_REQUIRED",
      });
    }
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    signal,
  });
  if (response.status === 401) await clearBrowserSession();
  return response;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await authorizedFetch(path, init, signal);
  if (!response.ok) throw await errorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function createProject(
  file: File,
  signal?: AbortSignal,
): Promise<ProjectDocument> {
  const form = new FormData();
  form.append("file", file, file.name);
  return request<ProjectDocument>(
    "/v1/projects",
    {
      method: "POST",
      body: form,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    },
    signal,
  );
}

export async function listProjects(signal?: AbortSignal): Promise<ProjectList> {
  return request<ProjectList>("/v1/projects?limit=25&offset=0", {}, signal);
}

export async function getProject(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectDocument> {
  return request<ProjectDocument>(`/v1/projects/${encodeURIComponent(projectId)}`, {}, signal);
}

export async function getExtractionEvidence(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectDocument> {
  return request<ProjectDocument>(
    `/v1/projects/${encodeURIComponent(projectId)}/source.json`,
    {},
    signal,
  );
}

export async function updateBlock(
  projectId: string,
  blockId: string,
  text: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<ProjectDocument> {
  return request<ProjectDocument>(
    `/v1/projects/${encodeURIComponent(projectId)}/blocks/${encodeURIComponent(blockId)}`,
    { method: "PATCH", body: JSON.stringify({ text, expectedRevision }) },
    signal,
  );
}

export async function reviewBlock(
  projectId: string,
  blockId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<ProjectDocument> {
  return request<ProjectDocument>(
    `/v1/projects/${encodeURIComponent(projectId)}/blocks/${encodeURIComponent(blockId)}/review`,
    { method: "POST", body: JSON.stringify({ expectedRevision }) },
    signal,
  );
}

export async function updatePageText(
  projectId: string,
  pageNumber: number,
  text: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<ProjectDocument> {
  return request<ProjectDocument>(
    `/v1/projects/${encodeURIComponent(projectId)}/pages/${pageNumber}`,
    { method: "PATCH", body: JSON.stringify({ text, expectedRevision }) },
    signal,
  );
}

export async function retryPages(
  projectId: string,
  pageNumbers: number[],
  expectedRevision: number,
  options: { forceOcr?: boolean; signal?: AbortSignal } = {},
): Promise<ProjectDocument> {
  return request<ProjectDocument>(
    `/v1/projects/${encodeURIComponent(projectId)}/pages/retry`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedRevision,
        pageNumbers,
        forceOcr: options.forceOcr ?? false,
      }),
    },
    options.signal,
  );
}

export async function fetchPngObjectUrl(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await authorizedFetch(path, { headers: { Accept: "image/png" } }, signal);
  if (!response.ok) throw await errorFromResponse(response);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function confirmProject(
  projectId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<ProjectDocument> {
  return request<ProjectDocument>(
    `/v1/projects/${encodeURIComponent(projectId)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify({ expectedRevision }),
    },
    signal,
  );
}

export async function updateProjectSettings(
  projectId: string,
  settings: RenderSettings,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<ProjectDocument> {
  return request<ProjectDocument>(
    `/v1/projects/${encodeURIComponent(projectId)}/settings`,
    { method: "PATCH", body: JSON.stringify({ ...settings, expectedRevision }) },
    signal,
  );
}

export async function getPersonas(signal?: AbortSignal): Promise<Persona[]> {
  const response = await fetch(`${getApiBaseUrl()}/v1/personas`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as Persona[];
}

export async function deleteProject(
  projectId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<void> {
  return request<void>(
    `/v1/projects/${encodeURIComponent(projectId)}?expectedRevision=${expectedRevision}`,
    { method: "DELETE" },
    signal,
  );
}

export type ArtifactKind = "handwritten_pdf" | "companion_pdf" | "companion_text";

export interface ArtifactDownload {
  blob: Blob;
  filename: string;
  sha256: string | null;
}

function artifactPath(projectId: string, revision: number, kind: ArtifactKind): string {
  const endpoint = kind === "handwritten_pdf"
    ? "export.pdf"
    : kind === "companion_pdf"
      ? "companion.pdf"
      : "companion.txt";
  return `/v1/projects/${encodeURIComponent(projectId)}/${endpoint}?revision=${revision}`;
}

export async function fetchArtifact(
  projectId: string,
  revision: number,
  kind: ArtifactKind,
  signal?: AbortSignal,
): Promise<ArtifactDownload> {
  const response = await authorizedFetch(
    artifactPath(projectId, revision, kind),
    { headers: { Accept: kind === "companion_text" ? "text/plain" : "application/pdf" } },
    signal,
  );
  if (!response.ok) throw await errorFromResponse(response);
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
    ?? (kind === "companion_text" ? "homeworker-notes.txt" : "homeworker-notes.pdf");
  return {
    blob: await response.blob(),
    filename,
    sha256: response.headers.get("x-artifact-sha256"),
  };
}

export async function getArtifactManifest(
  projectId: string,
  revision: number,
  kind: ArtifactKind = "handwritten_pdf",
  signal?: AbortSignal,
): Promise<ArtifactManifest> {
  return request<ArtifactManifest>(
    `/v1/projects/${encodeURIComponent(projectId)}/manifest.json?revision=${revision}&kind=${kind}`,
    {},
    signal,
  );
}

export function saveBlob(download: ArtifactDownload): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function isConflictError(error: unknown): boolean {
  return error instanceof HomeworkerApiError && error.status === 409;
}
