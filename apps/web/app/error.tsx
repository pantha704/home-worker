"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="centered-state">
      <span className="state-code">Something paused</span>
      <h1>We could not open this view.</h1>
      <p>Your source was not changed. Try loading the page again.</p>
      <button className="button button-primary" onClick={reset} type="button">Try again</button>
    </main>
  );
}
