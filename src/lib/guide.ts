// Remembers, on this phone, whether someone has seen Robin's welcome tour and
// which getting-started steps they've finished. Everything is keyed by user,
// so two people sharing a phone each get their own tour.

export type GuideStep = 'invite' | 'ask' | 'reply' | 'message' | 'memory';

const key = (userId: string, what: string) => `robin.guide.${what}.${userId}`;

function read(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function write(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // Storage can fail (e.g. full disk). The guide is a nicety, so carry on.
  }
}

// Only brand-new accounts get the tour automatically. Older accounts can still
// watch it from You & family → How Robin works.
const NEW_ACCOUNT_MS = 3 * 24 * 60 * 60 * 1000;

type TourUser = { id: string; created_at?: string; user_metadata?: Record<string, unknown> };

export const guide = {
  tourSeen: (userId: string) => read(key(userId, 'tour')) === '1',
  /**
   * Show the tour once per account: not if this phone has shown it, not if the
   * account has seen it on another phone (saved with the account), and not to
   * accounts that existed before the tour did.
   */
  shouldShowTour(user: TourUser, now = Date.now()): boolean {
    if (guide.tourSeen(user.id)) return false;
    const seenElsewhere = user.user_metadata?.tour_seen === true;
    const created = user.created_at ? new Date(user.created_at).getTime() : NaN;
    const isNew = Number.isFinite(created) && now - created < NEW_ACCOUNT_MS;
    if (seenElsewhere || !isNew) {
      guide.markTourSeen(user.id);
      return false;
    }
    return true;
  },
  markTourSeen: (userId: string) => write(key(userId, 'tour'), '1'),

  checklistHidden: (userId: string) => read(key(userId, 'hidden')) === '1',
  setChecklistHidden: (userId: string, hidden: boolean) => write(key(userId, 'hidden'), hidden ? '1' : null),

  doneSteps(userId: string): Set<GuideStep> {
    try {
      const raw = read(key(userId, 'done'));
      return new Set(raw ? (JSON.parse(raw) as GuideStep[]) : []);
    } catch {
      return new Set();
    }
  },
  /** Once a step is done it stays ticked, even if (say) the request later moves into the past. */
  markDone(userId: string, steps: GuideStep[]) {
    const done = guide.doneSteps(userId);
    const before = done.size;
    steps.forEach((s) => done.add(s));
    if (done.size !== before) write(key(userId, 'done'), JSON.stringify([...done]));
  },
};
