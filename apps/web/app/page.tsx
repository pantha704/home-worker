import { CheckIcon, ShieldIcon, SparkIcon } from "@/components/icons";
import { RecentProjects } from "@/components/recent-projects";
import { SiteHeader } from "@/components/site-header";
import { UploadDropzone } from "@/components/upload-dropzone";
import { isHostedMode } from "@/lib/config";

const steps = [
  { number: "01", title: "Upload", copy: "Add a PDF or a clear photo of typed or handwritten notes." },
  { number: "02", title: "Review", copy: "Check uncertain words with confidence and source details in view." },
  { number: "03", title: "Print", copy: "Choose a licensed writing style and export an exact A4 PDF." },
];

export default function HomePage() {
  const hosted = isHostedMode();
  return (
    <main>
      <SiteHeader />
      <section className="hero-shell">
        <div className="hero-copy">
          <div className="hero-kicker"><SparkIcon size={16} /> Built for careful study notes</div>
          <h1>From source pages to notes that <em>feel written.</em></h1>
          <p className="hero-lead">
            Read PDFs and handwriting, review every uncertain detail, then lay it out in a fresh, licensed handwriting style—ready for A4 printing.
          </p>
          <ul className="hero-checks" aria-label="Homeworker benefits">
            <li><CheckIcon /> No silent rewriting</li>
            <li><CheckIcon /> {hosted ? "Free-tier private processing" : "Free, local-first processing"}</li>
            <li><CheckIcon /> Accessible typed copy included</li>
          </ul>
        </div>
        <UploadDropzone />
        <div aria-hidden="true" className="hero-scribble">review → render → print</div>
      </section>

      <div className="page-shell">
        <RecentProjects />

        <section aria-labelledby="how-heading" className="how-section" id="how-it-works">
          <div className="section-intro">
            <span className="eyebrow">A transparent workflow</span>
            <h2 id="how-heading">You stay in control of every word.</h2>
            <p>Extraction is a draft, not a hidden decision. Homeworker surfaces uncertainty before anything is ready to print.</p>
          </div>
          <ol className="step-grid">
            {steps.map((step) => (
              <li key={step.number}>
                <span className="step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="privacy-heading" className="trust-banner" id="privacy">
          <span className="trust-icon"><ShieldIcon size={26} /></span>
          <div>
            <span className="eyebrow">Made for responsible use</span>
            <h2 id="privacy-heading">{hosted ? "Private by account, deleted automatically." : "Your notes, processed on your machine."}</h2>
            <p>{hosted ? "Files are stored privately in Supabase Free, processed by the bounded OCR service, and scheduled for deletion after 14 days. Built-in personas are licensed styles—not copied handwriting or signatures." : "Files stay in your local Homeworker installation. Built-in personas are licensed styles—not copied handwriting or signatures. Use only content you have the right to process."}</p>
          </div>
        </section>
      </div>

      <footer className="site-footer">
        <div className="page-shell footer-inner">
          <span>Homeworker · {hosted ? "Free-tier hosted beta" : "Local-first document transformation"}</span>
          <span>Faithful by design.</span>
        </div>
      </footer>
    </main>
  );
}
