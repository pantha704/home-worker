"use client";

import { useState } from "react";

import { getSupabaseClient } from "@/lib/supabase";

type Mode = "signin" | "signup" | "link";

const MIN_PASSWORD_LENGTH = 8;

function describeAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "Wrong email or password.";
  if (text.includes("already registered")) return "That email already has an account. Sign in instead.";
  if (text.includes("password should be at least")) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (text.includes("email not confirmed")) return "Confirm your email address before signing in.";
  if (text.includes("rate limit") || text.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (text.includes("invalid email")) return "That email address does not look valid.";
  return "That did not work. Check the details and try again.";
}

export function AuthPanel() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    setMessage(null);
    const client = getSupabaseClient();
    const address = email.trim();
    try {
      if (mode === "link") {
        const { error: authError } = await client.auth.signInWithOtp({
          email: address,
          options: { emailRedirectTo: window.location.origin },
        });
        if (authError) throw authError;
        setMessage("Check your email for a secure sign-in link.");
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(true);
        setMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (mode === "signup") {
        const { data, error: authError } = await client.auth.signUp({ email: address, password });
        if (authError) throw authError;
        setMessage(
          data.session
            ? "Account created. You are signed in."
            : "Account created. Check your email to confirm the address, then sign in.",
        );
        return;
      }
      const { error: authError } = await client.auth.signInWithPassword({ email: address, password });
      if (authError) throw authError;
    } catch (cause) {
      setError(true);
      const text =
        cause instanceof Error
          ? cause.message
          : typeof (cause as { message?: unknown })?.message === "string"
            ? ((cause as { message: string }).message)
            : "";
      setMessage(describeAuthError(text));
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "signup" ? "Create your account" : mode === "link" ? "Email me a sign-in link" : "Sign in to protect your projects";

  return (
    <div className="upload-card auth-card" id="upload">
      <div className="upload-card-heading">
        <span className="eyebrow">Free private account</span>
        <span className="hosted-pill"><span /> Supabase Free</span>
      </div>
      <h2>{heading}</h2>
      <p>
        {mode === "link"
          ? "Supabase emails you a password-free link. Free-tier email delivery is limited, so it can take a while."
          : `Your files stay tied to this account. Use a password of at least ${MIN_PASSWORD_LENGTH} characters; nothing is sent by email.`}
      </p>
      <form className="auth-form" onSubmit={submit}>
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
        {mode === "link" ? null : (
          <>
            <label htmlFor="auth-password">Password</label>
            <input
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              id="auth-password"
              minLength={MIN_PASSWORD_LENGTH}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </>
        )}
        <button className="button button-primary button-wide" disabled={busy} type="submit">
          {busy ? (
            <><span className="spinner" /> Working…</>
          ) : mode === "signup" ? (
            "Create account"
          ) : mode === "link" ? (
            "Email me a sign-in link"
          ) : (
            "Sign in"
          )}
        </button>
      </form>
      {message ? <p className={error ? "auth-message error" : "auth-message"} role="status">{message}</p> : null}
      <div className="auth-controls">
        {mode === "signin" ? (
          <>
            <button className="button button-secondary" onClick={() => setMode("signup")} type="button">
              Create an account
            </button>
            <button className="button button-secondary" onClick={() => setMode("link")} type="button">
              Email me a link instead
            </button>
          </>
        ) : (
          <button className="button button-secondary" onClick={() => setMode("signin")} type="button">
            Back to sign in
          </button>
        )}
      </div>
      <p className="upload-assurance"><span>✓</span> Projects are isolated by your signed-in account.</p>
    </div>
  );
}
