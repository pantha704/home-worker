import Link from "next/link";

import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="centered-state">
      <Brand />
      <span className="state-code">404</span>
      <h1>That page is missing.</h1>
      <p>The project may have moved or this address is incomplete.</p>
      <Link className="button button-primary" href="/">Return home</Link>
    </main>
  );
}
