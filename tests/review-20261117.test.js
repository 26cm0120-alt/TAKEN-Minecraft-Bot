import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RealmControls} from '../src/realm-controls.js';
import {RealmRecovery} from '../src/realm-recovery.js';
import {requestLocalAI} from '../src/local-ai-request.js';

test('cancelled AI requests never reach the inference server',async()=>{
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 let requests=0;
 await assert.rejects(requestLocalAI(async()=>{requests++;return {ok:true,json:async()=>({})};},{},controller.signal),/cancelled/);
 assert.equal(requests,0);
});

test('shutdown during async connection closes the late client',async()=>{
 const old=new EventEmitter();old.close=()=>{};
 let resolveConnection,closed=0;
 const late=new EventEmitter();late.close=()=>{closed++;};
 const recovery=new RealmRecovery(()=>new Promise(resolve=>{resolveConnection=resolve;}),{wait:async()=>{}});
 recovery.attach(old);
 const pending=recovery.recover(old,'respawn_timeout');
 while(!resolveConnection)await new Promise(resolve=>setImmediate(resolve));
 recovery.stop();resolveConnection(late);await pending;
 assert.equal(closed,1);assert.notEqual(recovery.current,late);
});

test('zero health after readiness still sends stationary ack and blocks jobs',()=>{
 const client=new EventEmitter(),sent=[];client.queue=(name,packet)=>sent.push({name,packet});
 const c=new RealmControls(client,'1.26.60',{now:()=>0});
 c.ready=true;c.entityId=42n;c.position={x:91.5,y:65.62,z:542.5};
 c.observeHealth(0);
 client.emit('respawn',{state:1,runtime_entity_id:0n,position:{...c.position}});
 c.observeHealth(0);c.serverDataAckPending=true;
 c.walkTarget={x:95,y:64,z:542};c.pendingActions=[{action:'start_break'}];
 const position={...c.position};c.step();
 assert.equal(sent.at(-1).name,'player_auth_input');
 assert.deepEqual(c.position,position);assert.equal(c.movementInputs,0);
 assert.equal(sent.at(-1).packet.block_action,undefined);
 assert.equal(c.serverDataAckPending,false);
 assert.throws(()=>c.check(),/リスポーン/);
 c.observeHealth(20);assert.doesNotThrow(()=>c.check());client.emit('close');
});
