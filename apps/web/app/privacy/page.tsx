import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What the Homeworker hosted beta stores, where it lives, how long it is kept, and how deletion works.",
};

export default function PrivacyPage() {
  return (
    <main>
      <header className="site-header">
        <div className="site-header-inner">
          <Brand />
          <nav aria-label="Secondary navigation" className="site-nav">
            <Link href="/">Back to Homeworker</Link>
          </nav>
        </div>
      </header>

      <article className="page-shell legal-page">
        <span className="eyebrow">Privacy</span>
        <h1>What Homeworker keeps, and how to get rid of it.</h1>
        <p className="legal-lede">
          Homeworker turns documents you already have into printable, reviewable notes. This page
          covers the invite-only hosted beta: what is stored, where it lives, how long it is kept,
          and what is deliberately not done with it.
        </p>
        <p className="muted-caption">Last updated 8 November 2026</p>

        <h2>What is stored</h2>
        <ul>
          <li>The email address you sign in with.</li>
          <li>The source file you upload (PDF, PNG, or JPEG).</li>
          <li>The text extracted from that file, including the confidence evidence you review.</li>
          <li>The sheets you generate from it, the exported PDFs, and their checksums.</li>
          <li>Project names, timestamps, and the revisions you confirm.</li>
        </ul>

        <h2>Where it lives</h2>
        <p>
          Documents and generated files are held in a <strong>private Supabase Storage bucket</strong>.
          It is not a public bucket and it is not served directly to browsers. Database rows and
          stored objects are scoped to one account, and every read or write goes through the
          owner-scoped API after your session is verified, so a second signed-in account cannot
          reach your projects. Traffic to the hosted service is HTTPS only.
        </p>

        <h2>How long it is kept</h2>
        <p>
          Projects are retained for <strong>14 days</strong> and then deleted automatically,
          including the stored source file and generated exports. The beta runs on free
          infrastructure, so treat it as scratch space rather than an archive: download anything
          you need to keep before the retention window ends.
        </p>

        <h2>Deletion</h2>
        <p>
          Deleting a project removes the database row <strong>and</strong> the stored object in the
          same operation. If storage deletion fails transiently, the job stays in a durable queue
          and is retried, so a failure does not silently leave your file behind. To have your
          account and every project in it removed, email the contact address below.
        </p>

        <h2>Sign-in</h2>
        <p>
          Sign-in is passwordless: you receive a single-use email link, and the session lives in
          your browser. Homeworker never sees or stores a password for your email account.
        </p>

        <h2>What is not done</h2>
        <ul>
          <li>Your documents are <strong>not</strong> used to train or fine-tune any model.</li>
          <li>There is <strong>no third-party analytics</strong>, advertising, or tracking script on the site.</li>
          <li>Documents are not sold, rented, or shared with other users.</li>
          <li>
            OCR runs inside the Homeworker API with Tesseract; your file is not handed to an
            external AI provider for processing.
          </li>
        </ul>

        <h2>Licence and contact</h2>
        <p>
          Homeworker is free software licensed <strong>AGPL-3.0-only</strong>. Questions about this
          policy, or a deletion request: <a href="mailto:prathamjaiswal204@gmail.com">prathamjaiswal204@gmail.com</a>,
          operated by Pratham Jaiswal.
        </p>
        <p>
          See also the <Link href="/terms">terms of use</Link>.
        </p>
      </article>

      <SiteFooter />
    </main>
  );
}
