import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import * as api from '@/lib/api';

export type { TaskDetail } from '@/lib/api';

// Query keys in one place so realtime events can invalidate precisely.
export const keys = {
  members: (familyId: string) => ['members', familyId] as const,
  calendar: (familyId: string) => ['calendar', familyId] as const,
  task: (id: string) => ['task', id] as const,
  conversations: (familyId: string) => ['conversations', familyId] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  sharedMedia: (id: string) => ['sharedMedia', id] as const,
  memories: (familyId: string) => ['memories', familyId] as const,
  memory: (id: string) => ['memory', id] as const,
  notifications: ['notifications'] as const,
  prefs: ['prefs'] as const,
  invitations: (familyId: string) => ['invitations', familyId] as const,
};

// --- people ---------------------------------------------------------------

export function useMembers(familyId: string) {
  return useQuery({ queryKey: keys.members(familyId), enabled: !!familyId, queryFn: () => api.fetchMembers(supabase, familyId) });
}

/** Look up a display name for someone in the current family. */
export function useNames(familyId: string) {
  const { data } = useMembers(familyId);
  return (id: string | null | undefined, fallback = 'Former member') =>
    (id ? data?.find((m) => m.user_id === id)?.profile?.display_name ?? fallback : fallback);
}

export function useInvitations(familyId: string, enabled: boolean) {
  return useQuery({ queryKey: keys.invitations(familyId), enabled: !!familyId && enabled, queryFn: () => api.fetchInvitations(supabase, familyId) });
}

// --- calendar and tasks ---------------------------------------------------

export function useCalendar(familyId: string, from: string, to: string, scope: 'mine' | 'family') {
  return useQuery({
    queryKey: [...keys.calendar(familyId), from, to, scope],
    enabled: !!familyId,
    queryFn: () => api.fetchCalendar(supabase, familyId, from, to, scope),
  });
}

export function useTask(id: string) {
  return useQuery({ queryKey: keys.task(id), enabled: !!id, queryFn: () => api.fetchTask(supabase, id) });
}

export function useInvalidateTasks() {
  const qc = useQueryClient();
  return (familyId: string, taskId?: string) => {
    qc.invalidateQueries({ queryKey: keys.calendar(familyId) });
    if (taskId) qc.invalidateQueries({ queryKey: keys.task(taskId) });
    qc.invalidateQueries({ queryKey: keys.notifications });
  };
}

export type RespondResult = { result: 'assigned' | 'already_yours' | 'already_filled' | 'recorded' | 'withdrawn'; task_status: string; task_version: number };

export function useRespond(familyId: string, taskId: string) {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async (response: 'accepted' | 'declined' | 'tentative') =>
      (await api.rpcCall<RespondResult[]>(supabase, 'respond_to_task', { p_task: taskId, p_response: response }))[0],
    onSettled: () => invalidate(familyId, taskId),
  });
}

// --- messaging ------------------------------------------------------------

export function useConversations(familyId: string) {
  return useQuery({ queryKey: keys.conversations(familyId), enabled: !!familyId, queryFn: () => api.fetchConversations(supabase, familyId) });
}

export function useConversation(id: string) {
  return useQuery({ queryKey: keys.conversation(id), enabled: !!id, queryFn: () => api.fetchConversation(supabase, id) });
}

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: keys.messages(conversationId),
    enabled: !!conversationId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.fetchMessagesPage(supabase, conversationId, pageParam),
    getNextPageParam: (last) => (last.length === api.MESSAGE_PAGE ? last[last.length - 1].created_at : null),
  });
}

export function useSharedMedia(conversationId: string) {
  return useQuery({ queryKey: keys.sharedMedia(conversationId), enabled: !!conversationId, queryFn: () => api.fetchSharedMedia(supabase, conversationId) });
}

// --- memories -------------------------------------------------------------

export function useMemories(familyId: string) {
  return useInfiniteQuery({
    queryKey: keys.memories(familyId),
    enabled: !!familyId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.fetchMemoriesPage(supabase, familyId, pageParam),
    getNextPageParam: (last, all) => (last.length === api.MEMORY_PAGE ? all.length * api.MEMORY_PAGE : undefined),
  });
}

export function useMemory(id: string) {
  return useQuery({ queryKey: keys.memory(id), enabled: !!id, queryFn: () => api.fetchMemory(supabase, id) });
}

/** Signed URL for a private file; cached for most of its one-hour life. */
export function useMediaUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['mediaUrl', path],
    enabled: !!path,
    staleTime: 45 * 60 * 1000,
    gcTime: 50 * 60 * 1000,
    retry: 1,
    queryFn: () => signedUrl(path!),
  });
}

// --- notifications --------------------------------------------------------

export function useNotifications(userId: string | null) {
  return useQuery({ queryKey: keys.notifications, enabled: !!userId, queryFn: () => api.fetchNotifications(supabase) });
}

export function usePrefs(userId: string | null) {
  return useQuery({ queryKey: keys.prefs, enabled: !!userId, queryFn: () => api.fetchPrefs(supabase) });
}
