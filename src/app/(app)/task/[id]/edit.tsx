import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { EmptyState, ErrorState, Loading, Screen } from '@/ui/components';
import { TaskForm, type TaskPayload } from '@/components/TaskForm';
import { rpc } from '@/lib/supabase';
import { errorCode, friendlyError } from '@/lib/errors';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useInvalidateTasks, useTask } from '@/state/queries';

export default function EditTask() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const { familyId } = useFamily();
  const q = useTask(id);
  const invalidate = useInvalidateTasks();
  const [submitting, setSubmitting] = useState<'send' | 'draft' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  if (!q.data || q.data.task.created_by !== userId) {
    return <Screen><EmptyState title="Only the organiser can edit this" action={{ label: 'Back', onPress: () => router.back() }} /></Screen>;
  }

  const submit = async (payload: TaskPayload) => {
    setError(null);
    setSubmitting('send');
    try {
      await rpc('update_task', { p_task: id, p: payload, p_expected_version: q.data!.task.version });
      invalidate(familyId, id);
      router.back();
    } catch (e) {
      setError(friendlyError(e));
      if (errorCode(e) === 'version_conflict') {
        // Load the latest version and rebuild the form from it.
        await q.refetch();
        setFormKey((k) => k + 1);
      }
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Screen>
      <TaskForm key={formKey} initial={{ task: q.data.task, invitees: q.data.invitees }} submitting={submitting} serverError={error} onSubmit={(p) => submit(p)} />
    </Screen>
  );
}
