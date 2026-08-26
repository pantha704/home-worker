"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth-provider";

export function AuthControls() {
  const { hosted, loading, signOut, user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!hosted || loading || !user) return null;
  return (
    <div className="auth-controls">
      <span title={user.email}>{user.email}</span>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signOut().finally(() => setBusy(false));
        }}
        type="button"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
