import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls,emptyItem} from './realm-controls.js';
import {directPlan,validatePlan} from './action-agent.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createSerializer,createDeserializer}=require('./node_modules/bedrock-protocol/src/transforms/serializer.js');
function setup({reject=false}={}){
 const client=new EventEmitter(),c=new RealmControls(client);c.ready=true;c.health=20;c.pickup.inventoryReady=true;c.position={x:0.5,y:65.62,z:0.5};c.crafting.timeout=30;c.items=Array.from({length:36},emptyItem);
 const item=(name,count,id)=>({...emptyItem(),network_id:c.registry.itemsByName[name].id,count,has_stack_id:true,stack_id:id});
 c.items[0]=item('raw_iron',2,11);c.items[1]=item('coal',1,12);let batchId=100;
 c.furnace.open=async()=>{client.emit('container_open',{window_id:2,window_type:'furnace'});client.emit('inventory_content',{window_id:2,input:Array.from({length:3},emptyItem)});};
 c.wait=async()=>{await new Promise(r=>setTimeout(r,1));c.check();if(c.furnace.slots[0]?.count && c.furnace.slots[1]?.count){client.emit('inventory_slot',{window_id:2,slot:0,item:emptyItem()});client.emit('inventory_slot',{window_id:2,slot:2,item:item('iron_ingot',2,1234)});}};
 const requests=[];client.queue=(name,p)=>{if(name==='item_stack_request'){
  const decoded=createDeserializer('1.26.60').parsePacketBuffer(createSerializer('1.26.60').createPacketBuffer({name,params:p})).data.params.requests[0];requests.push(decoded);
  const pending=c.crafting.pending;client.emit('item_stack_response',{responses:[{request_id:decoded.request_id,status:reject?'error':'ok',containers:reject?[]:[...pending.expected].map(([key,{after}])=>({slot_type:{container_id:typeof key==='string'?key.split(':')[0]:'hotbar_and_inventory'},slots:[{slot:typeof key==='string'?Number(key.split(':')[1]):key,count:after.count,item_stack_id:after.count?++batchId:undefined}]}))}]});
 }};return {c,client,item,requests};
}
test('Japanese smelting and cooking use material names with a sixteen-item budget',()=>{
 assert.deepEqual(directPlan('原鉄を2個精錬して').actions,[{type:'smelt',item:'raw_iron',count:2}]);
 assert.equal(directPlan('生の牛肉を3個焼いて').actions[0].item,'beef');
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'smelt',item:'raw_iron',count:17}]}),/16/);
});
test('furnace moves materials and fuel, then verifies output inventory increase',async()=>{
 const f=setup();const result=await f.c.furnace.smelt('raw_iron',2,new AbortController().signal);
 assert.equal(result.produced,2);assert.equal(f.c.furnace.count('iron_ingot'),2);assert.equal(f.c.furnace.count('raw_iron'),0);
 assert.deepEqual(f.requests.map(r=>r.actions[0].destination.slot_type.container_id),['furnace_ingredient','furnace_fuel','hotbar_and_inventory']);
});
test('occupied furnace and server rejection never claim completion or modify rejected inventory',async()=>{
 const busy=setup();busy.c.furnace.open=async()=>{busy.c.furnace.slots=[busy.item('sand',1,123),emptyItem(),emptyItem()];};
 await assert.rejects(()=>busy.c.furnace.smelt('raw_iron',2,new AbortController().signal),/空のかまど/);assert.equal(busy.requests.length,0);
 const rejected=setup({reject:true});await assert.rejects(()=>rejected.c.furnace.smelt('raw_iron',2,new AbortController().signal),/拒否/);assert.equal(rejected.c.items[0].count,2);assert.equal(rejected.c.furnace.count('iron_ingot'),0);
});
