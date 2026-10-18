// The Jones family: a private demo family for recording a walkthrough video.
// Shared by scripts/seed-jones.mjs (real Supabase) and the database tests, so
// the same steps are checked against the real rules before you run them.
import { randomUUID } from 'node:crypto';

export const FAMILY_NAME = 'The Jones Family';

// key, display name, role, what the family calls them
export const PEOPLE = [
  ['sarah', 'Sarah Jones', 'owner', 'Mum'],
  ['david', 'David Jones', 'parent', 'Dad'],
  ['mary', 'Mary', 'helper', 'Nanna'],
  ['john', 'John', 'helper', 'Papa'],
  ['abby', 'Abby', 'helper', 'Aunty Abby'],
  ['oliver', 'Oliver', 'helper', 'Uncle Oliver'],
  ['lizzy', 'Lizzy', 'helper', 'Friend'],
  ['sophie', 'Sophie', 'helper', 'Friend'],
  ['henry', 'Henry', 'helper', 'Friend'],
  ['jacob', 'Jacob', 'helper', 'Friend'],
  ['liam', 'Liam', 'helper', 'Friend'],
  ['emma', 'Emma', 'helper', 'Friend'],
];

/** A time `days` from today at `hour`:`minute` Brisbane time (UTC+10, no daylight saving). */
export function brisbane(days, hour, minute = 0, now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour - 10, minute, 0, 0);
  return d.toISOString();
}

/**
 * Runs the scenario. `p` maps each person's key to { id, call(fn, args) }, where
 * call returns what supabase.rpc would: a single value, or rows for functions
 * that return a table (create_invitation, respond_to_task).
 */
export async function buildJones(p, now = new Date()) {
  const at = (days, hour, minute = 0) => brisbane(days, hour, minute, now);
  const fam = await p.sarah.call('create_family', { p_name: FAMILY_NAME, p_relation_label: 'Mum' });

  for (const [key, , role, label] of PEOPLE.slice(1)) {
    const [inv] = await p.sarah.call('create_invitation', { p_family: fam, p_role: role === 'parent' ? 'parent' : 'helper', p_note: label });
    await p[key].call('accept_invitation', { p_token: inv.token, p_relation_label: label });
  }

  const base = { all_day: false, timezone: 'Australia/Brisbane', links: [], description: '', notes: '', location: '', respond_by: null };
  const task = (who, t) => p[who].call('create_task', { p_family: fam, p_send: true, p: { ...base, client_id: randomUUID(), ...t } });
  const reply = (who, id, r) => p[who].call('respond_to_task', { p_task: id, p_response: r });
  const ids = (...keys) => keys.map((k) => p[k].id);

  // Covered: Nanna said yes first.
  const dinner = await task('sarah', {
    kind: 'help', category: 'meals', title: 'Cook a meal for Thursday night',
    description: 'Anything easy to reheat. Charlie has been unsettled in the evenings, so cooking is a big ask right now!',
    notes: 'David is vegetarian.', starts_at: at(2, 17), ends_at: at(2, 18, 30), helpers_needed: 1, invitees: null,
  });
  await reply('mary', dinner, 'accepted');
  await reply('henry', dinner, 'accepted'); // too late: Nanna already has it

  // Waiting for replies, asked to chosen people only.
  const nap = await task('sarah', {
    kind: 'help', category: 'childcare', title: 'Mind Charlie while I nap',
    description: 'Just a couple of hours so I can catch up on sleep. Bottles are in the fridge.',
    location: 'Our place', starts_at: at(1, 13), ends_at: at(1, 15), helpers_needed: 1,
    invitees: ids('abby', 'lizzy', 'sophie'), respond_by: at(1, 10),
  });
  await reply('lizzy', nap, 'declined');

  // Two helpers needed, one so far.
  const groceries = await task('david', {
    kind: 'help', category: 'errands', title: 'Grocery pick-up',
    description: 'Order is ready at the local shops. Nappies are on the list too.',
    location: 'Woolworths, New Farm', starts_at: at(3, 10), ends_at: at(3, 11), helpers_needed: 2, invitees: null,
  });
  await reply('jacob', groceries, 'accepted');

  // Appointment with Papa driving.
  const checkup = await task('sarah', {
    kind: 'help', category: 'appointment', title: "Lift to Charlie's 4-month check-up",
    description: "David's at work that morning. Car seat is already fitted in our car if that's easier.",
    location: 'Child health clinic', starts_at: at(5, 9, 30), ends_at: at(5, 11), helpers_needed: 1, invitees: ids('john', 'mary', 'oliver'),
  });
  await reply('john', checkup, 'accepted');

  // Upcoming family events.
  const picnic = await task('sarah', {
    kind: 'event', category: 'family_event', title: "Charlie's naming day picnic",
    description: 'Bring a picnic rug and something to share. Cake is sorted!', location: 'New Farm Park',
    starts_at: at(9, 11), ends_at: at(9, 14), invitees: null,
  });
  for (const k of ['david', 'mary', 'john', 'abby', 'emma', 'sophie']) await reply(k, picnic, 'accepted');
  await reply('oliver', picnic, 'tentative');
  await reply('liam', picnic, 'declined');

  // Only parents can create requests and events, so David sets up Nanna's roast.
  const roast = await task('david', {
    kind: 'event', category: 'family_event', title: "Sunday roast at Nanna & Papa's",
    location: "Nanna & Papa's", starts_at: at(6, 17, 30), ends_at: at(6, 20), invitees: ids('sarah', 'mary', 'john', 'abby', 'oliver'),
  });
  for (const k of ['sarah', 'mary', 'john', 'abby']) await reply(k, roast, 'accepted');

  // Chats.
  const msg = (who, conv, body) => p[who].call('send_message', { p_conversation: conv, p_body: body, p_client_id: randomUUID(), p_media: [] });
  const family = await p.sarah.call('create_conversation', { p_family: fam, p_members: ids('david', 'mary', 'john', 'abby', 'oliver'), p_name: 'The Joneses' });
  await msg('mary', family, "Can't wait to see Charlie on Sunday!");
  await msg('sarah', family, "He's been smiling so much this week");
  await msg('john', family, "I'll bring the camping chairs for the picnic");
  await msg('oliver', family, 'Might be a bit late, footy finishes at 11');
  await msg('david', family, 'Thanks Papa! See you all there');

  const abbyChat = await p.abby.call('create_conversation', { p_family: fam, p_members: ids('sarah') });
  await msg('abby', abbyChat, 'How did last night go? Did Charlie sleep?');
  await msg('sarah', abbyChat, 'Three hours straight! Small wins');
  await msg('abby', abbyChat, "Amazing! I'm happy to take him for a walk tomorrow if you need a break");

  const friends = await p.sarah.call('create_conversation', { p_family: fam, p_members: ids('lizzy', 'sophie', 'emma'), p_name: 'Mums & bubs crew' });
  await msg('lizzy', friends, 'Coffee and cuddles soon?');
  await msg('emma', friends, "I'm free Saturday morning");
  await msg('sophie', friends, 'Same! The café near the park has a pram ramp');

  return { familyId: fam };
}
