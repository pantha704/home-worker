import type { Metadata } from "next";
import { Suspense } from "react";

import { ProjectRoute } from "@/components/project-route";

export const metadata: Metadata = { title: "Review notes" };

export default function ProjectPage() {
  return (
    <Suspense fallback={<main className="centered-state"><span className="spinner spinner-large" /><h1>Opening project…</h1></main>}>
      <ProjectRoute />
    </Suspense>
  );
}
