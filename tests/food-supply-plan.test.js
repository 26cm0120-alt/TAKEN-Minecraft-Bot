import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directPlan,validatePlan} from '../src/action-agent.js';
test('food supply Japanese commands create validated plans',()=>{
 for(const text of ['食料調達','食料調達して','食料を調達して','食料を3個取ってきて']){
  const plan=directPlan(text);assert.deepEqual(plan.actions,[{type:'food_supply',count:3}]);validatePlan(plan);
 }
 assert.equal(directPlan('食料を20個取ってきて').actions.length,0);
});
test('food supply cannot exceed limits or be combined with other actions',()=>{
 for(const count of [0,9,NaN,1.5])assert.throws(()=>validatePlan({reply:'',actions:[{type:'food_supply',count}]}));
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'food_supply',count:3},{type:'eat'}]}));
});
