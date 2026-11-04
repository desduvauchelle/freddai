import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThreadRecencyTracker } from '../src/thread-recency.ts';
import { compareThreadRecency } from '../src/desktop/types.ts';
import { selectThreads } from '../src/mobile/companion.ts';
test('old-host snapshots keep desktop and iPhone order through output, completion and reload', () => {
 const saved = new Map(); const storage = {getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 let track = createThreadRecencyTracker(storage);
 const rows = [{id:'old',updated:10,messages:[{id:'u1',role:'user'}]}, {id:'new',updated:20,messages:[{id:'u2',role:'user'}]}];
 track(rows);
 const activity = [{...rows[0],updated:100,messages:[...rows[0].messages,{id:'a1',role:'assistant'}]},rows[1]];
 const check = input => {
  assert.deepEqual([...input].sort(compareThreadRecency).map(t=>t.id),['new','old']);
  assert.deepEqual(selectThreads({projects:[],threads:input},'','','all','recent').map(t=>t.id),['new','old']);
 };
 check(track(activity));
 track = createThreadRecencyTracker(storage); check(track(activity));
 const sent = track([{...activity[0],updated:110,messages:[...activity[0].messages,{id:'u3',role:'user'}]},rows[1]]);
 assert.equal([...sent].sort(compareThreadRecency)[0].id,'old');
 assert.equal(activity[0].last_user_message_at,undefined);
 assert.equal(track([{...activity[0],last_user_message_at:5}])[0].last_user_message_at,5);
});
