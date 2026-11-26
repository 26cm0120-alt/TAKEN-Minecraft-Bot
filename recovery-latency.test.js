import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmRecovery} from './realm-recovery.js';
import {requestLocalAI} from './local-ai-request.js';
function client(){const c=new EventEmitter();c.closed=0;c.close=()=>{c.closed++;c.emit('close');};c._nethernetCleanup=Promise.resolve();return c;}
test('respawn recovery closes old session, waits for cleanup and attaches a fresh one with bounded retries',async()=>{
 const sessions=[client()],waits=[];const r=new RealmRecovery(()=>{const c=client();sessions.push(c);return c;},{now:()=>0,wait:async ms=>waits.push(ms)});r.attach(sessions[0]);
 await r.recover(sessions[0],'respawn_timeout');assert.equal(sessions[0].closed,1);assert.equal(sessions.length,2);assert.equal(r.current,sessions[1]);assert.ok(waits.includes(3000));
 await r.recover(sessions[0],'stale');assert.equal(sessions.length,2);
 await r.recover(sessions[1],'respawn_timeout');const notices=[];sessions[2].on('taken_notice',p=>notices.push(p.message));await r.recover(sessions[2],'respawn_timeout');assert.equal(sessions.length,3);assert.equal(sessions[2].closed,0);assert.ok(notices[0].includes('2回'));r.stop();
});
test('manual shutdown while reconnecting never starts another session',async()=>{
 const c=client();let calls=0;let release;const r=new RealmRecovery(()=>{calls++;return client();},{wait:ms=>new Promise(resolve=>{release=resolve;})});r.attach(c);const pending=r.recover(c,'timeout');await new Promise(resolve=>setImmediate(resolve));r.stop();release();await pending;assert.equal(calls,0);
});
test('local AI disables thinking and logs timing while preserving cancellation and bounded body reads',async()=>{
 let body;const result=await requestLocalAI(async(url,p)=>{body=JSON.parse(p.body);return {ok:true,json:async()=>({message:{content:'ok'},eval_count:2})};},{model:'mock',options:{num_predict:192}},new AbortController().signal);assert.equal(body.think,false);assert.equal(body.keep_alive,0);assert.equal(body.options.num_thread,4);assert.equal(body.options.num_ctx,4096);assert.equal(result.message.content,'ok');
 await assert.rejects(()=>requestLocalAI(async(url,p)=>new Promise((resolve,reject)=>p.signal.addEventListener('abort',()=>reject(p.signal.reason))),{model:'mock'},undefined,{timeoutMs:10}),/60秒/);
 const abort=new AbortController();abort.abort(new Error('stop'));await assert.rejects(()=>requestLocalAI(async()=>({ok:true,json:async()=>({})}),{},abort.signal),/stop/);
});
