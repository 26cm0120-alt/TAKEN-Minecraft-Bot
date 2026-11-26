import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RealmControls} from '../src/realm-controls.js';
function fixture(){
 const c=Object.create(RealmControls.prototype);Object.assign(c,{position:{x:.5,y:65.62,z:.5},lastAuthoritativePosition:{x:.5,y:65.62,z:.5},serverPosition:null,serverMoves:0,serverPostMoves:0,corrections:0,verticalVelocity:0,navigationMode:'walk',check:s=>s.throwIfAborted(),requestNearby(){},nearbySummary:()=>'',walkable:()=>true,block:()=>({name:'air',boundingBox:'empty'})});return c;
}
const signal=()=>new AbortController().signal;
test('arrival waits for final server update even after an earlier correction',async()=>{
 const c=fixture();let waits=0;const now=Date.now;let time=0;Date.now=()=>time;
 c.wait=async()=>{time+=50;waits++;if(c.walkTarget){c.position={x:c.walkTarget.x,y:65.62,z:c.walkTarget.z};c.corrections++;c.lastAuthoritativePosition={x:1.5,y:65.62,z:.5};}else if(waits>=4){c.lastAuthoritativePosition={x:2.5,y:65.62,z:.5};c.corrections++;}};
 try{const result=await c.goto({x:2.5,y:64,z:.5},signal());assert.equal(result.position.x,2.5);assert.ok(waits>=4);}finally{Date.now=now;}
});
test('arrival mismatch replans from received position; still verifies actual goal',async()=>{
 const c=fixture(),now=Date.now;let time=0,legs=0;Date.now=()=>time;
 c.wait=async()=>{time+=500;if(c.walkTarget){c.position={x:c.walkTarget.x,y:65.62,z:c.walkTarget.z};c.corrections++;legs++;c.lastAuthoritativePosition={x:legs===1?1.5:2.5,y:65.62,z:.5};}};
 try{const result=await c.goto({x:2.5,y:64,z:.5},signal());assert.equal(result.position.x,2.5);assert.equal(legs,2);}finally{Date.now=now;}
});
test('repeated server mismatch is bounded and never claims arrival',async()=>{
 const c=fixture(),now=Date.now;let time=0,legs=0;Date.now=()=>time;
 c.wait=async()=>{time+=500;if(c.walkTarget){c.position={x:c.walkTarget.x,y:65.62,z:c.walkTarget.z};c.corrections++;legs++;c.lastAuthoritativePosition={x:.5,y:65.62,z:.5};}};
 try{await assert.rejects(c.goto({x:2.5,y:64,z:.5},signal()),/2回再計画/);assert.equal(legs,3);}finally{Date.now=now;}
});
