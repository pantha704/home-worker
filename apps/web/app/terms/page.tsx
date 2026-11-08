import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Acceptable use, product boundaries, and the limits of the free Homeworker hosted beta.",
};

export default function TermsPage() {
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
        <span className="eyebrow">Terms of use</span>
        <h1>Notes you review, on terms you can read.</h1>
        <p className="legal-lede">
          These terms cover the invite-only Homeworker hosted beta. Using the beta means you accept
          them. If you do not, do not use the service.
        </p>
        <p className="muted-caption">Last updated 8 November 2026</p>

        <h2>Acceptable use</h2>
        <p>You may:</p>
        <ul>
          <li>Convert documents you own or are authorised to process into reviewable notes.</li>
          <li>Print those notes after you have checked every page.</li>
          <li>Use the bundled handwriting personas, which are generic licensed fonts.</li>
        </ul>
        <p>You may not:</p>
        <ul>
          <li>
            Reproduce a specific person&rsquo;s handwriting or signature, or use the service for
            forgery or impersonation.
          </li>
          <li>
            Present generated pages as work a student wrote by hand where that would mislead a
            school, university, or examiner.
          </li>
          <li>Upload identity documents such as passports, licences, or national ID cards.</li>
          <li>Process other people&rsquo;s documents without their permission, or any unlawful content.</li>
          <li>
            Attempt to reach another account&rsquo;s data, bypass quotas, or otherwise interfere with
            the service.
          </li>
        </ul>

        <h2>Product boundaries</h2>
        <p>
          Homeworker renders <strong>handwriting-style</strong> notes from your own documents using
          open licensed fonts. It does <strong>not</strong> clone or imitate a real person&rsquo;s
          handwriting or signature, and it does <strong>not</strong> submit, upload, or file
          schoolwork anywhere on your behalf. There is no integration with any school or exam
          portal, and there never will be one under these terms.
        </p>
        <p>
          Extraction is a draft. OCR is fallible, especially on handwriting, and the interface
          surfaces its uncertainty so you can correct it. You are responsible for the text you
          confirm and for anything you print from it.
        </p>

        <h2>The beta</h2>
        <p>
          The hosted service is an <strong>invite-only, free-tier beta</strong>. It is provided as
          is, with <strong>no service-level agreement</strong>: it may be slow, cold-start, hit
          free-plan quotas, change, or be withdrawn at any time. Projects are deleted automatically
          after 14 days. Current limits are 20 active projects, 100 MiB of stored sources and
          exports per account, 10 MiB per upload, and 30 pages per document.
        </p>

        <h2>Your content</h2>
        <p>
          You keep ownership of everything you upload. You grant only the permission needed to
          store, process, and return it to you as described in the{" "}
          <Link href="/privacy">privacy notice</Link>. You confirm you have the right to process
          each document you upload.
        </p>

        <h2>No warranty</h2>
        <p>
          The service and the software behind it come with no warranty, to the extent the AGPL-3.0-only
          licence and applicable law allow. It is a study aid, not a records system: keep your own
          copies of anything that matters.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, the operator is not liable for indirect,
          incidental, special, or consequential loss, or for lost data, lost marks, lost profits, or
          missed deadlines arising from use of the beta. Where liability cannot be excluded, it is
          limited to the amount you paid for the service, which for the free beta is zero. Nothing
          here excludes liability that the law does not allow to be excluded.
        </p>

        <h2>Changes</h2>
        <p>
          These terms may change as the beta changes; the date at the top is the version in force.
          Continuing to use the service after a change means you accept the updated terms.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of <strong>[operator to confirm jurisdiction]</strong>,
          and disputes are subject to the courts of that place. This placeholder is intentional:
          the operator has not yet confirmed a jurisdiction, and no other jurisdiction is implied.
        </p>

        <h2>Licence and contact</h2>
        <p>
          Homeworker is free software licensed <strong>AGPL-3.0-only</strong>. If you run a
          modified copy as a network service, you must offer its users the corresponding source.
          Questions: <a href="mailto:prathamjaiswal204@gmail.com">prathamjaiswal204@gmail.com</a>,
          operated by Pratham Jaiswal.
        </p>
      </article>

      <SiteFooter />
    </main>
  );
}
