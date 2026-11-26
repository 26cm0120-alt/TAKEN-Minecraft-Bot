import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RealmControls} from '../src/realm-controls.js';
import {directPlan,validatePlan} from '../src/action-agent.js';
function fixture(){const c=Object.create(RealmControls.prototype);c.feet=()=>({x:.5,y:64,z:.5});c.lastAuthoritativePosition={x:.5,y:65.62,z:.5};c.check=s=>s?.throwIfAborted();c.block=p=>({name:Math.floor(p.y)<64?'stone':'air',boundingBox:Math.floor(p.y)<64?'block':'empty',position:{x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)}});return c;}
test('explicit foot digging phrases bypass AI and cannot request multiple blocks',()=>{for(const text of ['足元を1マス掘って','自分の下にある1マス掘って','真下のブロックを1個掘って'])assert.deepEqual(validatePlan(directPlan(text)).actions,[{type:'dig_below'}]);assert.notEqual(directPlan('足元を64マス掘って')?.actions?.[0]?.type,'dig_below');});
test('safe dig selects only exact supporting block and restricts count to one',async()=>{const c=fixture();let request;c.mine=async(...a)=>{request=a;return {broken:1};};await c.digBelow(new AbortController().signal);assert.equal(request[0],'stone');assert.equal(request[1],1);assert.deepEqual(request[3],{targetPosition:{x:0,y:63,z:0},allowBelow:true});assert.throws(()=>c.safeBelow({x:1,y:63,z:0}),/真下/);});
test('unknown, hole and hazardous landing blocks stop before mining',async()=>{for(const floor of [null,{name:'air',boundingBox:'empty'},{name:'lava',boundingBox:'block'},{name:'magma',boundingBox:'block'}]){const c=fixture(),read=c.block;c.block=p=>p.y<63?floor:read(p);c.mine=()=>{throw Error('must not mine');};await assert.rejects(c.digBelow(new AbortController().signal),/着地点/);}});
test('standing across a block boundary refuses suffocating landing',()=>{const c=fixture();c.feet=()=>({x:.95,y:64,z:.5});assert.throws(()=>c.safeBelow({x:0,y:63,z:0}),/空間/);});


test('actual foot mining skips navigation while retaining block verification',async()=>{
 const client=new EventEmitter();client.queue=()=>{};const c=new RealmControls(client);c.ready=true;c.health=20;c.position={x:.5,y:65.62,z:.5};c.lastAuthoritativePosition={...c.position};let broken=false;
 c.block=p=>{const q={x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)},air=q.y>=64||(broken&&q.x===0&&q.y===63&&q.z===0);return {name:air?'air':'stone',boundingBox:air?'empty':'block',position:q,runtimeId:1};};
 c.goto=()=>{throw Error('must not navigate before digging below');};c.wait=async()=>{};c.prepareMiningTool=async()=>0;c.look=()=>{};c.confirmBlock=async p=>{assert.deepEqual(p,{x:0,y:63,z:0});broken=true;};c.pickup.collect=async()=>({total:0});
 const r=await c.digBelow(new AbortController().signal);assert.equal(r.broken,1);assert.equal(c.verticalVelocity,-.08);
});
test('desynchronised server position cannot authorize digging',()=>{const c=fixture();c.lastAuthoritativePosition.y=66.5;assert.equal(c.belowPositionConfirmed(),false);assert.throws(()=>c.requireBelowPosition(),/同期/);});
