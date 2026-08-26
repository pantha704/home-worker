"use client";

import { useState } from "react";

import { getSupabaseClient } from "@/lib/supabase";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function sendLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    setMessage(null);
    try {
      const { error: authError } = await getSupabaseClient().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (authError) throw authError;
      setMessage("Check your email for a secure sign-in link.");
    } catch {
      setError(true);
      setMessage("The sign-in link could not be sent. Wait a moment and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-card auth-card" id="upload">
      <div className="upload-card-heading">
        <span className="eyebrow">Free private account</span>
        <span className="hosted-pill"><span /> Supabase Free</span>
      </div>
      <h2>Sign in to protect your projects</h2>
      <p>Enter your email. Supabase sends a password-free sign-in link; no payment details are needed.</p>
      <form className="auth-form" onSubmit={sendLink}>
        <label htmlFor="auth-email">Email address</label>
        <input
          autoComplete="email"
          id="auth-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        <button className="button button-primary button-wide" disabled={busy} type="submit">
          {busy ? <><span className="spinner" /> Sending link…</> : "Email me a sign-in link"}
        </button>
      </form>
      {message ? <p className={error ? "auth-message error" : "auth-message"} role="status">{message}</p> : null}
      <p className="upload-assurance"><span>✓</span> Projects are isolated by your signed-in account.</p>
    </div>
  );
}
