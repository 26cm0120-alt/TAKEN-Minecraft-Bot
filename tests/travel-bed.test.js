import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {RealmControls} from '../src/realm-controls.js';
import {travelFar} from '../src/long-travel.js';
import {directPlan} from '../src/action-agent.js';
import {LIMITS} from '../src/capabilities.js';
const require=createRequire(import.meta.url);const {createSerializer,createDeserializer}=require('../node_modules/bedrock-protocol/src/transforms/serializer.js');
const serializer=createSerializer('1.26.60'),deserializer=createDeserializer('1.26.60');
function setup(){const client=new EventEmitter();client.sent=[];client.queue=(name,p)=>client.sent.push({name,p});const c=new RealmControls(client);c.entityId=3n;c.ready=true;c.health=20;c.position={x:0.5,y:65.62,z:0.5};c.requestNearby=()=>{};c.wait=async(ms,s,o)=>c.check(s,o);c.walkable=(x,y,z)=>y===64;c.block=p=>({name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty'});return {client,c};}
test('far travel reaches 256 blocks through short verified calls and refuses beyond the bound',async()=>{
 const {c}=setup(),legs=[];c.goto=async p=>{assert.ok(Math.hypot(c.feet().x-p.x,c.feet().z-p.z)<=24);legs.push(p);c.position={...p,y:p.y+1.62};return {position:p,verification:'server_position_changed'};};
 const r=await travelFar(c,{x:256.5,y:64,z:0.5},new AbortController().signal);assert.equal(r.position.x,256.5);assert.ok(legs.length>10);assert.equal(LIMITS.travelRadius,256);
 c.position={x:0.5,y:65.62,z:0.5};await assert.rejects(()=>travelFar(c,{x:257.5,y:64,z:0.5}),/256/);
});
test('unknown terrain and cancellation stop remote travel before sending movement',async()=>{
 const {c}=setup();c.walkable=()=>false;c.goto=()=>{throw Error('must not move');};await assert.rejects(()=>travelFar(c,{x:80,y:64,z:0.5}),/安全な経路/);
 const abort=new AbortController();abort.abort();await assert.rejects(()=>travelFar(c,{x:80,y:64,z:0.5},abort.signal));
});
test('sleep and wake commands are deterministic, metadata confirms sleep and waking packet serializes',async()=>{
 assert.equal(directPlan('ベッドで寝て').actions[0].type,'sleep');assert.equal(directPlan('起きて').actions[0].type,'wake');
 const {client,c}=setup(),bed={name:'bed',position:{x:2,y:64,z:0},runtimeId:1};c.block=p=>Math.floor(p.x)===2&&Math.floor(p.y)===64&&Math.floor(p.z)===0?bed:null;c.goto=async()=>{};
 c.wait=async(ms,s,o)=>{if(c.bed.pending)client.emit('set_entity_data',{runtime_entity_id:3n,metadata:[{key:'player_flags',value:2}]});c.check(s,o);};
 const r=await c.execute({type:'sleep'},'owner',new AbortController().signal);assert.equal(r.sleeping,true);assert.equal(c.status().sleeping,true);assert.throws(()=>c.check(),/睡眠中/);
 const prior=client.queue;client.queue=(name,p)=>{prior(name,p);if(name==='player_action')client.emit('set_entity_data',{runtime_entity_id:3n,metadata:[{key:'player_flags',value:0}]});};
 const wake=await c.execute({type:'wake'},'owner',new AbortController().signal);assert.equal(wake.sleeping,false);
 const packet=client.sent.find(p=>p.name==='player_action');const decoded=deserializer.parsePacketBuffer(serializer.createPacketBuffer({name:packet.name,params:packet.p})).data.params;assert.equal(decoded.action,'stop_sleeping');
});
test('beds outside overworld and missing beds never send an interaction',async()=>{
 const {client,c}=setup();c.dimension=1;await assert.rejects(()=>c.bed.sleep(),/オーバーワールド/);assert.equal(client.sent.length,0);c.dimension=0;c.block=()=>null;await assert.rejects(()=>c.bed.sleep(),/ベッドがありません/);
 client.emit('set_entity_data',{runtime_entity_id:99n,metadata:[{key:'player_flags',value:2}]});assert.ok(!c.sleeping);
});
test('sleep cancellation clears interaction and wake request, death clears sleep state',async()=>{
 const {client,c}=setup(),bed={name:'bed',position:{x:2,y:64,z:0},runtimeId:1};c.block=()=>bed;c.goto=async()=>{};const abort=new AbortController();c.wait=async()=>{abort.abort();abort.signal.throwIfAborted();};await assert.rejects(()=>c.bed.sleep(abort.signal));assert.equal(c.pendingTransaction,null);assert.ok(client.sent.some(p=>p.name==='player_action'));
 client.emit('set_entity_data',{runtime_entity_id:3n,metadata:[{key:'player_flags',value:2}]});client.emit('taken_death');assert.equal(c.sleeping,false);
});
test('follow duration cancels even when a far movement is still pending',async()=>{
 const {c}=setup();c.player=()=>({position:{x:180,y:65.62,z:0.5}});let cancelled=false;c.goto=async(p,s)=>new Promise((resolve,reject)=>{const keepAlive=setTimeout(()=>reject(Error('follow did not time out')),2500);s.addEventListener('abort',()=>{clearTimeout(keepAlive);cancelled=true;reject(s.reason);},{once:true});});
 const r=await c.follow('owner',1,new AbortController().signal);assert.equal(cancelled,true);assert.equal(r.seconds,1);
});
