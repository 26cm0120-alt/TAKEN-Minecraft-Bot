import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {RealmControls,emptyItem} from '../src/realm-controls.js';
import {directPlan,validatePlan} from '../src/action-agent.js';
const require=createRequire(import.meta.url);
const {createSerializer,createDeserializer}=require('../node_modules/bedrock-protocol/src/transforms/serializer.js');
const ser=createSerializer('1.26.60'),de=createDeserializer('1.26.60');
function setup(){const client=new EventEmitter();client.sent=[];client.queue=(n,p)=>client.sent.push({n,p});const c=new RealmControls(client);c.ready=true;c.health=20;c.position={x:0.5,y:65.62,z:0.5};c.entityId=5n;c.walkable=()=>true;c.wait=async(ms,signal)=>{signal?.throwIfAborted();await new Promise(r=>setTimeout(r,1));c.check(signal);};const item=(name,count)=>({...emptyItem(),network_id:c.registry.itemsByName[name].id,count});
 function drop(name='dirt',count=4,x=2.5,id=10n){const p={entity_id_self:id+100n,runtime_entity_id:id,item:item(name,count),position:{x,y:64.2,z:0.5},velocity:{x:0,y:0,z:0},metadata:[],is_from_fishing:false};const wire=de.parsePacketBuffer(ser.createPacketBuffer({name:'add_item_entity',params:p})).data.params;client.emit('add_item_entity',wire);return wire;}
 client.emit('inventory_content',{window_id:'inventory',input:[]});return {client,c,item,drop};}
test('Japanese collection commands and total requested budget are validated',()=>{
 assert.deepEqual(directPlan('近くのアイテムを拾って').actions,[{type:'collect',count:64}]);
 assert.deepEqual(directPlan('落ちているオークの原木を3個回収して').actions,[{type:'collect',item:'oak_log',count:3}]);
 assert.equal(directPlan('原鉄を3個拾って').actions[0].item,'raw_iron');
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'collect',count:64},{type:'collect',count:1}]}));
 assert.throws(()=>validatePlan({reply:'',actions:[{type:'collect',item:'../x',count:1}]}));
});
test('pickup approaches an actor at the cell edge after the grid path and confirms only inventory growth',async()=>{
 const {c,client,item,drop}=setup();drop('dirt',1,2.95);const before=c.pickup.snapshot();let approached=false;
 c.goto=async p=>{c.position={x:p.x,y:p.y+1.62,z:p.z};};
 c.wait=async()=>{assert.equal(c.walkTarget.x,Math.fround(2.95));approached=true;c.position.x=c.walkTarget.x;client.emit('inventory_slot',{window_id:'inventory',slot:0,item:item('dirt',1)});};
 const r=await c.pickup.collect({item:'dirt',count:1});assert.equal(approached,true);assert.equal(r.total,1);assert.equal(c.walkTarget,null);assert.equal(client.sent.length,0);
});
test('final approach never walks onto an unsafe edge and cancellation clears movement',async()=>{
 const {c,drop}=setup();drop('dirt',1,2.95);const actor=c.pickup.drops.get('10');c.goto=async()=>{c.position={x:2.5,y:65.62,z:0.5};};c.walkable=()=>false;
 const abort=new AbortController();c.wait=async()=>{assert.equal(c.walkTarget,null);abort.abort();abort.signal.throwIfAborted();};
 await assert.rejects(()=>c.pickup.approach(actor,{x:2.5,y:64,z:0.5},abort.signal,c.pickup.snapshot()));assert.equal(c.walkTarget,null);assert.equal(c.items.length,0);
});
test('item actor wire data and partial movement updates track location and dimension clears stale drops',()=>{
 const {client,c,drop}=setup();drop();assert.equal(c.pickup.drops.size,1);assert.match(c.pickup.summary(),/dirt×4/);
 client.emit('move_entity_delta',{runtime_entity_id:10n,x:4});assert.equal(c.pickup.drops.get('10').position.y,Math.fround(64.2));assert.equal(c.pickup.drops.get('10').position.x,4);
 client.emit('remove_entity',{entity_id_self:110n});assert.equal(c.pickup.drops.size,0);drop();client.emit('change_dimension',{dimension:1,position:{x:0,y:65.62,z:0}});assert.equal(c.pickup.drops.size,0);
});
test('real inventory packet confirms an entire stack, may exceed requested count, and no pickup packet is forged',async()=>{
 const {client,c,item,drop}=setup();drop();c.goto=async()=>{client.emit('take_item_entity',{runtime_entity_id:10n,target:5});client.emit('inventory_slot',{window_id:'inventory',slot:12,item:item('dirt',4)});};
 const r=await c.execute({type:'collect',item:'dirt',count:1},'owner',new AbortController().signal);assert.equal(r.total,4);assert.equal(r.requested,1);assert.equal(r.verification,'server_inventory_increase');assert.equal(c.items[12].count,4);assert.equal(client.sent.length,0);
});
test('foreign pickup or despawn without inventory growth is never success',async()=>{
 const {client,c,drop}=setup();drop();c.goto=async()=>client.emit('take_item_entity',{runtime_entity_id:10n,target:99});
 await assert.rejects(()=>c.pickup.collect({count:1},new AbortController().signal),/持ち物の増加/);assert.equal(c.items.length,0);
});
test('unreachable, hazardous, distant and full-inventory drops are skipped without modifying inventory',async()=>{
 const {c,item,drop}=setup();drop();c.walkable=()=>false;await assert.rejects(()=>c.pickup.collect({count:1}),/安全な足場/);
 c.pickup.drops.clear();drop('dirt',1,30);await assert.rejects(()=>c.pickup.collect({count:1}),/対象アイテム/);
 c.pickup.drops.clear();drop('dirt',1);c.items=Array.from({length:36},()=>item('stone',64));c.walkable=()=>true;await assert.rejects(()=>c.pickup.collect({count:1}),/空き/);assert.ok(c.items.every(i=>i.count===64));
});
test('cancel and death stop collection, optional mine recovery only considers mined positions',async()=>{
 const {c,drop,item,client}=setup();drop();const abort=new AbortController();c.goto=async()=>{abort.abort();abort.signal.throwIfAborted();};await assert.rejects(()=>c.pickup.collect({count:1},abort.signal));assert.equal(c.walkTarget,null);
 c.goto=async()=>{throw Error('must not approach unrelated drops');};const none=await c.pickup.collect({positions:[{x:10,y:64,z:10}],optional:true});assert.equal(none.total,0);assert.equal(none.attempts,0);
 c.goto=async()=>{c.health=0;c.check();};await assert.rejects(()=>c.pickup.collect({count:1}),/死亡/);assert.equal(c.items.length,0);
});
test('mining integrates recovery and reports server inventory gain independently of broken blocks',async()=>{
 const {c,client,drop,item}=setup();let mined=false;c.block=p=>!mined&&Math.floor(p.x)===2&&Math.floor(p.y)===64&&Math.floor(p.z)===0?{name:'dirt',position:{x:2,y:64,z:0},runtimeId:1}:null;
 c.goto=async()=>{if(mined)client.emit('inventory_slot',{window_id:'inventory',slot:0,item:item('dirt',1)});};c.confirmBlock=async()=>{mined=true;drop('dirt',1);};
 const r=await c.mine('dirt',1,new AbortController().signal);assert.equal(r.broken,1);assert.equal(r.pickup.total,1);assert.equal(r.pickup.collected[0].item,'dirt');
});
