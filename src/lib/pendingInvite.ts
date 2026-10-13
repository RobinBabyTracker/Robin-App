// Holds an invite token across sign-up, so opening an invite link before having
// an account still lands you in the right family afterwards.
const KEY = 'robin.pendingInvite';

export function setPendingInvite(token: string) {
  try { localStorage.setItem(KEY, token); } catch {}
}
export function getPendingInvite(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function clearPendingInvite() {
  try { localStorage.removeItem(KEY); } catch {}
}
