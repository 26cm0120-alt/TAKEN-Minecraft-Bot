import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {RealmControls,inputPacket} from '../src/realm-controls.js';
import {directPlan,validatePlan} from '../src/action-agent.js';
import {surfaceWalkable,advanceSurface} from '../src/surface-swimming.js';
const require=createRequire(import.meta.url),{createSerializer,createDeserializer}=require('../node_modules/bedrock-protocol/src/transforms/serializer.js');
function world(p){const x=Math.floor(p.x),y=Math.floor(p.y);return x>=1&&x<=3?(y<61?{name:'stone',boundingBox:'block'}:y<65?{name:'water',boundingBox:'empty'}:{name:'air',boundingBox:'empty'}):(y<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'});}
function setup(read=world){const client=new EventEmitter(),sent=[];client.queue=(name,params)=>sent.push({name,params});const c=new RealmControls(client);c.ready=true;c.health=20;c.food=20;c.entityId=5n;c.position={x:0.5,y:65.62,z:0.5};c.lastAuthoritativePosition={...c.position};c.block=read;c.requestNearby=()=>{};let ticks=0;c.wait=async()=>{assert.ok(++ticks<600);c.step();client.emit('server_post_move',{position:{...c.position}});};return {c,client,sent};}
test('dash and swim instructions have explicit bounded movement modes',()=>{
 assert.equal(directPlan('x=4 y=64 z=0へダッシュして').actions[0].mode,'sprint');assert.equal(directPlan('泳いで x=4 y=64 z=0へ移動して').actions[0].mode,'swim');assert.throws(()=>validatePlan({reply:'',actions:[{type:'move',mode:'fly',x:0,y:64,z:0}]}));
});
test('sprint increases speed, sends transitions and stops when food becomes insufficient',()=>{
 const {c,sent}=setup(p=>Math.floor(p.y)<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'});c.navigationMode='sprint';c.walkTarget={x:4.5,y:64,z:0.5};c.step();assert.ok(Math.abs(c.position.x-.63)<1e-8);assert.ok(sent[0].params.input_data.includes('start_sprinting'));c.food=6;c.step();assert.ok(sent[1].params.input_data.includes('stop_sprinting'));assert.ok(!sent[1].params.input_data.includes('sprinting'));
 const p=createDeserializer('1.26.60').parsePacketBuffer(createSerializer('1.26.60').createPacketBuffer(sent[0])).data.params;assert.ok(p.input_data.includes('sprinting'));
});
test('surface swimming crosses known water and returns to land with verified server position',async()=>{
 const {c,sent}=setup();const r=await c.execute({type:'move',mode:'swim',x:4.5,y:64,z:.5},'owner');assert.equal(r.verification,'server_position_changed');assert.equal(c.navigationMode,'walk');assert.ok(sent.some(p=>p.params.input_data?.includes('start_swimming')));assert.ok(sent.some(p=>p.params.input_data?.includes('stop_swimming')));assert.ok(Math.abs(r.position.x-4.5)<.6);
});
test('swim navigation rejects lava, unknown terrain and submerged goals; corrected submerged positions ascend',()=>{
 const {c}=setup();assert.equal(surfaceWalkable(c,2.5,64,.5),true);assert.equal(surfaceWalkable(c,2.5,62,.5),false);const m=advanceSurface(c,{x:2.5,y:62,z:.5},{x:3.5,y:62,z:.5});assert.equal(m.ascending,true);assert.equal(m.forward,false);assert.ok(m.feet.y>62);
 c.block=()=>null;assert.equal(surfaceWalkable(c,2.5,64,.5),false);c.block=()=>({name:'lava',boundingBox:'empty'});assert.equal(surfaceWalkable(c,2.5,64,.5),false);
 const packet=inputPacket({x:2,y:65.62,z:0},1n,{startSwimming:true,ascending:true});assert.ok(createDeserializer('1.26.60').parsePacketBuffer(createSerializer('1.26.60').createPacketBuffer({name:'player_auth_input',params:packet})).data.params.input_data.includes('start_swimming'));
});
test('stop and death suppress horizontal swimming; distant swims and low-food sprint are refused',async()=>{
 const {c,sent}=setup();await assert.rejects(()=>c.execute({type:'move',mode:'swim',x:30,y:64,z:0},'owner'),/24/);c.food=6;await assert.rejects(()=>c.execute({type:'move',mode:'sprint',x:1,y:64,z:0},'owner'),/満腹度/);c.position={x:2.5,y:65.62,z:.5};c.walkTarget={x:3.5,y:64,z:.5};c.navigationMode='swim';c.stop();c.step();assert.equal(c.position.x,2.5);c.health=0;const n=sent.length;c.step();assert.equal(sent.length,n);
});
