import Link from "next/link";

/**
 * Shared footer for every page. `note` keeps the home page's runtime label
 * (hosted beta / browser preview / local install) without duplicating markup.
 */
export function SiteFooter({ note }: { note?: string }) {
  return (
    <footer className="site-footer">
      <div className="page-shell footer-inner">
        <span>Homeworker{note ? ` · ${note}` : ""}</span>
        <nav aria-label="Legal" className="footer-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
        <span>Faithful by design.</span>
      </div>
    </footer>
  );
}
