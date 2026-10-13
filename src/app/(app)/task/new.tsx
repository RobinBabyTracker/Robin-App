import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/ui/components';
import { TaskForm, type TaskPayload } from '@/components/TaskForm';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { useFamily } from '@/state/family';
import { useInvalidateTasks } from '@/state/queries';

export default function NewTask() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const { familyId, isParent } = useFamily();
  const invalidate = useInvalidateTasks();
  const [submitting, setSubmitting] = useState<'send' | 'draft' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (payload: TaskPayload, mode: 'send' | 'draft') => {
    setError(null);
    setSubmitting(mode);
    try {
      // Safe to retry: the same client_id always returns the same task.
      const id = await rpc<string>('create_task', { p_family: familyId, p: payload, p_send: mode === 'send' });
      invalidate(familyId, id);
      router.replace({ pathname: '/task/[id]', params: { id, created: mode } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(null);
    }
  };

  if (!isParent) {
    return <Screen><ErrorOnlyParents /></Screen>;
  }
  return (
    <Screen>
      <TaskForm presetDate={date} submitting={submitting} serverError={error} onSubmit={submit} />
    </Screen>
  );
}

function ErrorOnlyParents() {
  return <EmptyState pose="pecking" title="Only parents can ask for help" body="Parents in this family can create requests and events. You'll see the ones you're asked to help with." />;
}
