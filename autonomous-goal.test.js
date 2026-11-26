import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGoal,runGoal} from './autonomous-goal.js';
import {attachAIChat} from './ai-chat.js';
import {EventEmitter} from 'node:events';
function setup(){
 let count=10;const calls=[],messages=[];const c={position:{x:0,y:64,z:0},pickup:{inventoryReady:true,snapshot:()=>new Map([['oak_log',{count}]]),gains:before=>count>before.get('oak_log').count?[{item:'oak_log',count:count-before.get('oak_log').count}]:[]},feet(){return {...this.position};},check(s){s?.throwIfAborted();},stop(){},async execute(a,sender,signal){signal.throwIfAborted();calls.push(a);if(a.type==='move'){this.position={x:a.x,y:a.y,z:a.z};return {};}count+=Math.min(2,a.count);return {broken:Math.min(2,a.count)};}};
 const options={goal:parseGoal('木材を5個集めて拠点に戻って'),controls:c,sender:'owner',signal:new AbortController().signal,say:s=>messages.push(s)};
 return {c,calls,messages,options,add:n=>count+=n};
}
test('goal parsing is explicit, bounded, and does not intercept ordinary mining or questions',()=>{
 assert.deepEqual(parseGoal('自律 木材を32個集めて開始地点に戻って'),{resource:'wood',count:32,returnHome:true});
 assert.equal(parseGoal('土を1個掘って'),null);assert.equal(parseGoal('木材を32個集めて'),null);
 assert.throws(()=>parseGoal('自律 木材を65個集めて'),/64/);
 assert.throws(()=>parseGoal('自律 土を3個集めて'),/原木/);
});
test('goal observes actual inventory gains, replans remaining count, and returns to captured origin',async()=>{
 const f=setup(),result=await runGoal(f.options);
 assert.equal(result.complete,true);assert.equal(result.gained,5);
 assert.deepEqual(f.calls.filter(a=>a.type==='gather').map(a=>a.count),[5,3,1]);
 assert.deepEqual(f.calls.at(-1),{type:'move',x:0,y:64,z:0});assert.equal(f.c.autonomousOrigin,null);assert.equal(f.c.autonomousGoal,null);
});
test('no inventory progress never becomes success or an endless mining loop',async()=>{
 const f=setup();f.c.execute=async a=>{f.calls.push(a);return {broken:1};};
 const result=await runGoal(f.options);assert.equal(result.complete,false);assert.equal(result.gained,0);
 assert.equal(f.calls.filter(a=>a.type==='gather').length,1);
 assert.match(f.messages.at(-1),/未達成/);
});
test('uncertain mining result gets one collection recovery and is never mined again',async()=>{
 const f=setup();f.c.execute=async a=>{f.calls.push(a);if(a.type==='gather')throw Error('unconfirmed');if(a.type==='collect')f.add(5);return {};};
 const result=await runGoal(f.options);assert.equal(result.complete,true);
 assert.deepEqual(f.calls.map(a=>a.type),['gather','collect','move']);
});
test('death or stop cancels the mission without a recovery or return action',async()=>{
 const f=setup(),controller=new AbortController();f.options.signal=controller.signal;
 f.c.execute=async a=>{f.calls.push(a);controller.abort(Error('death'));throw Error('death');};
 await assert.rejects(()=>runGoal(f.options),/death/);assert.deepEqual(f.calls.map(a=>a.type),['gather']);assert.equal(f.c.autonomousGoal,null);
});
test('failed return is not reported as completed and clears the mission',async()=>{
 const f=setup();f.c.execute=async a=>{f.calls.push(a);if(a.type==='move')throw Error('path blocked');f.add(5);return {broken:5};};
 await assert.rejects(()=>runGoal(f.options),/path blocked/);assert.ok(!f.messages.some(m=>m.includes('帰還しました')));assert.equal(f.c.autonomousOrigin,null);
});
test('authorized chat routes an autonomous goal without calling the conversation LLM',async()=>{
 const f=setup(),client=new EventEmitter(),sent=[];client.profile={name:'TAKE6866'};client.queue=(name,p)=>sent.push({name,p});
 const ai=attachAIChat(client,{owners:['owner'],controls:f.c,fetchImpl:()=>{throw Error('unexpected LLM call');}});
 await ai.handle({type:'chat',source_name:'stranger',message:'!TAKEN 自律 木材を5個集めて開始地点に戻って'});
 assert.equal(f.calls.length,0);
 await ai.handle({type:'chat',source_name:'owner',message:'!TAKEN 自律 木材を5個集めて開始地点に戻って'});
 assert.equal(f.calls.at(-1).type,'move');assert.ok(sent.some(s=>s.p.message?.includes('自律目標を達成')));
});
