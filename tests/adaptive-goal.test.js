import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAdaptiveGoal,runAdaptiveGoal} from '../src/adaptive-goal.js';
function fixture(){
 const names=['oak_log','oak_planks','stick','stone_pickaxe'],items=[];
 const records=names.map((name,i)=>({id:i+1,name,...(name==='stone_pickaxe'?{maxDurability:100}:{})}));
 const c={items,registry:{items:Object.fromEntries(records.map(i=>[i.id,i])),itemsByName:Object.fromEntries(records.map(i=>[i.name,i])),supportFeature:()=> 'Damage'},pickup:{inventoryReady:true},crafting:{recipes:new Map()},check:s=>s?.throwIfAborted(),feet:()=>({x:0,y:64,z:0}),stop(){},execute:async()=>{}};
 const add=(name,count)=>items.push({network_id:names.indexOf(name)+1,count});
 const say=[];return {c,add,say,options:{goal:{item:'oak_planks',count:4},controls:c,sender:'tester',signal:new AbortController().signal,say:m=>say.push(m)}};
}
test('adaptive goal parses item count and rejects vague goals',()=>{
 assert.deepEqual(parseAdaptiveGoal('目標 石のツルハシを1個用意して'),{item:'stone_pickaxe',count:1});
 assert.throws(()=>parseAdaptiveGoal('目標 家を建てて'));assert.equal(parseAdaptiveGoal('こんにちは'),null);
});
test('adaptive goal plans ingredients then verifies finished inventory',async()=>{
 const {c,add,options}=fixture();let plans=0;
 c.execute=async a=>{if(a.type==='gather')add('oak_log',1);else {c.items[0].count=0;add('oak_planks',4);}};
 const r=await runAdaptiveGoal({...options,planStep:async context=>{plans++;assert.equal(context.goal.item,'oak_planks');return {action:plans===1?{type:'gather',item:'wood',count:1}:{type:'craft',item:'oak_planks',count:4}};}});
 assert.equal(r.complete,true);assert.equal(r.steps,2);assert.equal(r.have,4);
});
test('failed action is fed back and an alternative plan can succeed',async()=>{
 const {c,add,options}=fixture();let plans=0;
 c.execute=async a=>{if(a.type==='craft')throw Error('材料不足');add('oak_planks',4);};
 const r=await runAdaptiveGoal({...options,planStep:async context=>{if(plans++)assert.match(context.history[0].error,/材料不足/);return {action:{type:plans===1?'craft':'collect',item:'oak_planks',count:4}};}});
 assert.equal(r.complete,true);assert.equal(r.replans,1);
});
test('false execution success cannot complete or endlessly repeat a goal',async()=>{
 const {c,options,say}=fixture();let executed=0;c.execute=async()=>{executed++;return {crafted:4};};
 await assert.rejects(runAdaptiveGoal({...options,planStep:async()=>({action:{type:'craft',item:'oak_planks',count:4}})}),/再提案/);
 assert.equal(executed,1);assert.ok(!say.some(s=>s.startsWith('目標達成')));assert.equal(c.adaptiveGoal.phase,'停止');
});
test('adaptive goal honors stop while waiting for a new plan',async()=>{
 const {c,options}=fixture(),a=new AbortController();let executed=0;c.execute=async()=>executed++;
 await assert.rejects(runAdaptiveGoal({...options,signal:a.signal,planStep:async()=>{a.abort();return {action:{type:'craft',item:'oak_planks',count:4}};}}));
 assert.equal(executed,0);assert.equal(c.adaptiveGoal.phase,'中断');
});
test('uncertain inventory response stops replanning',async()=>{
 const {c,options}=fixture();let plans=0;c.execute=async()=>{c.crafting.uncertain=true;throw Error('応答なし');};
 await assert.rejects(runAdaptiveGoal({...options,planStep:async()=>{plans++;return {action:{type:'craft',item:'oak_planks',count:4}};}}),/未確定/);
 assert.equal(plans,1);
});
test('adaptive goal skips generation when inventory already satisfies goal',async()=>{
 const {add,options}=fixture();add('oak_planks',4);
 const r=await runAdaptiveGoal({...options,planStep:async()=>{throw Error('no call');}});assert.equal(r.complete,true);assert.equal(r.steps,0);
});
test('broken tool cannot satisfy goal and arbitrary actions are rejected',async()=>{
 const {c,add,options}=fixture();add('stone_pickaxe',1);c.items[0].extra={nbt:{nbt:{value:{Damage:{value:99}}}}};
 await assert.rejects(runAdaptiveGoal({...options,goal:{item:'stone_pickaxe',count:1},planStep:async()=>({action:{type:'give',item:'stone_pickaxe',count:1}})}),/未対応/);
});
test('real planner interface passes grounded context to local model',async()=>{
 const {c,add,options}=fixture();c.execute=async()=>add('oak_planks',4);
 const r=await runAdaptiveGoal({...options,model:'test',fetchImpl:async(url,request)=>{
  assert.equal(url,'http://127.0.0.1:11434/api/chat');const body=JSON.parse(request.body);assert.equal(body.format.properties.action.properties.type.enum.includes('give'),false);
  return {ok:true,json:async()=>({message:{content:JSON.stringify({reason:'板材を作成',action:{type:'craft',item:'oak_planks',count:4}})}})};
 }});assert.equal(r.complete,true);
});
