import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectThreads, groupCompanionThreads, disconnectedClient } from '../src/mobile/companion.ts';
const data = {
  projects: [{ id: 'p1', name: 'Coffee', color: '', canStart: true }, { id: 'p2', name: 'Freddai', color: '', canStart: false }],
  threads: [
    { id: 'a', project: 'p1', title: 'Zebra', status: 'running', updated: 1 },
    { id: 'b', project: 'p2', title: 'Alpha', status: 'waiting', updated: 3 },
    { id: 'c', project: 'p1', title: 'Beta', status: 'done', updated: 2 },
    { id: 'd', project: 'p1', title: 'Delta', status: 'error', updated: 4 },
  ],
};
const ids = (project = '', query = '', filter = 'all', sort = 'recent') => selectThreads(data, project, query, filter, sort, {c:2}).map(t => t.id);
test('companion combines project, search and status filters', () => {
  assert.deepEqual(ids('p1', ' COFFEE ', 'running'), ['a']);
  assert.deepEqual(ids('', 'alpha'), ['b']);
  assert.deepEqual(ids('', '', 'attention'), ['d', 'b']);
  assert.deepEqual(ids('', '', 'done'), ['c']);
  assert.deepEqual(ids('p2', 'zebra'), []);
});
test('companion sorts without mutating synchronized data', () => {
  assert.deepEqual(ids(), ['d', 'b', 'c', 'a']);
  assert.deepEqual(ids('', '', 'all', 'oldest'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids('', '', 'all', 'title'), ['b', 'c', 'd', 'a']);
  assert.deepEqual(data.threads.map(t => t.id), ['a', 'b', 'c', 'd']);
});
test('disconnected companion cannot pretend to read or dispatch work', async () => {
  await assert.rejects(disconnectedClient.snapshot(new AbortController().signal), /not connected/);
  await assert.rejects(disconnectedClient.start({ project: 'p1', prompt: 'task', requestId: 'r1' }), /Connect/);
  await assert.rejects(disconnectedClient.reply({ thread: 'a', prompt: 'reply', requestId: 'r2' }), /Connect/);
});

test('default order follows user sends rather than agent activity, with legacy fallback', () => {
 const snapshot={projects:[],threads:[
  {id:'recent-send',project:'p1',title:'Recent send',status:'running',last_user_message_at:100,updated:101},
  {id:'noisy-agent',project:'p1',title:'Old send',status:'running',last_user_message_at:10,updated:9999},
  {id:'legacy',project:'p1',title:'Legacy',status:'running',updated:50},
 ]};
 assert.deepEqual(selectThreads(snapshot,'','','all','recent').map(t=>t.id),['recent-send','legacy','noisy-agent']);
});
test('project groups show only status-live threads, page older history by ten, and keep paging independent', () => {
 const snapshot={projects:[{id:'p1'},{id:'p2'},{id:'empty'}],threads:[
  ...Array.from({length:27},(_,i)=>({id:`a${i}`,project:'p1',title:'A',status:i<3?'running':'done',updated:100-i})),
  ...Array.from({length:7},(_,i)=>({id:`b${i}`,project:'p2',title:'B',status:'running',updated:200-i})),
 ]};
 const read=Object.fromEntries(snapshot.threads.filter(t=>t.status==='done').map(t=>[t.id,t.updated]));
 const sorted=selectThreads(snapshot,'','','all','recent');
 const build=pages=>groupCompanionThreads(snapshot,sorted,{pages,read,selected:'',filter:'all',includeEmpty:true});
 const initial=build({});assert.deepEqual(initial.map(g=>g.id),['p2','p1','empty']);
 assert.deepEqual(initial.map(g=>g.active.length),[7,3,0]);
 assert.equal(initial[1].remaining,24);
 const first=build({p1:1});assert.equal(first[1].older.length,10);assert.equal(first[1].remaining,14);assert.equal(first[0].older.length,0);
 assert.equal(build({p1:2})[1].remaining,4);assert.equal(build({p1:3})[1].older.length,24);assert.equal(build({p1:3})[1].remaining,0);
 assert.equal(build({})[1].older.length,0);
 const withQueued={...snapshot,threads:snapshot.threads.map(t=>t.id==='a10'?{...t,queued:1}:t.id==='a11'?{...t,pending:{id:1}}:t.id==='a12'?{...t,status:'failed'}:t)};
 assert.equal(groupCompanionThreads(withQueued,withQueued.threads,{pages:{},read:{...read,a12:undefined},selected:'',filter:'all'}).find(g=>g.id==='p1').active.length,6,'queued, pending, unviewed failed join live');
});
test('read completed conversations move into older history but remain available in Finished', () => {
 const snapshot={projects:[{id:'p1'}],threads:[{id:'done',project:'p1',title:'Done',status:'done',updated:10}]};
 const read={done:10};const options={pages:{},read,selected:'',filter:'all'};
 assert.equal(groupCompanionThreads(snapshot,snapshot.threads,options)[0].active.length,0);
 assert.equal(groupCompanionThreads(snapshot,snapshot.threads,options)[0].remaining,1);
 assert.equal(groupCompanionThreads(snapshot,snapshot.threads,{...options,pages:{p1:1}})[0].older.length,1);
 assert.equal(groupCompanionThreads(snapshot,snapshot.threads,{...options,selected:'done'})[0].active.length,1);
 assert.equal(groupCompanionThreads(snapshot,snapshot.threads,{...options,filter:'done'})[0].active.length,1);
 assert.equal(selectThreads(snapshot,'','','attention','recent').length,1);
 assert.equal(selectThreads(snapshot,'','','done','recent',read).length,1);
});
