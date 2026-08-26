import { confidenceLabel } from "@/lib/project";

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const label = confidenceLabel(confidence);
  const variant = label.toLowerCase();
  return (
    <span
      aria-label={`${Math.round(confidence * 100)} percent extraction confidence, ${label}`}
      className={`confidence-badge confidence-${variant}`}
      title="Extraction confidence"
    >
      <span /> {Math.round(confidence * 100)}% {label}
    </span>
  );
}
