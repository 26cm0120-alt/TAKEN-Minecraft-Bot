import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directPlan,validatePlan} from './action-agent.js';
test('resource management commands work without an LLM',()=>{
 for(const text of ['資源管理','資源管理して','道具を整備して']){
  const plan=directPlan(text);validatePlan(plan);assert.deepEqual(plan.actions,[{type:'resource_manage'}]);
 }
 const plan=directPlan('資源管理 石のツルハシ');validatePlan(plan);assert.equal(plan.actions[0].item,'stone_pickaxe');
});
test('resource management rejects unsupported tools and combined plans',()=>{
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'resource_manage',item:'knife'}]}));
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'resource_manage'},{type:'eat'}]}));
});
