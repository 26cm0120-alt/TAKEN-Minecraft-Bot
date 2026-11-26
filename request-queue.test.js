import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RequestQueue} from './request-queue.js';
const entry=(sender,message)=>({sender,message,packet:message});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('queued prompts execute in order only after current work completes',async()=>{
 const seen=[];let release;const q=new RequestQueue(async p=>{seen.push(p);if(p==='first')await new Promise(r=>release=r);},()=>{});
 const current=q.submit(entry('a','first'));await q.submit(entry('b','second'));await q.submit(entry('c','third'));
 assert.deepEqual(seen,['first']);release();await current;await flush();assert.deepEqual(seen,['first','second','third']);
});
test('reported work failure advances to queued and later submissions',async()=>{
 let release;const seen=[];const q=new RequestQueue(async p=>{seen.push(p);if(p==='first'){await new Promise(r=>release=r);return {failed:true};}},()=>{});
 const current=q.submit(entry('a','first'));await q.submit(entry('b','next'));release();await current;
 await flush();assert.equal(q.paused,false);assert.deepEqual(seen,['first','next']);
 const idle=new RequestQueue(async p=>{seen.push(p);return {failed:true};},()=>{});
 await idle.submit(entry('a','alone'));await idle.submit(entry('a','later'));
 assert.deepEqual(seen,['first','next','alone','later']);
});
test('stop clears pending tasks and stale completion cannot re-pause queue',async()=>{
 let release;const seen=[];const q=new RequestQueue(async p=>{seen.push(p);if(p==='first'){await new Promise(r=>release=r);return {failed:true};}},()=>{});
 const current=q.submit(entry('a','first'));await q.submit(entry('b','next'));q.clear();release();await current;
 assert.deepEqual(seen,['first']);assert.equal(q.paused,false);assert.equal(q.pending.length,0);
});
test('queue limits duplicates and per-player pending tasks',async()=>{
 let release;const q=new RequestQueue(async()=>new Promise(r=>release=r),()=>{});
 const current=q.submit(entry('a','first'));await q.submit(entry('b','one'));await q.submit(entry('b','one'));await q.submit(entry('b','two'));await q.submit(entry('b','three'));
 assert.equal(q.pending.length,2);q.clear();release();await current;
});
