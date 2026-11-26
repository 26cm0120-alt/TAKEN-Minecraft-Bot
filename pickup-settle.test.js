import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmPickup} from './realm-pickup.js';
import {directPlan} from './action-agent.js';
test('falling drop waits for a standable landing before approach',async()=>{const client=new EventEmitter();let waits=0;const c={client,registry:{items:{1:{name:'oak_log'}}},items:[],feet:()=>({x:.5,y:64,z:.5}),check:s=>s?.throwIfAborted(),stop(){},walkable:(x,y)=>y===64,wait:async()=>{waits++;if(waits===2)pickup.drops.get('1').position.y=64.2;}};const pickup=new RealmPickup(c);pickup.inventoryReady=true;pickup.drops.set('1',{id:'1',item:{network_id:1,count:1},position:{x:.5,y:68,z:.5}});pickup.approach=async(d,p)=>{assert.equal(p.y,64);c.items=[{network_id:1,count:1}];};const r=await pickup.collect({item:'oak_log',count:1},new AbortController().signal);assert.equal(waits,2);assert.equal(r.total,1);});
test('unsupported food searches do not fabricate a collection plan',()=>{assert.equal(directPlan('食料を20個取ってきて').actions.length,0);assert.ok(directPlan('食料を20個取ってきて').question);assert.equal(directPlan('スイカを探して').actions.length,0);});
