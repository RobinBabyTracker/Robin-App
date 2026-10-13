import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isConfigured, supabase } from '@/lib/supabase';
import { unregisterPush } from '@/lib/push';
import { fetchProfile } from '@/lib/api';
import type { Profile } from '@/lib/types';

type AuthState = {
  session: Session | null;
  userId: string | null;
  initialising: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  timezone: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialising, setInitialising] = useState(isConfigured);
  const qc = useQueryClient();

  useEffect(() => {
    if (!isConfigured) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitialising(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) qc.clear(); // never show one person's data to the next
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [qc]);

  const userId = session?.user.id ?? null;
  const profileQ = useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: () => fetchProfile(supabase, userId!) as Promise<Profile>,
  });

  const value = useMemo<AuthState>(() => ({
    session,
    userId,
    initialising,
    profile: profileQ.data ?? null,
    profileLoading: profileQ.isLoading,
    timezone: profileQ.data?.timezone ?? 'Australia/Brisbane',
    signOut: async () => {
      await unregisterPush().catch(() => {});
      await supabase.auth.signOut();
      qc.clear();
    },
  }), [session, userId, initialising, profileQ.data, profileQ.isLoading, qc]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** Signed-in user id; screens under the (app) group can rely on it. */
export function useUserId(): string {
  const { userId } = useAuth();
  return userId ?? '';
}
