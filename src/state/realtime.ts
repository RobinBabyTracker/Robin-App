import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { keys } from './queries';

/**
 * Live updates via Supabase Realtime. The server only delivers rows this user
 * is allowed to read (row-level security applies to subscriptions), and each
 * event simply refreshes the affected data from the database, so the screen
 * always reflects what is actually stored.
 */
export function useRealtime(userId: string | null, familyId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId || !familyId) return;
    const channel = supabase
      .channel(`robin:${userId}:${familyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `family_id=eq.${familyId}` }, (p) => {
        qc.invalidateQueries({ queryKey: keys.calendar(familyId) });
        const id = (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id;
        if (id) qc.invalidateQueries({ queryKey: keys.task(id) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_responses' }, (p) => {
        qc.invalidateQueries({ queryKey: keys.calendar(familyId) });
        const id = (p.new as { task_id?: string })?.task_id ?? (p.old as { task_id?: string })?.task_id;
        if (id) qc.invalidateQueries({ queryKey: keys.task(id) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: keys.notifications });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (p) => {
        const conv = (p.new as { conversation_id?: string })?.conversation_id;
        if (conv) qc.invalidateQueries({ queryKey: keys.messages(conv) });
        qc.invalidateQueries({ queryKey: keys.conversations(familyId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, (p) => {
        qc.invalidateQueries({ queryKey: keys.conversations(familyId) });
        const conv = (p.new as { conversation_id?: string })?.conversation_id;
        if (conv) qc.invalidateQueries({ queryKey: keys.conversation(conv) }); // read receipts
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'family_members' }, () => {
        qc.invalidateQueries({ queryKey: keys.members(familyId) });
        qc.invalidateQueries({ queryKey: ['myFamilies'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memories', filter: `family_id=eq.${familyId}` }, () => {
        qc.invalidateQueries({ queryKey: keys.memories(familyId) });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, familyId, qc]);
}
