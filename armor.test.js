import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls,emptyItem} from './realm-controls.js';
import {directPlan,validatePlan} from './action-agent.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createSerializer,createDeserializer}=require('./node_modules/bedrock-protocol/src/transforms/serializer.js');
function fixture({reject=false}={}){
 const client=new EventEmitter(),c=new RealmControls(client);c.ready=true;c.health=20;c.crafting.timeout=30;c.wait=async()=>new Promise(r=>setTimeout(r,1));const requests=[];
 const item=(name,id)=>({...emptyItem(),count:1,network_id:c.registry.itemsByName[name].id,has_stack_id:true,stack_id:id});
 client.queue=(name,p)=>{if(name==='interact')client.emit('container_open',{window_id:'inventory',window_type:'inventory'});if(name==='item_stack_request'){
  const wire=createDeserializer('1.26.60').parsePacketBuffer(createSerializer('1.26.60').createPacketBuffer({name,params:p})).data.params;requests.push(wire.requests[0]);
  const pending=c.crafting.pending;
  client.emit('item_stack_response',{responses:[{request_id:pending.request.request_id,status:reject?'error':'ok',containers:reject?[]:[...pending.expected].map(([key,{after}])=>({slot_type:{container_id:typeof key==='string'?key.split(':')[0]:'hotbar_and_inventory'},slots:[{slot:typeof key==='string'?Number(key.split(':')[1]):key,count:after.count,item_stack_id:after.count?1000+(typeof key==='string'?Number(key.split(':')[1]):key):undefined}]}))}]});
 }};return {client,c,item,requests};
}
test('armor names and offhand commands parse to distinct validated actions',()=>{
 for(const [text,type,item] of [['鉄のヘルメットを装備して','wear','iron_helmet'],['銅のレギンスを履いて','wear','copper_leggings'],['盾を左手に持って','offhand','shield']]){const p=directPlan(text);assert.equal(p.actions[0].type,type);assert.equal(p.actions[0].item,item);validatePlan(p);}
});
test('armor swap preserves existing armor in the original inventory slot and uses armor container',async()=>{
 const {client,c,item,requests}=fixture();c.items[12]=item('iron_helmet',123);
 client.emit('inventory_content',{window_id:'armor',input:[item('leather_helmet',222),emptyItem(),emptyItem(),emptyItem()]});
 await c.wearArmor('iron_helmet');assert.equal(c.armorItems[0].network_id,c.registry.itemsByName.iron_helmet.id);assert.equal(c.items[12].network_id,c.registry.itemsByName.leather_helmet.id);
 assert.equal(requests[0].actions[0].destination.slot_type.container_id,'armor');assert.equal(requests[0].actions[0].destination.slot,0);
});
test('offhand swap is confirmed; unknown armor and server rejection never create equipment',async()=>{
 const f=fixture();f.c.items[0]=f.item('shield',123);f.client.emit('inventory_content',{window_id:'offhand',input:[emptyItem()]});await f.c.equipOffhand('shield');assert.equal(f.c.offhandItems[0].network_id,f.c.registry.itemsByName.shield.id);
 const bad=fixture({reject:true});bad.c.items[0]=bad.item('iron_boots',123);await assert.rejects(()=>bad.c.wearArmor('iron_boots'),/未受信/);
 bad.client.emit('inventory_content',{window_id:120,input:Array.from({length:4},emptyItem)});await assert.rejects(()=>bad.c.wearArmor('iron_boots'),/拒否/);assert.equal(bad.c.items[0].count,1);assert.equal(bad.c.armorItems[3].count,0);
});
