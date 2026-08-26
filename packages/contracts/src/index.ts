export type ProjectStatus =
  | "processing"
  | "needs_review"
  | "ready"
  | "failed";

export type BlockKind =
  | "heading"
  | "paragraph"
  | "list_item"
  | "equation"
  | "table"
  | "figure"
  | "unknown";

export type WarningSeverity = "info" | "warning" | "error";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractionWarning {
  code: string;
  message: string;
  severity: WarningSeverity;
}

export interface SourceRegion {
  pageNumber: number;
  bbox: BoundingBox | null;
  extractor: "native_pdf" | "tesseract" | "manual";
}

export interface DocumentBlock {
  id: string;
  kind: BlockKind;
  text: string;
  confidence: number;
  reviewed: boolean;
  source: SourceRegion;
  warnings: ExtractionWarning[];
}

export interface DocumentPage {
  number: number;
  widthPoints: number;
  heightPoints: number;
  blocks: DocumentBlock[];
}

export type PersonaId = "scholar" | "casual" | "compact";
export type PaperStyle = "plain" | "ruled" | "grid";

export interface RenderSettings {
  personaId: PersonaId;
  seed: number;
  inkColor: string;
  paperStyle: PaperStyle;
  marginMm: number;
  lineSpacing: number;
}

export interface ProjectDocument {
  id: string;
  filename: string;
  mimeType: string;
  sha256: string;
  status: ProjectStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  pages: DocumentPage[];
  settings: RenderSettings;
  error: { code: string; message: string } | null;
}

export interface ProjectSummary {
  id: string;
  filename: string;
  mimeType: string;
  status: ProjectStatus;
  revision: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectList {
  items: ProjectSummary[];
  total: number;
}

export interface Persona {
  id: PersonaId;
  name: string;
  description: string;
  license: string;
}

export interface ArtifactManifest {
  schemaVersion: "1.0";
  projectId: string;
  projectRevision: number;
  sourceSha256: string;
  artifactKind: "handwritten_pdf" | "companion_pdf" | "companion_text";
  artifactSha256: string;
  artifactBytes: number;
  generatedAt: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}
