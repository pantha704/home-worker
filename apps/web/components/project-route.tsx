"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ReviewWorkspace } from "@/components/review-workspace";

export function ProjectRoute() {
  const projectId = useSearchParams().get("id")?.trim();
  if (!projectId) {
    return (
      <main className="centered-state">
        <h1>No project was selected.</h1>
        <p>Return home and open or upload a project.</p>
        <Link className="button button-primary" href="/">Return home</Link>
      </main>
    );
  }
  return <ReviewWorkspace projectId={projectId} />;
}
