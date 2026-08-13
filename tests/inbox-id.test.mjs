/**
 * Inbox ids: seeds without id get a stable stamp. Same text does not fork.
 * Run: npm run test:inbox-id
 */

import { inboxIdFromItem, isSafeInboxId, stableInboxId } from '../source/shared/inbox-id.js';

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('ok    ' + msg);
  else {
    failed += 1;
    console.log('FAIL  ' + msg);
  }
}

const seed = {
  title: 'Wrong pane',
  hook: 'The brief was for the lead. Opus got it because someone clicked the list.',
  body: 'In a room of agents, highlight is not inbox.',
  cta: 'What have you sent to the wrong person this week?',
  platform: 'x',
  source: 'banter'
};

const a = inboxIdFromItem(seed);
const b = inboxIdFromItem({ ...seed });
const c = inboxIdFromItem({ ...seed, hook: seed.hook + ' x' });

ok(isSafeInboxId(a), 'stamped id is safe');
ok(a.startsWith('inbox-'), 'stamped id has inbox- prefix');
ok(a === b, 'same text twice is the same id');
ok(a !== c, 'different hook is a different id');
ok(inboxIdFromItem({ ...seed, id: 'slopo-w1-x' }) === 'slopo-w1-x', 'existing safe id is kept');
ok(inboxIdFromItem({ ...seed, id: '/Users/me/post' }) === a, 'Users path is not kept');
ok(inboxIdFromItem({ ...seed, id: 'chair@gmail.com' }) === a, 'email is not kept');
ok(!isSafeInboxId(''), 'empty is unsafe');
ok(!isSafeInboxId('C:\\\\Users\\\\me'), 'windows home is unsafe');
ok(!/@/.test(stableInboxId(seed)), 'generated id is not an email');
ok(!/Users|home|GoogleDrive/i.test(stableInboxId(seed)), 'generated id has no home path');
ok(inboxIdFromItem({ ...seed, media: [{ url: 'data:image/png;base64,xx' }] }) === a, 'media does not change the id');

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('ok    inbox ids are stable and not home paths');
process.exit(0);
