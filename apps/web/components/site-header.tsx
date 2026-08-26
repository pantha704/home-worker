import Link from "next/link";

import { Brand } from "@/components/brand";
import { AuthControls } from "@/components/auth-controls";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav aria-label="Primary navigation" className="site-nav">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
          <Link className="nav-cta" href="#upload">New project</Link>
          <AuthControls />
        </nav>
      </div>
    </header>
  );
}
