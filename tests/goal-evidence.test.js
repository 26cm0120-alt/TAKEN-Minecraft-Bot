import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialRequirements,inventoryFingerprint,actionGain,readyCraft} from '../src/goal-evidence.js';
import {runAdaptiveGoal} from '../src/adaptive-goal.js';
const descriptor=(name,count)=>({type:'valid',descriptor_type:'name',name,count,metadata:0});
function fixture(){
 const definitions=[{id:1,name:'oak_planks'},{id:2,name:'stick'},{id:3,name:'dirt'}];
 const recipe={network_id:10,output:[{network_id:2,count:4}],input:[descriptor('oak_planks',2)],kind:'shaped',width:1,height:2};
 const c={items:[{network_id:1,count:3,metadata:0}],registry:{items:Object.fromEntries(definitions.map(i=>[i.id,i])),itemsByName:Object.fromEntries(definitions.map(i=>[i.name,i]))},crafting:{recipes:new Map([[10,recipe]])},pickup:{inventoryReady:true},check:s=>s?.throwIfAborted(),feet:()=>({x:0,y:64,z:0}),stop(){}};
 const options={goal:{item:'stick',count:5},controls:c,signal:new AbortController().signal,say(){}};return {c,recipe,options};
}
test('recipe batches round up and report only actual missing materials',()=>{
 const {c}=fixture();const [r]=materialRequirements(c,'stick',5);assert.equal(r.produces,8);assert.equal(r.missing,1);assert.equal(r.ingredients[0].allocated,3);
});
test('same inventory cannot fund two separate recipe ingredients',()=>{
 const {c,recipe}=fixture();recipe.input=[descriptor('oak_planks',2),{type:'valid',descriptor_type:'item_tag',tag:'planks',count:2}];
 const [r]=materialRequirements(c,'stick',1);assert.equal(r.missing,1);
});
test('NBT-bearing materials follow real crafting restrictions',()=>{
 const {c}=fixture();c.items[0].extra={has_nbt:true};assert.equal(materialRequirements(c,'stick',1)[0].missing,2);
});
test('inventory fingerprints ignore slot order and stack splitting',()=>{
 assert.equal(inventoryFingerprint([{item:'dirt',count:2},{item:'stick',count:1}]),inventoryFingerprint([{item:'stick',count:1},{item:'dirt',count:1},{item:'dirt',count:1}]));
});
test('only intended output counts as progress, including smelting and wood species',()=>{
 assert.equal(actionGain({type:'craft',item:'stick'},[],[{item:'dirt',count:3}]),0);
 assert.equal(actionGain({type:'smelt',item:'raw_iron'},[],[{item:'iron_ingot',count:2}]),2);
 assert.equal(actionGain({type:'gather',item:'wood'},[],[{item:'birch_log',count:3}]),3);
});
test('known craft with materials bypasses model and targets only the deficit',async()=>{
 const {c,recipe,options}=fixture();c.items.push({network_id:2,count:1});
 c.crafting.select=(item,n)=>{assert.equal(n,4);return recipe;};c.crafting.needsTable=()=>false;
 c.execute=async a=>{assert.equal(a.count,4);c.items[0].count-=2;c.items[1].count+=4;};
 const r=await runAdaptiveGoal({...options,planStep:async()=>{throw Error('AI should not be needed');}});assert.equal(r.complete,true);
});
test('unknown workstation prevents premature direct craft',()=>{
 const {c,recipe}=fixture();c.crafting.select=()=>recipe;c.crafting.needsTable=()=>true;c.block=()=>null;assert.equal(readyCraft(c,'stick',1),null);
});
test('unrelated inventory change triggers replanning instead of success',async()=>{
 const {c,options}=fixture();let call=0;c.execute=async()=>{c.items.push({network_id:3,count:1});};
 await assert.rejects(runAdaptiveGoal({...options,planStep:async context=>{if(call++)assert.match(context.history[0].error,/対象の材料/);return {action:call===1?{type:'craft',item:'stick',count:5}:{type:'stop'},reason:'確認できません'};}}),/確認できません/);
 assert.equal(c.adaptiveGoal.history[0].result,undefined);
});
test('invalid model action is corrected without executing it',async()=>{
 const {c,options}=fixture();let attempts=0,executed=0;c.execute=async()=>{executed++;c.items.push({network_id:2,count:5});};
 const r=await runAdaptiveGoal({...options,planStep:async context=>{if(attempts++)assert.match(context.history[0].error,/未対応/);return {action:attempts===1?{type:'give',item:'stick',count:5}:{type:'craft',item:'stick',count:5}};}});
 assert.equal(r.complete,true);assert.equal(executed,1);assert.equal(r.replans,1);
});
