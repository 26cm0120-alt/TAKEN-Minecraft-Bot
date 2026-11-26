import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls,emptyItem} from '../src/realm-controls.js';
import {miningToolSlot} from '../src/mining-tools.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createSerializer,createDeserializer}=require('../node_modules/bedrock-protocol/src/transforms/serializer.js');
function setup(){
 const client=new EventEmitter(),c=new RealmControls(client);c.ready=true;c.health=20;c.entityId=1n;c.crafting.timeout=30;
 c.wait=async()=>{await new Promise(r=>setTimeout(r,1));};
 const item=(name,id)=>({...emptyItem(),network_id:c.registry.itemsByName[name].id,count:1,has_stack_id:true,stack_id:id});
 return {client,c,item};
}
test('mining finds tools outside hotbar and uses shovel for soil, axe for wood',()=>{
 const {c,item}=setup();c.items[0]=item('iron_axe',1);c.items[12]=item('iron_shovel',2);c.items[20]=item('stone_pickaxe',3);
 assert.equal(miningToolSlot(c.items,c.registry,'dirt'),12);
 assert.equal(miningToolSlot(c.items,c.registry,'oak_log'),0);
 assert.equal(c.pickaxeSlot('iron_ore'),20);
 assert.throws(()=>c.pickaxeSlot('diamond_ore'),/鉄以上/);
 c.items[12]=emptyItem();assert.equal(miningToolSlot(c.items,c.registry,'dirt'),-1);
});
test('equipment swap round trips the protocol and updates only after server approval',async()=>{
 const {client,c,item}=setup();c.items=Array.from({length:36},emptyItem);c.items[12]=item('iron_pickaxe',123);let request;
 client.queue=(name,p)=>{
  if(name==='interact')client.emit('container_open',{window_id:'inventory',window_type:'inventory'});
  if(name==='item_stack_request'){
   const serializer=createSerializer('1.26.60'),deserializer=createDeserializer('1.26.60');
   request=deserializer.parsePacketBuffer(serializer.createPacketBuffer({name,params:p})).data.params.requests[0];
   assert.equal(c.items[0].count,0);assert.equal(c.items[12].stack_id,123);
   client.emit('item_stack_response',{responses:[{request_id:request.request_id,status:'ok',containers:[{slot_type:{container_id:'hotbar_and_inventory'},slots:[{slot:0,count:1,item_stack_id:200},{slot:12,count:0}]}]}]});
  }
 };
 assert.equal(await c.prepareMiningTool('iron_ore'),0);
 assert.equal(request.actions[0].type_id,'swap');assert.equal(request.actions[0].source.slot,12);
 assert.equal(c.items[12].count,0);assert.equal(c.items[0].stack_id,200);
});
test('server rejection or missing acknowledgment never invents a tool transfer',async()=>{
 for(const reject of [true,false]){
  const {client,c,item}=setup();c.items=Array.from({length:36},emptyItem);c.items[12]=item('iron_pickaxe',123);
  client.queue=(name,p)=>{if(name==='interact')client.emit('container_open',{window_id:'inventory',window_type:'inventory'});if(name==='item_stack_request'&&reject)client.emit('item_stack_response',{responses:[{request_id:p.requests[0].request_id,status:'error'}]});};
  await assert.rejects(()=>c.prepareMiningTool('iron_ore'),/道具/);
  assert.equal(c.items[0].count,0);assert.equal(c.items[12].stack_id,123);
 }
});
