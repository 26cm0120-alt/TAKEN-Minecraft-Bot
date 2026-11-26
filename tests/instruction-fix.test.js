import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directPlan,runActions,validatePlan} from '../src/action-agent.js';
import {attachAIChat} from '../src/ai-chat.js';
import {RealmControls} from '../src/realm-controls.js';
import {EventEmitter} from 'node:events';
import {runGoal} from '../src/autonomous-goal.js';
test('pasted backticks, jungle wood names and drowned map to deterministic actions',()=>{
 assert.deepEqual(directPlan('私についてきて30秒`').actions,[{type:'follow',seconds:30}]);
 assert.deepEqual(directPlan('近くのゾンビを攻撃して。20秒`').actions,[{type:'combat',target:'zombie',seconds:20}]);
 assert.deepEqual(directPlan('近くのドラウンドを倒して').actions,[{type:'combat',target:'drowned',seconds:20}]);
 const plan=directPlan('ジャングル##木を集めて');assert.deepEqual(plan.actions,[{type:'gather',block:'jungle_log',count:8}]);assert.match(plan.reply,/未指定/);validatePlan(plan);
});
test('surroundings with trailing markdown quotes observes the world instead of calling LLM',async()=>{
 const client=new EventEmitter(),sent=[];client.profile={name:'TAKE6866'};client.queue=(n,p)=>sent.push(p.message);
 const ai=attachAIChat(client,{owners:['owner'],controls:{nearbySummary:()=> 'actual terrain'},fetchImpl:()=>{throw Error('unexpected LLM');}});
 await ai.handle({type:'chat',source_name:'owner',message:'!TAKEN 周囲`'});assert.ok(sent.includes('actual terrain'));
});
test('empty LLM action plan cannot claim that it started a collection',async()=>{
 const messages=[];await runActions({instruction:'ジャングルの木をたくさん集めて',sender:'owner',controls:{status:()=>({}),execute:()=>{throw Error('no plan');}},model:'mock',signal:new AbortController().signal,say:m=>messages.push(m),fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({reply:'採集するため探します。',actions:[]})}})})});
 assert.match(messages.join(''),/まだ操作していません/);assert.ok(!messages.includes('採集するため探します。'));
});
test('mining can reach the exposed log selected by search two blocks below feet',async()=>{
 const client=new EventEmitter();client.queue=()=>{};const c=new RealmControls(client);c.ready=true;c.health=20;c.position={x:80.5,y:68.62,z:542.5};c.wait=async()=>{};
 const target={name:'oak_log',position:{x:78,y:65,z:541},runtimeId:1};
 c.block=p=>Math.floor(p.x)===78&&Math.floor(p.y)===65&&Math.floor(p.z)===541?target:null;
 c.goto=async()=>({});c.confirmBlock=async()=>{};c.authoritativeBreak=true;
 const result=await c.mine('oak_log',1,undefined,{targetPosition:target.position});assert.equal(result.broken,1);
});
test('blocked movement refreshes and replans at most twice before stopping',async()=>{
 const client=new EventEmitter();client.queue=()=>{};const c=new RealmControls(client);c.ready=true;c.health=20;c.position={x:0.5,y:65.62,z:0.5};c.lastAuthoritativePosition={...c.position};
 c.block=p=>({name:Math.floor(p.y)<64?'stone':'air',boundingBox:Math.floor(p.y)<64?'block':'empty'});c.requestNearby=()=>{};
 let blocks=0;c.wait=async ms=>{if(ms===50){blocks++;c.walkTarget=null;}};
 await assert.rejects(()=>c.goto({x:2.5,y:64,z:0.5}),/前方の足場/);assert.equal(blocks,3);
});
test('a mined but uncollected result triggers one pickup recovery before abandoning the goal',async()=>{
 let gain=0;const actions=[],signal=new AbortController().signal;
 const c={pickup:{inventoryReady:true,snapshot:()=>new Map(),gains:()=>gain?[{item:'oak_log',count:gain}]:[]},feet:()=>({x:0,y:64,z:0}),check:()=>{},stop:()=>{},execute:async a=>{actions.push(a.type);if(a.type==='collect')gain=1;return {broken:1};}};
 const result=await runGoal({goal:{resource:'wood',count:1,returnHome:false},controls:c,sender:'owner',signal,say:()=>{}});
 assert.equal(result.complete,true);assert.deepEqual(actions,['gather','collect']);
});
