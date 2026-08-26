"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { isHostedMode } from "@/lib/config";
import { getSupabaseClient } from "@/lib/supabase";

interface AuthContextValue {
  hosted: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const hosted = isHostedMode();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(hosted);

  useEffect(() => {
    if (!hosted) return;
    const client = getSupabaseClient();
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [hosted]);

  const value = useMemo<AuthContextValue>(
    () => ({
      hosted,
      loading,
      session,
      user: session?.user ?? null,
      signOut: async () => {
        if (hosted) await getSupabaseClient().auth.signOut({ scope: "local" });
      },
    }),
    [hosted, loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
