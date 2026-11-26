import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runActions,validatePlan} from '../src/action-agent.js';
import {attachAIChat} from '../src/ai-chat.js';
import {EventEmitter} from 'node:events';
function response(plan){return {ok:true,json:async()=>({message:{content:JSON.stringify(plan)}})};}
test('free phrasing uses valid follow or exploration plans without keyword rejection',async()=>{
 for(const [instruction,action,outcome] of [
  ['離れずに後ろを歩いて',{type:'follow',seconds:30},{followed:'owner',movementInputs:10}],
  ['鉄を探して掘ってきて',{type:'gather',block:'raw_iron',count:3},{broken:3,collected:[{item:'raw_iron',count:3}],total:3,requested:3}]
 ]){
  const executed=[];await runActions({instruction,sender:'owner',controls:{status:()=>({}),execute:async a=>{executed.push(a);return outcome;}},model:'mock',fetchImpl:async()=>response({reply:'試します。',actions:[action]}),signal:new AbortController().signal,say:()=>{}});
  assert.deepEqual(executed,[action]);
 }
});
test('clarification never runs actions and cannot coexist with an executable plan',async()=>{
 assert.throws(()=>validatePlan({reply:'',question:'場所は？',actions:[{type:'eat'}]}),/同時/);
 const result=await runActions({instruction:'足元に床を作って',sender:'owner',controls:{status:()=>({}),execute:()=>{throw Error('must not execute');}},model:'mock',fetchImpl:async()=>response({reply:'',question:'材料と寸法を教えてください。',actions:[]}),signal:new AbortController().signal,say:()=>{}});
 assert.equal(result.clarification,'材料と寸法を教えてください。');
});
test('same-player follow-up includes previous instruction; another player cannot supply the answer',async()=>{
 const client=new EventEmitter(),requests=[],executed=[];client.profile={name:'TAKE6866'};client.queue=()=>{};
 const controls={status:()=>({}),stop:()=>{},execute:async a=>{executed.push(a);return {block:'oak_planks',placed:9};}};
 let calls=0;const fetchImpl=async(url,p)=>{requests.push(JSON.parse(p.body));calls++;return response(calls===1?{reply:'',question:'材料・座標・寸法は？',actions:[]}:calls===2?{reply:'こんにちは',actions:[]}:{reply:'床を試します。',actions:[{type:'build',block:'oak_planks',x:10,y:64,z:20,width:3,height:1,depth:3}]});};
 const ai=attachAIChat(client,{owners:['*'],controls,fetchImpl});
 await ai.handle({type:'chat',source_name:'owner',message:'!TAKEN 小さい床を用意して'});
 assert.equal(executed.length,0);
 await ai.handle({type:'chat',source_name:'other',message:'!TAKEN こんにちは'});
 assert.ok(!requests[1].messages.at(-1).content.includes('元の指示'));
 await ai.handle({type:'chat',source_name:'owner',message:'!TAKEN オークの板材で座標10 64 20から3×3'});
 assert.match(requests[2].messages.at(-1).content,/元の指示/);assert.match(requests[2].messages.at(-1).content,/追加回答/);assert.equal(executed[0].type,'build');
});
