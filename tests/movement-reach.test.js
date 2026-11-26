import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls} from '../src/realm-controls.js';
function fixture(){const c=new EventEmitter(),sent=[];c.queue=(name,params)=>sent.push({name,params});const controls=new RealmControls(c);controls.ready=true;controls.health=20;controls.position={x:91.5,y:65.62,z:542.5};controls.lastAuthoritativePosition={...controls.position};controls.lastAuthoritativeSource='respawn';controls.requestNearby=()=>{};controls.wait=async()=>{};return {controls,sent};}
test('already in server-confirmed reach does not require a move or movement acknowledgment',async()=>{
 const {controls,sent}=fixture();controls.walkable=()=>{throw Error('must not search a path when already in range');};
 const result=await controls.goto({x:92,y:64,z:542},undefined,3);
 assert.equal(result.verification,'server_position_already_in_range');assert.equal(result.moved,false);assert.equal(sent.length,0);assert.equal(controls.walkTarget,null);
});
test('a local prediction in reach is insufficient when the server position is elsewhere',async()=>{
 const {controls}=fixture();controls.lastAuthoritativePosition={x:80,y:65.62,z:542.5};
 let waits=0;controls.wait=async()=>{if(++waits>2)throw Error('verification wait reached');};
 await assert.rejects(()=>controls.goto({x:92,y:64,z:542},undefined,3),/verification wait reached/);
});
test('nearby dirt mining proceeds to break and server block verification without forcing movement',async()=>{
 const {controls}=fixture();const target={name:'dirt',position:{x:92,y:64,z:542},runtimeId:1};
 controls.block=p=>Math.floor(p.x)===92 && Math.floor(p.y)===64 && Math.floor(p.z)===542?target:null;
 controls.authoritativeBreak=true;let confirmed=0;
 controls.confirmBlock=async(p,predicate)=>{assert.deepEqual(p,target.position);assert.ok(controls.pendingActions.some(a=>a.action==='predict_break'));assert.equal(predicate({name:'dirt'}),false);assert.equal(predicate({name:'air'}),true);confirmed++;};
 const result=await controls.mine('dirt',1);assert.equal(result.broken,1);assert.equal(confirmed,1);
});
