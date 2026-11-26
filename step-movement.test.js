import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {planStepPath,advanceStep} from './step-movement.js';
import {RealmControls,inputPacket} from './realm-controls.js';
const require=createRequire(import.meta.url),{createSerializer,createDeserializer}=require('./node_modules/bedrock-protocol/src/transforms/serializer.js');
function world(height,{ceiling,water=false}={}){return p=>{const h=height(Math.floor(p.x),Math.floor(p.z)),y=Math.floor(p.y);if(h===null)return {name:'air',boundingBox:'empty'};if(ceiling?.(p,y))return {name:'stone',boundingBox:'block'};return y<h?{name:water && Math.floor(p.x)===1?'water':'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'};};}
function fixture(read){const c=new EventEmitter();c.sent=[];c.queue=(name,params)=>c.sent.push({name,params});const controls=new RealmControls(c);controls.block=read;controls.ready=true;controls.health=20;controls.position={x:0.5,y:65.62,z:0.5};return {controls,c};}
test('height-aware path climbs and descends one block but rejects a two-block wall, holes and water',()=>{
 const {controls}=fixture(world(x=>x>=1?65:64));const path=planStepPath(controls,{x:1.5,y:65,z:0.5},0.6);assert.equal(path.at(-1).y,65);assert.ok(path.every((p,i)=>!i || Math.abs(p.y-path[i-1].y)<=1));
 controls.position={x:1.5,y:66.62,z:0.5};assert.equal(planStepPath(controls,{x:0.5,y:64,z:0.5},0.6).at(-1).y,64);
 for(const read of [world(x=>x>=1?66:64),world(x=>x===1?null:64),world(()=>64,{water:true})]){controls.block=read;controls.position={x:0.5,y:65.62,z:0.5};assert.equal(planStepPath(controls,{x:2.5,y:64,z:0.5},0.6),null);}
});
test('one-block jump is gradual, reaches the upper ground and lands without teleporting',()=>{
 const read=world(x=>x>=1?65:64),target={x:1.5,y:65,z:0.5};let feet={x:0.5,y:64,z:0.5},velocity=0,starts=0,peak=64;
 for(let i=0;i<100;i++){const old=feet,m=advanceStep(read,feet,target,velocity);feet=m.feet;velocity=m.velocity;starts+=Number(m.jumpStarted);peak=Math.max(peak,feet.y);assert.ok(Math.abs(feet.x-old.x)<=0.100001);assert.ok(feet.y-old.y<=0.420001);if(Math.hypot(feet.x-target.x,feet.z-target.z)<0.1 && Math.abs(feet.y-65)<0.01 && velocity===0)break;}
 assert.equal(starts,1);assert.ok(peak>65);assert.ok(Math.abs(feet.y-65)<0.01);assert.ok(Math.abs(feet.x-1.5)<0.1);assert.equal(velocity,0);
});
test('downward step falls one block and low ceiling prevents upward jumps',()=>{
 const read=world(x=>x>=1?65:64);let feet={x:1.5,y:65,z:0.5},velocity=0;
 for(let i=0;i<100;i++){const m=advanceStep(read,feet,{x:0.5,y:64,z:0.5},velocity);feet=m.feet;velocity=m.velocity;}
 assert.ok(Math.abs(feet.y-64)<0.01);assert.ok(Math.abs(feet.x-0.5)<0.1);
 const low=world(x=>x>=1?65:64,{ceiling:(p,y)=>p.x<1 && y===67});const {controls}=fixture(low);assert.equal(planStepPath(controls,{x:1.5,y:65,z:0.5},0.6),null);
 const m=advanceStep(low,{x:0.5,y:64,z:0.5},{x:1.5,y:65,z:0.5});assert.equal(m.jumpStarted,false);assert.equal(m.blocked,true);
});
test('jump input encodes in installed protocol and dead/respawning client suppresses it',()=>{
 const {controls,c}=fixture(world(x=>x>=1?65:64));controls.walkTarget={x:1.5,y:65,z:0.5};controls.step();
 const sent=c.sent[0];assert.equal(sent.name,'player_auth_input');assert.ok(sent.params.position.y>65.62);assert.ok(sent.params.input_data.includes('start_jumping'));
 const decoded=createDeserializer('1.26.60').parsePacketBuffer(createSerializer('1.26.60').createPacketBuffer(sent)).data.params;assert.ok(decoded.input_data.includes('start_jumping'));assert.ok(decoded.delta.y>0);
 controls.health=0;controls.step();assert.equal(c.sent.length,1);controls.health=20;controls.respawning=true;controls.step();assert.equal(c.sent.length,1);
 assert.ok(inputPacket({x:0,y:0,z:0},1n,{jumpStarted:true,jumping:true}).input_data.includes('jumping'));
});

test('goto walks multiple waypoints with height changes and verifies the server destination',async()=>{
 const {controls,c}=fixture(world(x=>64+Math.min(2,Math.max(0,x))));controls.lastAuthoritativePosition={...controls.position};controls.lastAuthoritativeSource='respawn';controls.requestNearby=()=>{};
 let ticks=0;controls.wait=async()=>{assert.ok(++ticks<180,'path must finish');controls.step();c.emit('server_post_move',{position:{...controls.position}});};
 const result=await controls.goto({x:2.5,y:66,z:0.5},undefined,0.6);assert.equal(result.verification,'server_position_changed');assert.ok(Math.abs(result.position.y-66)<0.1);assert.ok(Math.abs(result.position.x-2.5)<0.6);assert.ok(c.sent.filter(p=>p.params.input_data?.includes('start_jumping')).length>=2);
});
