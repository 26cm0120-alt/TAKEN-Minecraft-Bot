import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls} from '../src/realm-controls.js';
import {shouldAutoSprint} from '../src/auto-sprint.js';
function fixture(){const client=new EventEmitter(),sent=[];client.queue=(name,params)=>sent.push({name,params});const c=new RealmControls(client);c.ready=true;c.health=20;c.food=20;c.entityId=7n;c.position={x:.5,y:65.62,z:.5};c.walkTarget={x:10.5,y:64,z:.5};c.block=p=>Math.floor(p.y)<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'};return {c,client,sent};}
test('normal long movement switches automatically to sprint without an explicit sprint mode',()=>{
 const {c,sent}=fixture();c.step();assert.equal(c.autoSprintActive,true);assert.ok(sent[0].params.input_data.includes('start_sprinting'));assert.ok(Math.abs(c.position.x-.63)<1e-8);
 c.position.x=8.6;c.step();assert.equal(c.autoSprintActive,false);assert.ok(sent[1].params.input_data.includes('stop_sprinting'));assert.ok(Math.abs(c.position.x-8.7)<1e-8);
});
test('threshold hysteresis keeps a sprint until 2 blocks and walking requires more than 4',()=>{
 const {c}=fixture();c.walkTarget.x=3.5;assert.equal(shouldAutoSprint(c),false);c.autoSprintActive=true;assert.equal(shouldAutoSprint(c),true);c.walkTarget.x=2.5;assert.equal(shouldAutoSprint(c),false);
});
test('food, health, steps, airborne state and swimming immediately disable automatic sprint',()=>{
 const {c,sent}=fixture();c.step();c.food=6;c.step();assert.ok(sent.at(-1).params.input_data.includes('stop_sprinting'));
 for(const [key,value] of [['food',null],['health',8],['verticalVelocity',.1],['navigationMode','swim'],['sleeping',true],['respawning',true]]){const {c:q}=fixture();q[key]=value;assert.equal(shouldAutoSprint(q),false,key);}
 c.food=20;c.walkTarget.y=65;assert.equal(shouldAutoSprint(c),false);
});
test('lookahead rejects water, unknown terrain, nearby walls and unsupported edges before arrival',()=>{
 for(const kind of ['water','unknown','wall','edge']){const {c}=fixture(),base=c.block;c.block=p=>{
  if(p.x>=1.5&&p.x<=2.5&&Math.abs(p.z-.5)<1.1){if(kind==='unknown')return null;if(kind==='water'&&Math.floor(p.y)<64)return {name:'water',boundingBox:'empty'};if(kind==='wall'&&Math.floor(p.y)>=64)return {name:'stone',boundingBox:'block'};if(kind==='edge')return {name:'air',boundingBox:'empty'};}return base(p);
 };assert.equal(shouldAutoSprint(c),false,kind);}
});
test('shared goto used by gathering, return and following automatically sprints and slows before verified arrival',async()=>{
 const {c,client,sent}=fixture();c.walkTarget=null;c.lastAuthoritativePosition={...c.position};c.requestNearby=()=>{};let n=0;c.wait=async()=>{assert.ok(++n<200);c.step();client.emit('server_post_move',{position:{...c.position}});};
 const result=await c.goto({x:10.5,y:64,z:.5});assert.equal(result.verification,'server_position_changed');assert.ok(sent.some(p=>p.params.input_data?.includes('start_sprinting')));assert.ok(sent.some(p=>p.params.input_data?.includes('stop_sprinting')));assert.equal(c.autoSprintActive,false);assert.equal(c.walkTarget,null);
});
