import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directPlan,runActions} from './action-agent.js';
import {attachAIChat} from './ai-chat.js';
import {EventEmitter} from 'node:events';
test('observed wood cutting, coordinate placement and plain movement parse directly',()=>{
 assert.equal(directPlan('ジャングル##木切って').actions[0].block,'jungle_log');
 assert.deepEqual(directPlan('土を90 60 546に1つ設置して').actions,[{type:'build',block:'dirt',x:90,y:60,z:546,width:1,height:1,depth:1}]);
 assert.deepEqual(directPlan('88 60 546ここに移動して').actions,[{type:'move',x:88,y:60,z:546}]);
 assert.equal(directPlan('オークの板材を掘って').actions[0].count,1);
});
test('LLM narration cannot announce completion before execution or mention a required knife',async()=>{
 for(const actions of [[{type:'mine',block:'dirt',count:1}],[]]){
  const messages=[];await runActions({instruction:'何か手伝える？',sender:'owner',controls:{status:()=>({}),execute:async()=>({block:'dirt',broken:1})},model:'mock',signal:new AbortController().signal,say:s=>messages.push(s),fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({reply:actions.length?'掘りました。':'木のナイフがありません。',actions})}})})});
  assert.ok(!messages.includes('掘りました。'));assert.ok(!messages.includes('木のナイフがありません。'));
 }
});
test('real inventory queries and last mine context do not mix players',async()=>{
 const client=new EventEmitter(),messages=[],actions=[];client.profile={name:'TAKE6866'};client.queue=(n,p)=>messages.push(p.message);
 const controls={status:()=>({health:20}),inventorySummary:()=> 'actual inventory',stop:()=>{},execute:async a=>{actions.push(a);return a.type==='move'?{position:{x:88,y:60,z:546}}:{block:a.block,broken:a.count};}};
 const ai=attachAIChat(client,{owners:['*'],controls,fetchImpl:()=>{throw Error('unexpected LLM');}});
 const chat=(owner,text)=>ai.handle({type:'chat',source_name:owner,message:'!TAKEN'+text});
 await chat('owner',' 何持ってる?');assert.ok(messages.includes('actual inventory'));
 await chat('owner',' オークの板材を3個掘って');await chat('other',' あと1個掘って');assert.equal(actions.length,1);
 await chat('owner',' あと1個掘って');assert.equal(actions[1].block,'oak_planks');assert.equal(actions[1].count,1);
 await chat('owner','88 60 546ここに移動して');assert.equal(actions[2].type,'move');
});
