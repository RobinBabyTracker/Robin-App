import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchMyFamilies, type MyFamily } from '@/lib/api';
import { useAuth } from './auth';

export type { MyFamily };

type FamilyState = {
  families: MyFamily[];
  loading: boolean;
  error: unknown;
  current: MyFamily | null;
  familyId: string;
  isParent: boolean;
  isOwner: boolean;
  select: (id: string) => void;
  refetch: () => Promise<unknown>;
};

const KEY = 'robin.currentFamily';
const FamilyContext = createContext<FamilyState | null>(null);

function readSaved(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [selected, setSelected] = useState<string | null>(readSaved);

  const q = useQuery({
    queryKey: ['myFamilies', userId],
    enabled: !!userId,
    queryFn: () => fetchMyFamilies(supabase, userId!),
  });

  const families = q.data ?? [];
  const current = families.find((f) => f.id === selected) ?? families[0] ?? null;

  useEffect(() => {
    if (current && current.id !== selected) {
      setSelected(current.id);
      try { localStorage.setItem(KEY, current.id); } catch {}
    }
  }, [current, selected]);

  const value = useMemo<FamilyState>(() => ({
    families,
    loading: q.isLoading,
    error: q.error,
    current,
    familyId: current?.id ?? '',
    isParent: current?.role === 'owner' || current?.role === 'parent',
    isOwner: current?.role === 'owner',
    select: (id) => {
      setSelected(id);
      try { localStorage.setItem(KEY, id); } catch {}
    },
    refetch: q.refetch,
  }), [families, q.isLoading, q.error, current, q.refetch]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily() {
  const v = useContext(FamilyContext);
  if (!v) throw new Error('useFamily outside FamilyProvider');
  return v;
}
