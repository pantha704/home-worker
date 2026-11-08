import {
  HOSTED_MAX_UPLOAD_BYTES,
  MAX_ARCHIVE_BYTES,
  MAX_UPLOAD_BYTES,
  isSupportedMimeType,
} from "@homeworker/contracts";

export { HOSTED_MAX_UPLOAD_BYTES, MAX_ARCHIVE_BYTES, MAX_UPLOAD_BYTES };

const SUPPORTED_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg"]);

export interface FileValidationResult {
  valid: boolean;
  message: string | null;
}

export function validateUpload(
  file: File,
  maxBytes: number = MAX_UPLOAD_BYTES,
): FileValidationResult {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (!isSupportedMimeType(file.type) || !SUPPORTED_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      message: "Choose a PDF, PNG, JPG, or JPEG file.",
    };
  }

  if (file.size === 0) {
    return { valid: false, message: "This file is empty." };
  }

  if (file.size > maxBytes) {
    return {
      valid: false,
      message: `This file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit.`,
    };
  }

  return { valid: true, message: null };
}

export function clampSeed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(2_147_483_647, Math.max(0, Math.round(value)));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
